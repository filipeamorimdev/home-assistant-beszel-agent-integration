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


TRUENAS_ITEM = {
    "stats": {
        "cpub": [1, 2, 3, 0, 90, 0.5, 0.25, 0],
        "wf": {"wlan0": -50},
        "efs": {"media": {"d": 100, "du": 40, "tr": 5000, "tw": 0, "dios": [1, 2, 3, 4, 5, 6]}},
        "z": {"tank": {"n": "Tank", "d": 10, "du": 5, "h": "ONLINE"}},
        "g": {"0": {"n": "Arc", "u": 5, "e": {"Render": 12.5}}},
    },
    "info": {"pu": [3, 0], "ct": 2, "wf": {"wlan0": {"s": "Home", "r": -50}}},
    "details": {"sockets": 0},
    "smart": {
        "a1": {
            "name": "/dev/sda",
            "state": "PASSED",
            "temp": 34,
            "capacity": 4000787030016,
            "model": "WDC WD40EFRX",
            "attributes": [
                {"n": "Power_On_Hours", "rv": 12345},
                {"n": "Power_Cycle_Count", "rv": 50},
                {"n": "Reallocated_Sector_Ct", "rv": 0},
            ],
        },
        "b2": {"name": "/dev/nvme0", "state": "FAILED", "temp": 0, "attributes": []},
    },
    "zfs": {
        "tank": {
            "name": "tank",
            "display_name": "",
            "status": "",
            "scrub": {"state": "FINISHED", "progress": ""},
            "vdevs": [
                {"name": "tank", "state": "ONLINE"},
                {"name": "sda", "state": "DEGRADED", "readErrs": 2, "checksumErrs": 1},
            ],
            "datasets": [{"name": "tank/media", "used": 100}],
        }
    },
    "containers": {
        "web": {"status": "Up 3 hours", "health": 2, "cpu": 0, "memory": 120.5, "net": 2048, "updatable": True},
        "db": {"status": "Exited (0) 2 days ago", "health": 3, "cpu": 0, "memory": 0, "net": 0, "updatable": False},
    },
    "services": {"nginx.service": {"state": 2, "sub": 3, "cpu": 0.5, "memory": 1048576}},
    "monitors": {
        "m1": {"target": "1.1.1.1", "protocol": "icmp", "res": 12500, "loss1h": 0, "enabled": True, "certInfo": None},
        "m2": {"target": "example.com", "protocol": "http", "res": 0, "loss1h": 100, "enabled": True, "certInfo": {"expires": 1767225600000}},
        "m3": {"target": "nas", "protocol": "tcp", "port": 22, "res": 900, "loss1h": 0, "enabled": False},
    },
    "alerts": {"CPU": {"triggered": True}, "Status": {"triggered": False}},
}


def hexed(value):
    return value.encode().hex()


class ExpandedSourceTests(unittest.TestCase):
    def values(self, item=TRUENAS_ITEM):
        m = load_metrics(PACKAGES[0])
        descriptors = list(m.metrics(item))
        self.assertEqual(len({d.key for d in descriptors}), len(descriptors))
        return {d.key: d.value(item) for d in descriptors}, {d.key: d for d in descriptors}

    def test_stats_and_info_fields(self):
        values, _ = self.values()
        self.assertEqual(values["package_updates"], 3)
        self.assertEqual(values["security_updates"], 0)  # real zero
        self.assertEqual(values["system_connection"], "WebSocket")
        self.assertIsNone(values["system_sockets"])  # 0 means unknown
        self.assertEqual(values["cpu_irq"], 0.5)
        self.assertEqual(values["cpu_nice"], 0)
        self.assertEqual(values[f"wifi_{hexed('wlan0')}_signal"], -50)
        self.assertEqual(values[f"wifi_{hexed('wlan0')}_ssid"], "Home")
        efs = f"efs_{hexed('media')}"
        self.assertEqual(values[f"{efs}_read_total"], 5000)
        self.assertEqual(values[f"{efs}_write_total"], 0)
        self.assertEqual(values[f"{efs}_utilization"], 3)
        self.assertEqual(values[f"gpu_{hexed('0')}_e_{hexed('Render')}"], 12.5)

    def test_zfs_display_name_keeps_unique_id(self):
        _, descriptors = self.values()
        total = descriptors[f"z_{hexed('tank')}_total"]
        self.assertEqual(total.name, "ZFS pool Tank total")

    def test_smart_devices(self):
        values, descriptors = self.values()
        sda, nvme = f"smart_{hexed('a1')}", f"smart_{hexed('b2')}"
        self.assertEqual(values[f"{sda}_health"], "PASSED")
        self.assertEqual(values[f"{sda}_temperature"], 34)
        self.assertEqual(values[f"{sda}_power_on_hours"], 12345)
        self.assertEqual(values[f"{sda}_power_cycles"], 50)
        self.assertEqual(values[f"{sda}_reallocated_sectors"], 0)
        self.assertEqual(values[f"{sda}_model"], "WDC WD40EFRX")
        self.assertIsNone(values[f"{nvme}_temperature"])  # 0 = not reported
        self.assertIsNone(values[f"{nvme}_power_on_hours"])  # never a fake 0
        self.assertEqual(values["smart_failed"], 1)
        self.assertEqual(descriptors[f"{sda}_health"].name, "Drive /dev/sda SMART health")
        self.assertTrue(descriptors[f"{sda}_temperature"].enabled)
        self.assertFalse(descriptors[f"{sda}_serial"].enabled)

    def test_zfs_pool_details(self):
        values, _ = self.values()
        pool = f"zp_{hexed('tank')}"
        self.assertEqual(values[f"{pool}_scrub_errors"], 0)
        self.assertEqual(values[f"{pool}_device_errors"], 3)
        self.assertEqual(values[f"{pool}_unhealthy_devices"], 1)
        self.assertEqual(values[f"{pool}_scrub_state"], "FINISHED")
        self.assertIsNone(values[f"{pool}_scrub_progress"])
        self.assertIsNone(values[f"{pool}_message"])
        self.assertEqual(values[f"{pool}_vdev_{hexed('sda')}_state"], "DEGRADED")
        self.assertEqual(values[f"{pool}_vdev_{hexed('sda')}_errors"], 3)
        self.assertEqual(values[f"{pool}_ds_{hexed('tank/media')}_used"], 100)
        self.assertEqual(values[f"{pool}_ds_{hexed('tank/media')}_available"], 0)

    def test_containers_and_services(self):
        values, descriptors = self.values()
        web = f"container_{hexed('web')}"
        self.assertEqual(values["containers_running"], 1)
        self.assertEqual(values["containers_unhealthy"], 1)
        self.assertEqual(values["container_updates"], 1)
        self.assertEqual(values[f"{web}_cpu"], 0)
        self.assertEqual(values[f"{web}_health"], "healthy")
        self.assertIs(values[f"{web}_update"], True)
        self.assertTrue(descriptors[f"{web}_update"].binary)
        self.assertFalse(descriptors[f"{web}_cpu"].enabled)
        nginx = f"service_{hexed('nginx.service')}"
        self.assertEqual(values[f"{nginx}_state"], "failed")
        self.assertEqual(values[f"{nginx}_sub_state"], "failed")
        self.assertEqual(values[f"{nginx}_memory"], 1048576)

    def test_monitors_and_alerts(self):
        values, descriptors = self.values()
        m1, m2, m3 = (f"monitor_{hexed(k)}" for k in ("m1", "m2", "m3"))
        self.assertEqual(values[f"{m1}_response"], 12.5)
        self.assertIsNone(values[f"{m2}_response"])
        self.assertEqual(values[f"{m2}_loss_1h"], 100)
        self.assertEqual(values[f"{m1}_loss_1h"], 0)
        self.assertEqual(values[f"{m2}_cert_expiry"].year, 2026)
        self.assertIsNone(values[f"{m1}_cert_expiry"])
        self.assertIsNone(values[f"{m3}_response"])  # disabled monitor
        self.assertEqual(descriptors[f"{m3}_response"].name, "Monitor TCP nas:22 response time")
        self.assertEqual(values["alerts_active"], 1)
        self.assertIs(values[f"alert_{hexed('CPU')}"], True)
        self.assertIs(values[f"alert_{hexed('Status')}"], False)
        self.assertFalse(descriptors["alerts_active"].live)

    def test_no_key_or_name_ends_in_a_core_suffix(self):
        _, descriptors = self.values()
        core = ("status", "battery", "uptime", "cpu_usage", "memory_usage",
                "disk_usage", "cpu_temperature", "agent_version", "gpu_usage")
        for key, metric in descriptors.items():
            slug = "_".join("".join(c if c.isalnum() else " " for c in metric.name.lower()).split())
            for suffix in core:
                self.assertFalse(key.endswith("_" + suffix), key)
                self.assertFalse(slug.endswith("_" + suffix), metric.name)

    def test_no_collections_means_no_values(self):
        values, _ = self.values({"stats": {}, "smart": {}, "containers": {"x": "bad"}})
        for key in ("smart_failed", "containers_running", "alerts_active"):
            self.assertIsNone(values[key])


if __name__ == "__main__":
    unittest.main()
