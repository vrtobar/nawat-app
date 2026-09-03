import json
import shutil
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from media_consumer import audio, config

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _argv_for(tmp_path: Path) -> list[str]:
    """The command normalise would run, without running it."""
    with patch.object(audio, "_run") as run:
        run.return_value = subprocess.CompletedProcess([], 0, "", "")
        destination = tmp_path / "out.mp3"
        destination.write_bytes(b"x")  # the post-run existence check
        audio.normalise(tmp_path / "in.mp3", destination)
    return run.call_args[0][0]


class TestFilterOrder:
    # These run everywhere. The behavioural tests below need ffmpeg, which the
    # CI Python job does not install, so this is what actually guards the
    # regression on a pull request.

    def test_the_downmix_precedes_loudnorm_in_the_chain(self, tmp_path):
        # THE BUG THIS EXISTS FOR: with the downmix expressed as `-ac 1`, the
        # encoder applies it AFTER the filter graph, so loudnorm measures the
        # stereo signal and the downmix then moves the level with nothing
        # re-checking it. Delivered output missed the target by up to 3 dB on
        # decorrelated stereo, silently.
        argv = _argv_for(tmp_path)
        chain = argv[argv.index("-af") + 1]

        assert "loudnorm" in chain
        assert "aformat=channel_layouts=mono" in chain
        assert chain.index("aformat") < chain.index("loudnorm")

    def test_the_channel_count_is_not_left_to_the_encoder(self, tmp_path):
        # `-ac 1` alongside the chain would work, but it would put the channel
        # count in two places and invite the ordering back.
        assert "-ac" not in _argv_for(tmp_path)

    def test_the_target_comes_from_config(self, tmp_path):
        chain = _argv_for(tmp_path)[_argv_for(tmp_path).index("-af") + 1]
        assert f"I={config.LOUDNESS_TARGET_LUFS}" in chain


def _sine(path: Path, *, left: int, right: int, gain_db: int = -14) -> Path:
    """A stereo file whose channels are as correlated as the frequencies match."""
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency={left}:duration=3",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency={right}:duration=3",
            "-filter_complex",
            f"[0:a][1:a]join=inputs=2:channel_layout=stereo,volume={gain_db}dB",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
            str(path),
        ],
        check=True,
    )
    return path


def _measured_lufs(path: Path) -> float:
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(path),
            "-filter_complex",
            "ebur128",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    for line in result.stderr.splitlines():
        if line.strip().startswith("I:"):
            return float(line.split()[1])
    raise AssertionError("ebur128 reported no integrated loudness")


def _channels(path: Path) -> int:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=channels", "-of", "json", str(path)],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)["streams"][0]["channels"]


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg and ffprobe are not on PATH")
class TestDeliveredLoudness:
    # Within 1 LU of target. One-pass loudnorm is not exact and is not meant to
    # be — the tolerance is wide enough not to be brittle and far tighter than
    # the 3 dB the ordering bug cost.
    TOLERANCE = 1.0

    def test_decorrelated_stereo_reaches_the_target(self, tmp_path):
        # The case the old order got wrong. 440 against 443 Hz is barely
        # stereo and was already enough to lose the full 3 dB.
        source = _sine(tmp_path / "in.mp3", left=440, right=443)
        destination = tmp_path / "out.mp3"

        audio.normalise(source, destination)

        assert abs(_measured_lufs(destination) - config.LOUDNESS_TARGET_LUFS) <= self.TOLERANCE

    def test_channel_identical_stereo_reaches_the_target(self, tmp_path):
        # A mono microphone written to a stereo file — the case that passed
        # under the old order, kept so a fix cannot trade one for the other.
        source = _sine(tmp_path / "in.mp3", left=440, right=440)
        destination = tmp_path / "out.mp3"

        audio.normalise(source, destination)

        assert abs(_measured_lufs(destination) - config.LOUDNESS_TARGET_LUFS) <= self.TOLERANCE

    def test_the_output_is_mono(self, tmp_path):
        source = _sine(tmp_path / "in.mp3", left=440, right=443)
        destination = tmp_path / "out.mp3"

        audio.normalise(source, destination)

        assert _channels(destination) == 1
