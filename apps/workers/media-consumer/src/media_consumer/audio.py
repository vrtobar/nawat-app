"""Audio normalisation and transcoding, via ffmpeg as a subprocess."""

import json
import subprocess
from pathlib import Path

from . import config
from .errors import TerminalError, TransientError

# Generous for a file capped at 10MB. The queue's visibility timeout is derived
# from the function timeout, which is larger than this again, so a run that hits
# this limit fails as a timeout rather than racing a redelivery.
FFMPEG_TIMEOUT_SECONDS = 240


def _run(argv: list[str]) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=FFMPEG_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as err:
        # A file that takes four minutes to transcode at this size is malformed
        # rather than large, and it will take four minutes again on redelivery.
        raise TerminalError("ffmpeg timed out") from err
    except OSError as err:
        # ffmpeg missing or unexecutable is an image defect, not an asset one.
        raise TransientError(f"could not execute ffmpeg: {err}") from err


def probe_duration_seconds(source: Path) -> float:
    result = _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(source),
        ]
    )
    if result.returncode != 0:
        raise TerminalError(f"could not read the audio stream: {result.stderr.strip()[:500]}")
    try:
        duration = float(json.loads(result.stdout)["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError) as err:
        raise TerminalError("the file declares no readable duration") from err
    if duration <= 0:
        raise TerminalError("the file contains no audio")
    return duration


def normalise(source: Path, destination: Path) -> None:
    """One-pass EBU R128 normalisation to mono MP3.

    ONE PASS, not two. Two-pass measures the whole file and then corrects it,
    which is more accurate for material with a wide loudness range; these are
    single words a second or two long, where the second pass refines a number
    that barely moves. It would double the ffmpeg time on every asset to buy
    precision nobody can hear.

    THE DOWNMIX RUNS BEFORE loudnorm, IN THE SAME CHAIN, and the order is the
    whole point rather than a stylistic choice. `-ac 1` is applied by the
    encoder after the filter graph, so loudnorm would measure and correct the
    stereo signal and the downmix would then change the level with nothing
    re-checking it. How far it moves depends on how correlated the channels
    are: a mono microphone written to a stereo file loses nothing, and
    genuinely stereo material loses up to 3 dB. Measured on staging before the
    fix, from a -33.0 LUFS source: channel-identical stereo delivered -16.4,
    decorrelated stereo delivered -19.4 against the same -16.0 target.

    That failure is silent — the asset reaches READY and sounds correct in
    isolation. What it costs is the one thing normalisation exists to buy,
    which is that two entries play back at the same volume.
    """
    result = _run(
        [
            "ffmpeg",
            "-nostdin",
            "-y",
            "-i",
            str(source),
            "-af",
            "aformat=channel_layouts=mono"
            f",loudnorm=I={config.LOUDNESS_TARGET_LUFS}"
            f":TP={config.LOUDNESS_TRUE_PEAK_DB}"
            f":LRA={config.LOUDNESS_RANGE}",
            "-c:a",
            "libmp3lame",
            "-b:a",
            config.AUDIO_BITRATE,
            str(destination),
        ]
    )
    if result.returncode != 0:
        raise TerminalError(f"ffmpeg could not transcode this file: {result.stderr.strip()[:500]}")
    if not destination.exists() or destination.stat().st_size == 0:
        raise TerminalError("ffmpeg produced no output")
