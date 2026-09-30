"""Render the native card with HA template-function doubles, without card JS.

Install tests/requirements-native.txt to run these template checks.
"""

from datetime import datetime
from html import unescape
from pathlib import Path
from types import SimpleNamespace
import unittest

try:
    import yaml
    from jinja2 import StrictUndefined
    from jinja2.sandbox import ImmutableSandboxedEnvironment
except ImportError:
    yaml = None


CARD = Path(__file__).resolve().parents[1] / (
    "custom_components/beszel_machine_card/frontend/beszel-native-terminal.yaml"
)


@unittest.skipIf(yaml is None, "Install tests/requirements-native.txt for native template checks")
class NativeTerminalTests(unittest.TestCase):
    def setUp(self):
        self.config = yaml.safe_load(CARD.read_text())
        self.ids = ["sensor.renamed", "sensor.state", "sensor.absent", "sensor.disabled", "binary_sensor.hub"]
        self.devices = {key: "machine" for key in self.ids}
        self.devices["binary_sensor.hub"] = "hub"
        self.names = {"machine": "NAS <script>alert(1)</script>", "hub": "Beszel Hub"}
        self.states = {
            "sensor.renamed": self.state("sensor.renamed", "CPU", "0", "%"),
            "sensor.state": self.state("sensor.state", "Status", "up"),
            "sensor.absent": self.state("sensor.absent", "Temperature", "unknown", "°C"),
            "binary_sensor.hub": self.state("binary_sensor.hub", "Connection", "on"),
            "sensor.unrelated": self.state("sensor.unrelated", "Unrelated", "999"),
        }

    @staticmethod
    def state(entity_id, name, value, unit=""):
        return SimpleNamespace(entity_id=entity_id, name=name, state=value,
                               attributes={"unit_of_measurement": unit})

    def render(self, target="", only=None):
        env = ImmutableSandboxedEnvironment(undefined=StrictUndefined)
        env.globals.update(
            now=datetime.now,
            integration_entities=lambda domain: self.ids if domain == "beszel_machine_card" else [],
            expand=lambda ids: [self.states[key] for key in ids if key in self.states],
            device_id=lambda key: self.devices.get(key),
            device_attr=lambda device, attr: self.names.get(device) if attr == "name" else None,
        )
        content = self.config["content"].replace("set target_entity = ''", f"set target_entity = {target!r}")
        if only is not None:
            content = content.replace("set only_entities = []", f"set only_entities = {only!r}")
        return env.from_string(content).render()

    def test_native_markup_escaping_and_values(self):
        self.assertEqual(self.config["type"], "markdown")
        rendered = self.render()
        self.assertTrue(rendered.startswith("<pre>"))
        self.assertTrue(rendered.endswith("</pre>"))
        self.assertIn("CPU: 0 %", rendered)
        self.assertIn("Temperature: \n", rendered)
        self.assertNotIn("°C", rendered)
        self.assertNotIn("Unrelated", rendered)
        self.assertNotIn("disabled", rendered)
        self.assertIn("Connection: on", rendered)
        self.assertIn("&lt;script&gt;", rendered)
        self.assertNotIn("<script>", rendered)
        self.assertNotRegex(rendered, r"<table|<ha-|<style|custom:|display:|var\(--")

    def test_select_device_by_renamed_entity_and_filter_metrics(self):
        rendered = self.render(target="sensor.renamed")
        self.assertIn("CPU: 0 %", rendered)
        self.assertIn("Status: up", rendered)
        self.assertNotIn("Beszel Hub", rendered)
        selected = self.render(only=["sensor.renamed"])
        self.assertIn("CPU: 0 %", selected)
        self.assertNotIn("Status:", selected)
        self.assertIn("No matching", self.render(target="sensor.invalid"))

    def test_offline_missing_values_and_new_devices(self):
        # HA's sensor platform blanks offline measurements; native output must
        # not convert those unknown readings to zero or retain previous values.
        self.states["sensor.renamed"].state = "unknown"
        self.states["sensor.state"].state = "down"
        rendered = self.render()
        self.assertIn("CPU: \n", rendered)
        self.assertIn("Status: down", rendered)
        self.assertNotIn("0 %", rendered)
        self.ids.append("sensor.new")
        self.devices["sensor.new"] = "second"
        self.names["second"] = "Second machine"
        self.states["sensor.new"] = self.state("sensor.new", "Memory", "12", "%")
        self.assertIn("Second machine", self.render())

    def test_untrusted_labels_values_and_units_are_text(self):
        entity = self.states["sensor.renamed"]
        entity.name = "CPU\n</pre><img src=x onerror=alert(1)>"
        entity.state = "<b>0</b>"
        entity.attributes["unit_of_measurement"] = "<script>unit</script>"
        rendered = self.render()
        self.assertEqual(rendered.count("</pre>"), 1)
        self.assertNotIn("<img", rendered)
        self.assertNotIn("<b>", rendered)
        self.assertIn("CPU </pre><img", unescape(rendered))


if __name__ == "__main__":
    unittest.main()
