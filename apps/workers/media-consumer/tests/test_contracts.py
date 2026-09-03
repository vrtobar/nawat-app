import pytest

from media_consumer import contracts
from media_consumer.errors import TerminalError


class TestMessage:
    def test_accepts_the_shape_the_api_publishes(self):
        contracts.validate_message({"version": 1, "assetId": "med_1"})

    def test_rejects_an_unknown_version(self):
        with pytest.raises(TerminalError):
            contracts.validate_message({"version": 2, "assetId": "med_1"})

    def test_rejects_extra_fields(self):
        # The generated schema closes the object. A producer adding a field
        # without regenerating should fail here rather than be silently ignored.
        with pytest.raises(TerminalError):
            contracts.validate_message({"version": 1, "assetId": "med_1", "kind": "AUDIO"})


class TestDerivatives:
    def test_accepts_audio(self):
        contracts.validate_derivatives(
            {
                "primary": "audio.mp3",
                "files": [{"key": "audio.mp3", "contentType": "audio/mpeg", "bytes": 1}],
                "durationSec": 1.5,
            }
        )

    def test_accepts_images_with_widths(self):
        contracts.validate_derivatives(
            {
                "primary": "640.webp",
                "files": [
                    {"key": "320.webp", "contentType": "image/webp", "bytes": 1, "width": 320},
                    {"key": "640.webp", "contentType": "image/webp", "bytes": 2, "width": 640},
                ],
            }
        )

    def test_rejects_an_empty_file_list(self):
        with pytest.raises(TerminalError):
            contracts.validate_derivatives({"primary": "audio.mp3", "files": []})

    def test_rejects_a_missing_primary(self):
        with pytest.raises(TerminalError):
            contracts.validate_derivatives(
                {"files": [{"key": "a", "contentType": "audio/mpeg", "bytes": 1}]}
            )
