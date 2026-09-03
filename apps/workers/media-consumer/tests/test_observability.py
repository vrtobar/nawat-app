import json
import logging
from unittest.mock import patch

import pytest

from media_consumer import handler, observability, reaper


class TestTheLevelSurvivesTheLambdaRuntime:
    # THESE TESTS RECONSTRUCT THE CONDITION RATHER THAN ASSUMING IT. Under a
    # bare pytest the root logger has no handler, so `logging.basicConfig` works
    # and a naive assertion about the level passes against the broken code too.
    # The runtime's bootstrap attaches a handler to root before importing the
    # handler module, which is exactly what makes basicConfig a no-op.

    @pytest.fixture
    def lambda_runtime(self):
        root = logging.getLogger()
        original_level, original_handlers = root.level, root.handlers[:]
        root.handlers = [logging.NullHandler()]
        root.setLevel(logging.WARNING)
        yield root
        root.handlers, root.level = original_handlers, original_level

    def test_info_is_enabled_even_though_root_is_at_warning(self, lambda_runtime):
        logger = observability.configure()

        assert logger.isEnabledFor(logging.INFO)
        # Set on the package logger, not on root — root is the runtime's and
        # writing to it would be undone by the next thing that configures it.
        assert lambda_runtime.level == logging.WARNING

    def test_the_level_is_overridable(self, lambda_runtime, monkeypatch):
        monkeypatch.setattr(observability, "LOG_LEVEL", "WARNING")

        assert not observability.configure().isEnabledFor(logging.INFO)

    def test_both_entrypoints_use_it(self):
        # A logger configured here but obtained by `logging.getLogger(__name__)`
        # in the module would inherit the level, so this checks the wiring the
        # fix actually depends on rather than the name.
        assert handler.logger.name == "media_consumer"
        assert reaper.logger.name == "media_consumer"


class TestTheEventIsMachineReadable:
    def test_the_whole_message_is_one_json_object(self, caplog):
        with caplog.at_level(logging.INFO, logger="media_consumer"):
            observability.log_event(observability.configure(), "media.processed", assetId="med_1")

        assert json.loads(caplog.messages[0]) == {"event": "media.processed", "assetId": "med_1"}


class TestTheConsumerRecordsWhatItDid:
    def _asset(self):
        return {
            "id": "med_1",
            "kind": "AUDIO",
            "status": "PENDING",
            "source_key": "source/med_1/source.mp3",
            "content_type": "audio/mpeg",
            "attempts": 0,
        }

    def _derivatives(self):
        return {
            "primary": "audio.mp3",
            "files": [{"key": "audio.mp3", "contentType": "audio/mpeg", "bytes": 4096}],
            "durationSec": 1.25,
        }

    def test_a_successful_invocation_leaves_one_line(self, caplog):
        with (
            patch.object(handler.db, "load_asset", return_value=self._asset()),
            patch.object(handler.db, "increment_attempts", return_value=2),
            patch.object(handler.db, "mark_ready"),
            patch.object(handler, "_process", return_value=self._derivatives()),
            patch.object(handler.contracts, "validate_derivatives"),
            caplog.at_level(logging.INFO, logger="media_consumer"),
        ):
            handler.process_record(
                {"messageId": "m", "body": json.dumps({"version": 1, "assetId": "med_1"})}
            )

        events = [json.loads(m) for m in caplog.messages if m.startswith("{")]
        processed = [e for e in events if e["event"] == "media.processed"]
        assert len(processed) == 1

        # The attempt number comes from the row rather than the SQS receive
        # count, so a redelivery is legible without opening the queue.
        assert processed[0]["attempt"] == 2
        assert processed[0]["assetId"] == "med_1"
        assert processed[0]["kind"] == "AUDIO"
        assert processed[0]["files"] == ["audio.mp3"]
        assert processed[0]["primary"] == "audio.mp3"
        assert processed[0]["bytes"] == 4096
        assert processed[0]["durationSec"] == 1.25
        assert "elapsedMs" in processed[0]

    def test_a_terminal_failure_records_no_success(self, caplog):
        from media_consumer.errors import TerminalError

        with (
            patch.object(handler.db, "load_asset", return_value=self._asset()),
            patch.object(handler.db, "increment_attempts", return_value=1),
            patch.object(handler.db, "mark_failed"),
            patch.object(handler, "_process", side_effect=TerminalError("bad file")),
            caplog.at_level(logging.INFO, logger="media_consumer"),
        ):
            handler.process_record(
                {"messageId": "m", "body": json.dumps({"version": 1, "assetId": "med_1"})}
            )

        assert not [m for m in caplog.messages if "media.processed" in m]


class TestTheReaperRecordsAQuietRun:
    def test_a_run_that_found_nothing_still_says_so(self, caplog):
        # The case the old summary silently dropped, and the one that matters:
        # almost every reaper run finds nothing, so "no output" and "never ran"
        # were indistinguishable.
        with (
            patch.object(reaper, "republish_stale", return_value=0),
            patch.object(reaper, "collect_abandoned", return_value=0),
            caplog.at_level(logging.INFO, logger="media_consumer"),
        ):
            reaper.handler()

        events = [json.loads(m) for m in caplog.messages if m.startswith("{")]
        assert [e for e in events if e["event"] == "media.reaped"] == [
            {
                "event": "media.reaped",
                "republished": 0,
                "collected": 0,
                "elapsedMs": events[0]["elapsedMs"],
            }
        ]
