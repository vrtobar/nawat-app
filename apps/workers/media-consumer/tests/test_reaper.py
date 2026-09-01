from unittest.mock import patch

from media_consumer import reaper
from media_consumer.errors import TransientError


class TestRepublishStale:
    def test_does_nothing_when_nothing_is_stale(self):
        with (
            patch.object(reaper.db, "stale_pending", return_value=[]),
            patch.object(reaper.queue, "publish_media_processing") as publish,
        ):
            assert reaper.republish_stale() == 0

        publish.assert_not_called()

    def test_republishes_each_stale_asset(self):
        with (
            patch.object(reaper.db, "stale_pending", return_value=["med_1", "med_2"]),
            patch.object(reaper.queue, "publish_media_processing") as publish,
        ):
            assert reaper.republish_stale() == 2

        assert publish.call_count == 2

    def test_one_failure_does_not_abandon_the_rest_of_the_batch(self):
        # The failed one is untouched, so it is still stale and the next run
        # selects it again.
        with (
            patch.object(reaper.db, "stale_pending", return_value=["med_1", "med_2"]),
            patch.object(
                reaper.queue,
                "publish_media_processing",
                side_effect=[TransientError("sqs down"), None],
            ),
        ):
            assert reaper.republish_stale() == 1

    def test_does_not_touch_rows_the_consumer_has_already_received(self):
        # Enforced in SQL rather than here: the query filters attempts = 0, so
        # this asserts the reaper asks for that and nothing more.
        with (
            patch.object(reaper.db, "stale_pending", return_value=[]) as query,
            patch.object(reaper.queue, "publish_media_processing"),
        ):
            reaper.republish_stale()

        query.assert_called_once_with(
            reaper.config.STALE_PENDING_MINUTES, reaper.config.REAP_BATCH_LIMIT
        )


class TestCollectAbandoned:
    def test_does_nothing_when_nothing_is_abandoned(self):
        with (
            patch.object(reaper.db, "abandoned_uploads", return_value=[]),
            patch.object(reaper.storage, "delete_source") as delete_object,
            patch.object(reaper.db, "delete_asset") as delete_row,
        ):
            assert reaper.collect_abandoned() == 0

        delete_object.assert_not_called()
        delete_row.assert_not_called()

    def test_deletes_the_object_before_the_row(self):
        # THE ORDER IS THE POINT. Row first, then a failure, leaves an object
        # no record points at: invisible, permanent, and paid for.
        order = []
        with (
            patch.object(
                reaper.db, "abandoned_uploads", return_value=[("med_1", "source/med_1/a.mp3")]
            ),
            patch.object(
                reaper.storage, "delete_source", side_effect=lambda _k: order.append("object")
            ),
            patch.object(reaper.db, "delete_asset", side_effect=lambda _i: order.append("row")),
        ):
            assert reaper.collect_abandoned() == 1

        assert order == ["object", "row"]

    def test_a_failed_object_delete_leaves_the_row_alone(self):
        # So the pair is retried together on the next run rather than the row
        # vanishing while its object survives.
        with (
            patch.object(
                reaper.db, "abandoned_uploads", return_value=[("med_1", "source/med_1/a.mp3")]
            ),
            patch.object(reaper.storage, "delete_source", side_effect=TransientError("s3 down")),
            patch.object(reaper.db, "delete_asset") as delete_row,
        ):
            assert reaper.collect_abandoned() == 0

        delete_row.assert_not_called()

    def test_one_failure_does_not_abandon_the_rest_of_the_batch(self):
        with (
            patch.object(
                reaper.db,
                "abandoned_uploads",
                return_value=[("med_1", "a"), ("med_2", "b")],
            ),
            patch.object(
                reaper.storage, "delete_source", side_effect=[TransientError("s3 down"), None]
            ),
            patch.object(reaper.db, "delete_asset"),
        ):
            assert reaper.collect_abandoned() == 1


class TestHandler:
    def test_reports_what_it_did(self):
        with (
            patch.object(reaper, "republish_stale", return_value=2),
            patch.object(reaper, "collect_abandoned", return_value=3),
        ):
            assert reaper.handler() == {"republished": 2, "collected": 3}

    def test_a_quiet_run_is_distinguishable_from_a_busy_one(self):
        with (
            patch.object(reaper, "republish_stale", return_value=0),
            patch.object(reaper, "collect_abandoned", return_value=0),
        ):
            assert reaper.handler() == {"republished": 0, "collected": 0}
