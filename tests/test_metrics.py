"""Regression coverage for both packages using captured Beszel field shapes."""

import importlib.util
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = [ROOT / "custom_components/beszel_machine_card"]


def load_metrics(root):
    name = root.name + "_metrics_test"
    spec = importlib.util.spec_from_file_location(name, root / "metrics.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class MetricTests(unittest.TestCase):
    def test_validation_preserves_zero_and_counter_precision(self):
        for root in PACKAGES:
            m = load_metrics(root)
            for invalid in (
                None,
                True,
                "",
                "unknown",
                "1",
                math.inf,
                -math.inf,
                math.nan,
            ):
                self.assertIsNone(m.number(invalid))
            self.assertEqual(m.number(0), 0)
            self.assertEqual(m.number(2**60 + 1), 2**60 + 1)
            self.assertIsNone(m.Metric("x", "X", ("v",), "%").value({"v": 101}))
            self.assertIsNone(m.Metric("x", "X", ("v",), "B").value({"v": -1}))

    def test_temperature_prefers_beszel_dashboard_value(self):
        for root in PACKAGES:
            m = load_metrics(root)
            probes = {"stats": {"t": {"coretemp_package_id_0": 68.25}}}
            self.assertEqual(m.temperature({**probes, "info": {"dt": 61.5}}), 61.5)
            self.assertEqual(m.temperature({**probes, "info": {"dt": None}}), 68.25)
            self.assertEqual(m.temperature({**probes, "info": {"dt": 999}}), 68.25)
            self.assertEqual(m.temperature({"info": {"dt": 0}}), 0)

    def test_cpu_temperature_does_not_select_rp1_or_drive(self):
        for root in PACKAGES:
            m = load_metrics(root)
            self.assertEqual(
                m.temperature(
                    {
                        "stats": {
                            "t": {
                                "cpu_thermal": 54.55,
                                "rp1_adc": 57.22,
                                "drivetemp": 70,
                            }
                        }
                    }
                ),
                54.55,
            )
            self.assertIsNone(m.temperature({"stats": {"t": {"drivetemp": 35}}}))
            self.assertEqual(
                m.temperature({"stats": {"t": {"k10temp_tctl": 69.63}}}), 69.63
            )

    def test_network_prefers_bytes_and_converts_legacy(self):
        for root in PACKAGES:
            m = load_metrics(root)
            self.assertEqual(m.network({"stats": {"b": [0, 4585], "ns": 1}}, 0), 0)
            self.assertEqual(m.network({"stats": {"nr": 1}}, 1), 1048576)
            self.assertIsNone(m.network({"stats": {"b": "invalid"}}, 1))

    def test_captured_home_assistant_metrics(self):
        item = {
            "stats": {
                "cpu": 0.61,
                "m": 3.9,
                "mu": 1.65,
                "mp": 42.23,
                "mb": 1.42,
                "s": 1.29,
                "su": 0.06,
                "d": 116.6,
                "du": 36.24,
                "t": {"cpu_thermal": 54.55, "rp1_adc": 57.22},
                "ni": {"end0": [19471, 3659, 19646635104, 18815213085]},
                "dio": [30105, 232379],
                "diot": [5772904960, 17065509888],
                "cpub": [0.44, 0.16, 0.31, 0, 99.08],
                "cpus": [1, 1, 1, 1],
                "dios": [0.36, 118.85, 5.32, 0.66, 48.05, 119.21],
                "f": {"pwmfan_fan1": 2375},
            },
            "details": {"hostname": "home-assistant", "cores": 4},
        }
        for root in PACKAGES:
            m = load_metrics(root)
            descriptors = list(m.metrics(item))
            values = {metric.key: metric.value(item) for metric in descriptors}
            self.assertEqual(values["disk_read_speed"], 30105)
            self.assertAlmostEqual(values["disk_free"], 80.36)
            self.assertEqual(values["disk_write_time"], 118.85)
            self.assertEqual(values["system_hostname"], "home-assistant")
            self.assertEqual(values["cpu_iowait"], 0.31)
            self.assertEqual(values["disk_write_latency"], 48.05)
            self.assertEqual(values["f_" + b"pwmfan_fan1".hex()], 2375)
            self.assertEqual(len(values), len(descriptors))
            self.assertGreater(len([v for v in values.values() if v is not None]), 30)
            self.assertFalse(
                next(d for d in descriptors if d.key == "cpu_core_0").enabled
            )

    def test_missing_malformed_and_zero_denominators(self):
        for root in PACKAGES:
            m = load_metrics(root)
            for item in (
                {},
                {"stats": None},
                {"stats": {"cpus": {}, "t": [], "ni": 2, "g": "x"}},
            ):
                self.assertTrue(all(d.value(item) is None for d in m.metrics(item)))
            item = {"stats": {"s": 0, "su": 0, "m": 0}}
            values = {d.key: d.value(item) for d in m.metrics(item)}
            self.assertIsNone(values["swap_usage"])
            self.assertEqual(values["swap_used"], 0)
            self.assertEqual(values["memory_total"], 0)

    def test_dynamic_names_do_not_collide(self):
        for root in PACKAGES:
            m = load_metrics(root)
            item = {"stats": {"t": {"a-b": 1, "a_b": 2, "a b": 3}}}
            metrics = [d for d in m.metrics(item) if d.value(item) is not None]
            self.assertEqual(len({d.key for d in metrics}), 3)


if __name__ == "__main__":
    unittest.main()
