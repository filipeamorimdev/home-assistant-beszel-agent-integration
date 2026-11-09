"""Focused entity/coordinator tests; HA interfaces are lightweight test doubles."""

import sys
import types
import unittest
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))  # for test_api


@dataclass(frozen=True, kw_only=True)
class Description:
    key: str
    name: str | None = None
    translation_key: str | None = None
    icon: str | None = None
    entity_category: str | None = None
    native_unit_of_measurement: str | None = None
    state_class: str | None = None
    device_class: str | None = None
    entity_registry_enabled_default: bool = True


class Coordinator:
    def __class_getitem__(cls, key):
        return cls

    def __init__(self, hass, *args, **kwargs):
        self.hass = hass
        self.data = {}
        self.last_update_success = True
        self.listeners = []

    def async_add_listener(self, fn):
        self.listeners.append(fn)
        return lambda: None

    def async_set_updated_data(self, data):
        self.data = data
        self.async_update_listeners()

    def async_update_listeners(self):
        for fn in self.listeners:
            fn()


class Entity:
    def __class_getitem__(cls, key):
        return cls

    def __init__(self, coordinator):
        self.coordinator = coordinator
        self.writes = 0

    def async_write_ha_state(self):
        self.writes += 1

    @property
    def available(self):
        return self.coordinator.last_update_success


def module(name, **attrs):
    return types.ModuleType(name) if not attrs else types.SimpleNamespace(**attrs)


def load_package(root, domain):
    stubs = {
        "homeassistant.components.sensor": module(
            "",
            SensorDeviceClass=types.SimpleNamespace(
                TEMPERATURE="temperature",
                DATA_RATE="data_rate",
                DURATION="duration",
                BATTERY="battery",
                ENUM="enum",
            ),
            SensorEntity=type("SensorEntity", (), {}),
            SensorEntityDescription=Description,
            SensorStateClass=types.SimpleNamespace(
                MEASUREMENT="measurement", TOTAL_INCREASING="total_increasing"
            ),
        ),
        "homeassistant.config_entries": module("", ConfigEntry=object),
        "homeassistant.const": module(
            "",
            PERCENTAGE="%",
            EntityCategory=types.SimpleNamespace(DIAGNOSTIC="diagnostic"),
            UnitOfDataRate=types.SimpleNamespace(BYTES_PER_SECOND="B/s"),
            UnitOfTemperature=types.SimpleNamespace(CELSIUS="°C"),
            UnitOfTime=types.SimpleNamespace(SECONDS="s"),
            Platform=types.SimpleNamespace(
                SENSOR="sensor", BINARY_SENSOR="binary_sensor"
            ),
        ),
        "homeassistant.core": module("", HomeAssistant=object, callback=lambda fn: fn),
        "homeassistant.helpers.device_registry": module("", DeviceInfo=dict),
        "homeassistant.helpers.entity_platform": module(
            "", AddConfigEntryEntitiesCallback=object
        ),
        "homeassistant.helpers.update_coordinator": module(
            "",
            CoordinatorEntity=Entity,
            DataUpdateCoordinator=Coordinator,
            UpdateFailed=type("UpdateFailed", (Exception,), {}),
        ),
        "homeassistant.exceptions": module(
            "", ConfigEntryAuthFailed=type("AuthFailed", (Exception,), {})
        ),
    }
    name = "test_host_" + domain
    package = types.ModuleType(name)
    package.__path__ = [str(root)]
    stubs[name] = package
    stubs["homeassistant.components.binary_sensor"] = module(
        "",
        BinarySensorDeviceClass=types.SimpleNamespace(CONNECTIVITY="connectivity"),
        BinarySensorEntity=type("BinarySensorEntity", (), {}),
    )
    # API behavior is tested in test_api; reuse its module (with a fake aiohttp).
    from test_api import API

    stubs[name + ".api"] = API
    with patch.dict(sys.modules, stubs):
        sensor = __import__(name + ".sensor", fromlist=["sensor"])
        coord = __import__(name + ".coordinator", fromlist=["coordinator"])
        binary = __import__(name + ".binary_sensor", fromlist=["binary_sensor"])
    sensor.binary = binary
    return sensor, coord


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    def packages(self):
        yield load_package(
            ROOT / "custom_components/beszel_machine_card", "beszel_machine_card"
        )

    async def test_dynamic_discovery_stable_ids_and_validation(self):
        for sensor, coord in self.packages():
            hass = types.SimpleNamespace(data={})
            coordinator = coord.BeszelDataUpdateCoordinator(hass, None)
            coordinator.data = {
                "s1": {
                    "record": {"status": "up", "name": "NAS"},
                    "info": {},
                    "stats": {"m": 4, "cpu": 0},
                }
            }
            hass.data[sensor.DOMAIN] = {"entry": coordinator}
            entry = types.SimpleNamespace(
                entry_id="entry",
                data={"url": "http://hub"},
                async_on_unload=lambda fn: None,
            )
            entities = []
            await sensor.async_setup_entry(hass, entry, entities.extend)
            self.assertEqual(len(entities), 17)
            self.assertEqual(len({e._attr_unique_id for e in entities}), 17)
            cpu = next(e for e in entities if e.entity_description.key == "cpu_usage")
            self.assertEqual(cpu._attr_unique_id, "s1_cpu_usage")
            self.assertEqual(cpu.native_value, 0)
            cpu._handle_coordinator_update()
            for _ in range(100):
                cpu._handle_coordinator_update()
            self.assertEqual(cpu.writes, 1)
            coordinator.last_update_success = False
            cpu._handle_coordinator_update()
            self.assertEqual(cpu.writes, 2)
            coordinator.last_update_success = True
            coordinator.async_update_listeners()
            self.assertEqual(len(entities), 17)
            coordinator.async_set_updated_data(
                {
                    "s1": {
                        **coordinator.data["s1"],
                        "stats": {"cpu": 0, "m": 4, "f": {"fan": 1234}},
                    }
                }
            )
            self.assertEqual(len(entities), 18)
            self.assertEqual(entities[-1].native_value, 1234)
            coordinator.data["s1"]["stats"]["cpu"] = float("nan")
            self.assertIsNone(cpu.native_value)
            coordinator.data["s1"]["stats"]["cpu"] = 101
            self.assertIsNone(cpu.native_value)
            coordinator.data["s1"]["stats"]["cpu"] = 50
            coordinator.data["s1"]["record"]["status"] = "down"
            self.assertIsNone(cpu.native_value)

            status = next(e for e in entities if e.entity_description.key == "status")
            coordinator.data["s1"]["record"].update(host="10.0.0.2", status="up")
            coordinator.data["s1"]["details"] = {"threads": 8, "cores": 4}
            self.assertEqual(
                status.extra_state_attributes,
                {"threads": 8, "cores": 4},  # agent host/port never exposed
            )
            coordinator.data["s1"]["details"] = {}
            coordinator.data["s1"]["info"] = {"t": 16, "c": 0}
            self.assertEqual(status.extra_state_attributes["threads"], 16)
            self.assertNotIn("cores", status.extra_state_attributes)
            coordinator.data["s1"]["record"]["status"] = "rebooting"
            self.assertIsNone(status.native_value)  # never an invalid ENUM option

    async def test_realtime_preserves_details_and_rejects_old_stats(self):
        for sensor, coord in self.packages():
            coordinator = coord.BeszelDataUpdateCoordinator(
                types.SimpleNamespace(), None
            )
            coordinator.data = {
                "s1": {
                    "record": {"status": "up"},
                    "info": {},
                    "details": {"hostname": "NAS"},
                    "stats": {"cpu": 1},
                    "stats_created": "2026-09-20 12:00:00Z",
                }
            }
            coordinator._handle_realtime_event(
                "systems/*",
                {
                    "action": "update",
                    "record": {
                        "id": "s1",
                        "status": "up",
                        "info": {"cpu": 2},
                        "updated": "2026-09-20 12:00:05Z",
                    },
                },
            )
            self.assertEqual(coordinator.data["s1"]["details"]["hostname"], "NAS")
            self.assertEqual(
                sensor._stats_or_info(coordinator.data["s1"], "cpu", "cpu"), 2
            )
            coordinator._handle_realtime_event(
                "system_stats/*",
                {
                    "action": "create",
                    "record": {
                        "system": "s1",
                        "type": "1m",
                        "stats": {"cpu": 99},
                        "created": "2026-09-20 11:00:00Z",
                    },
                },
            )
            self.assertEqual(coordinator.data["s1"]["stats"]["cpu"], 1)
            coordinator._realtime_activity.clear()
            coordinator._handle_realtime_event(
                "system_stats/*",
                {
                    "action": "create",
                    "record": {
                        "system": "s1",
                        "type": "1h",
                        "stats": {"cpu": 99},
                    },
                },
            )
            self.assertFalse(coordinator._realtime_activity.is_set())
            coordinator._handle_realtime_event(
                "system_details/*",
                {
                    "action": "update",
                    "record": {
                        "system": "s1",
                        "hostname": "NEW",
                    },
                },
            )
            self.assertEqual(coordinator.data["s1"]["details"]["hostname"], "NEW")


class ExpandedRuntimeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.sensor, self.coord = load_package(
            ROOT / "custom_components/beszel_machine_card", "beszel_machine_card"
        )

    def system(self):
        return {
            "record": {"status": "up", "name": "NAS"},
            "info": {},
            "stats": {"cpu": 1},
            "containers": {"web": {"status": "Up", "cpu": 5, "updatable": True}},
            "alerts": {"Status": {"system": "s1", "name": "Status", "triggered": False}},
            "smart": {},
        }

    async def setup_entities(self):
        hass = types.SimpleNamespace(data={})
        coordinator = self.coord.BeszelDataUpdateCoordinator(hass, None)
        coordinator.data = {"s1": self.system()}
        hass.data[self.sensor.DOMAIN] = {"entry": coordinator}
        entry = types.SimpleNamespace(
            entry_id="entry",
            data={"url": "http://hub"},
            async_on_unload=lambda fn: None,
        )
        sensors, binaries = [], []
        await self.sensor.async_setup_entry(hass, entry, sensors.extend)
        await self.sensor.binary.async_setup_entry(hass, entry, binaries.extend)
        by_key = {e.entity_description.key: e for e in sensors}
        binary_by_key = {
            getattr(e, "_metric", None) and e._metric.key: e for e in binaries
        }
        return coordinator, by_key, binary_by_key, binaries

    async def test_binary_metrics_and_offline_rules(self):
        coordinator, sensors, binaries, binary_list = await self.setup_entities()
        alert = binaries["alert_" + b"Status".hex()]
        update = binaries["container_" + b"web".hex() + "_update"]
        self.assertIs(alert.is_on, False)
        self.assertIs(update.is_on, True)
        self.assertEqual(alert._attr_device_class, "problem")
        self.assertEqual(alert._attr_unique_id, "s1_alert_" + b"Status".hex())
        self.assertEqual(sensors["alerts_active"].native_value, 0)
        cpu = sensors["container_" + b"web".hex() + "_cpu"]
        self.assertEqual(cpu.native_value, 5)

        coordinator.data["s1"]["record"]["status"] = "down"
        coordinator.data["s1"]["alerts"]["Status"]["triggered"] = True
        # Beszel's own alerts must keep reporting while the machine is down.
        self.assertIs(alert.is_on, True)
        self.assertEqual(sensors["alerts_active"].native_value, 1)
        # Readings sampled by the agent go blank instead of staying "current".
        self.assertIsNone(update.is_on)
        self.assertIsNone(cpu.native_value)

        count = len(binary_list)
        coordinator.async_set_updated_data(
            {
                "s1": {
                    **coordinator.data["s1"],
                    "alerts": {
                        **coordinator.data["s1"]["alerts"],
                        "CPU": {"triggered": False},
                    },
                }
            }
        )
        self.assertEqual(len(binary_list), count + 1)

    async def test_realtime_smart_events_and_extras_merge(self):
        coordinator = self.coord.BeszelDataUpdateCoordinator(
            types.SimpleNamespace(), None
        )
        coordinator.data = {"s1": self.system(), "s2": self.system()}
        record = {"id": "d1", "system": "s1", "name": "/dev/sda", "state": "PASSED"}
        coordinator._handle_realtime_event(
            "smart_devices/d1", {"action": "create", "record": record}
        )
        self.assertEqual(coordinator.data["s1"]["smart"]["d1"]["state"], "PASSED")
        self.assertTrue(coordinator._realtime_activity.is_set())
        coordinator._handle_realtime_event(
            "smart_devices/d1", {"action": "delete", "record": record}
        )
        self.assertEqual(coordinator.data["s1"]["smart"], {})
        # Unknown systems are ignored rather than creating partial devices.
        coordinator._handle_realtime_event(
            "zfs_pools/x", {"action": "update", "record": {"system": "nope", "name": "tank"}}
        )
        self.assertNotIn("nope", coordinator.data)

        s2 = coordinator.data["s2"]
        coordinator.apply_extras(
            {"containers": {"s1": {"web": {"status": "Exited"}}, "s2": s2["containers"]}}
        )
        self.assertEqual(coordinator.data["s1"]["containers"]["web"]["status"], "Exited")
        self.assertIs(coordinator.data["s2"], s2)  # unchanged system keeps identity


class SafetyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        _sensor, self.coord = load_package(
            ROOT / "custom_components/beszel_machine_card", "beszel_machine_card"
        )

    def make(self, client):
        coordinator = self.coord.BeszelDataUpdateCoordinator(
            types.SimpleNamespace(data={}), client, "entry"
        )
        coordinator.cleanups = []
        coordinator._async_cleanup_stale_devices = coordinator.cleanups.append
        return coordinator

    async def test_empty_hub_answer_keeps_devices(self):
        class Client:
            data = {}

            async def async_get_data(self):
                return self.data

        client = Client()
        coordinator = self.make(client)
        await coordinator._async_update_data()
        self.assertEqual(coordinator.cleanups, [])

        client.data = {"s1": {}}
        await coordinator._async_update_data()
        self.assertEqual(coordinator.cleanups, [{"s1"}])

    async def test_realtime_survives_unexpected_errors(self):
        import asyncio

        class Client:
            calls = 0

            async def async_listen_realtime(self, *_args):
                self.calls += 1
                if self.calls == 1:
                    raise ValueError("Chunk too big")
                raise asyncio.CancelledError

        client = Client()
        coordinator = self.make(client)

        async def no_refresh():
            return None

        coordinator.async_request_refresh = no_refresh
        with patch.object(self.coord.asyncio, "sleep", new=lambda _s: no_refresh()):
            with self.assertRaises(asyncio.CancelledError), self.assertLogs(
                self.coord._LOGGER, "WARNING"
            ):
                await coordinator.async_listen_realtime()
        self.assertEqual(client.calls, 2)
