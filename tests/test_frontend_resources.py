"""Tests for Lovelace resource URL helpers."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


def load_helpers():
    path = (
        Path(__file__).parents[1]
        / "custom_components"
        / "beszel_machine_card"
        / "helpers.py"
    )
    spec = importlib.util.spec_from_file_location("beszel_helpers", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class LovelaceResourceHelperTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.helpers = load_helpers()

    def test_strips_query_string(self) -> None:
        self.assertEqual(
            self.helpers.lovelace_resource_path(
                "/beszel_machine_card/beszel-machine-card.js?v=0.6.6"
            ),
            "/beszel_machine_card/beszel-machine-card.js",
        )

    def test_detects_legacy_beszel_card_urls(self) -> None:
        self.assertTrue(
            self.helpers.is_legacy_lovelace_resource(
                "/beszel_card/beszel-card.js?v=0.2.0"
            )
        )
        self.assertTrue(
            self.helpers.is_legacy_lovelace_resource(
                "/beszel_card/beszel-overview-card.js?v=0.2.0"
            )
        )
        self.assertTrue(
            self.helpers.is_legacy_lovelace_resource(
                "/hacsfiles/beszel_card/beszel-card.js"
            )
        )
        self.assertFalse(
            self.helpers.is_legacy_lovelace_resource(
                "/beszel_machine_card/beszel-machine-card.js?v=0.6.6"
            )
        )
        self.assertFalse(
            self.helpers.is_legacy_lovelace_resource(
                "/beszel_machine_card/beszel-systems-table-card.js?v=0.6.6"
            )
        )

    def test_leaves_other_cards_with_the_same_file_name(self) -> None:
        for url in (
            "/local/beszel-card.js",
            "/hacsfiles/other-beszel/beszel-card.js?v=1",
            "/hacsfiles/someone/beszel-overview-card.js",
        ):
            self.assertFalse(self.helpers.is_legacy_lovelace_resource(url), url)

    def test_insecure_url_only_for_plain_http_outside_lan(self) -> None:
        insecure = self.helpers.is_insecure_remote_url
        self.assertTrue(insecure("http://beszel.example.com"))
        self.assertTrue(insecure("http://8.8.8.8:8090"))
        for url in (
            "https://beszel.example.com",
            "http://192.168.1.10:8090",
            "http://10.0.0.2",
            "http://127.0.0.1:8090",
            "http://[fd00::1]:8090",
            "http://beszel:8090",
            "http://beszel.local:8090",
            "http://nas.home.arpa",
        ):
            self.assertFalse(insecure(url), url)


if __name__ == "__main__":
    unittest.main()
