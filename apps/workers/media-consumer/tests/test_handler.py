import json
from unittest.mock import patch

import pytest

from media_consumer import handler
from media_consumer.errors import TerminalError, TransientError


def record(asset_id: str = "med_1", version: int = 1) -> dict:
    return {
        "messageId": "msg_1",
        "body": json.dumps({"version": version, "assetId": asset_id}),
    }


def asset(**overrides) -> dict:
    return {
        "id": "med_1",
        "kind": "AUDIO",
        "status": "PENDING",
        "source_key": "source/med_1/source.mp3",
        "content_type": "audio/mpeg",
        "attempts": 0,
        **overrides,
    }


DERIVATIVES = {
    "primary": "audio.mp3",
    "files": [{"key": "audio.mp3", "contentType": "audio/mpeg", "bytes": 4096}],
    "durationSec": 1.25,
}


class TestDiscardsWithoutWork:
    def test_a_body_that_is_not_json(self):
        with patch.object(handler.db, "load_asset") as load:
            handler.process_record({"messageId": "m", "body": "not json"})

        load.assert_not_called()

    def test_an_asset_that_no_longer_exists(self):
        with (
            patch.object(handler.db, "load_asset", return_value=None),
            patch.object(handler.db, "increment_attempts") as bump,
        ):
            handler.process_record(record())

        bump.assert_not_called()

    def test_an_asset_already_READY(self):
        # A redelivery after the work succeeded and the ack was lost. Repeating
        # it would be harmless but pointless.
        with (
            patch.object(handler.db, "load_asset", return_value=asset(status="READY")),
            patch.object(handler.db, "increment_attempts") as bump,
        ):
            handler.process_record(record())

        bump.assert_not_called()

    def test_a_message_from_an_unknown_version_is_terminal(self):
        # Terminal, not transient: the producer will not publish a different
        # message on redelivery.
        with pytest.raises(TerminalError):
            handler.process_record(record(version=99))


class TestFailureModel:
    def test_a_terminal_failure_marks_FAILED_and_acknowledges(self):
        with (
            patch.object(handler.db, "load_asset", return_value=asset()),
            patch.object(handler.db, "increment_attempts", return_value=1),
            patch.object(handler, "_process", side_effect=TerminalError("not audio")),
            patch.object(handler.db, "mark_failed") as failed,
        ):
            handler.process_record(record())

        failed.assert_called_once()
        assert "not audio" in failed.call_args[0][1]

    def test_a_transient_failure_under_the_ceiling_is_raised_for_redelivery(self):
        with (
            patch.object(handler.db, "load_asset", return_value=asset()),
            patch.object(handler.db, "increment_attempts", return_value=1),
            patch.object(handler, "_process", side_effect=TransientError("s3 is unhappy")),
            patch.object(handler.db, "mark_failed") as failed,
        ):
            with pytest.raises(TransientError):
                handler.process_record(record())

        # Crucially NOT marked failed — the asset is still expected to succeed.
        failed.assert_not_called()

    def test_a_transient_failure_at_the_ceiling_marks_FAILED_instead_of_dead_lettering(self):
        # This is the whole point of `attempts` living on the row: the give-up
        # leaves an explanation where a reviewer reads it, rather than a message
        # in a queue nobody is watching.
        with (
            patch.object(handler.db, "load_asset", return_value=asset()),
            patch.object(handler.db, "increment_attempts", return_value=3),
            patch.object(handler, "_process", side_effect=TransientError("s3 is unhappy")),
            patch.object(handler.db, "mark_failed") as failed,
        ):
            handler.process_record(record())

        assert "gave up after 3 attempts" in failed.call_args[0][1]

    def test_AWAITING_UPLOAD_is_transient_rather_than_the_contributors_fault(self):
        # Unreachable if the API publishes after the PENDING commit. If it ever
        # happens the ordering is wrong, and that deserves a dead letter rather
        # than a FAILED row implying a bad upload.
        with (
            patch.object(handler.db, "load_asset", return_value=asset(status="AWAITING_UPLOAD")),
            patch.object(handler.db, "mark_failed") as failed,
        ):
            with pytest.raises(TransientError):
                handler.process_record(record())

        failed.assert_not_called()


class TestSuccess:
    def test_validates_derivatives_before_writing_them(self):
        # The reader is the approval gate, in another language and process. By
        # the time it meets a bad shape a reviewer is already looking.
        with (
            patch.object(handler.db, "load_asset", return_value=asset()),
            patch.object(handler.db, "increment_attempts", return_value=1),
            patch.object(handler, "_process", return_value={"primary": "audio.mp3"}),
            patch.object(handler.db, "mark_ready") as ready,
        ):
            with pytest.raises(TerminalError):
                handler.process_record(record())

        ready.assert_not_called()

    def test_marks_ready_with_the_derivatives(self):
        with (
            patch.object(handler.db, "load_asset", return_value=asset()),
            patch.object(handler.db, "increment_attempts", return_value=1),
            patch.object(handler, "_process", return_value=DERIVATIVES),
            patch.object(handler.db, "mark_ready") as ready,
        ):
            handler.process_record(record())

        ready.assert_called_once_with("med_1", DERIVATIVES)


class TestBatchResponse:
    def test_a_failing_record_is_reported_rather_than_raised(self):
        # One bad message must not redeliver the ones beside it.
        with patch.object(handler, "process_record", side_effect=TransientError("nope")):
            result = handler.handler({"Records": [record()]})

        assert result == {"batchItemFailures": [{"itemIdentifier": "msg_1"}]}

    def test_a_clean_batch_reports_nothing(self):
        with patch.object(handler, "process_record"):
            result = handler.handler({"Records": [record()]})

        assert result == {"batchItemFailures": []}
