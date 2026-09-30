"""Focused entity/coordinator tests; HA interfaces are lightweight test doubles."""

import sys
import types
import unittest
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


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
    # API behavior is tested separately; coordinator needs only exception types.
    error = type("ApiError", (Exception,), {})
    stubs[name + ".api"] = module(
        "",
        BeszelApiClient=object,
        BeszelApiError=error,
        BeszelAuthError=type("AuthError", (error,), {}),
    )
    with patch.dict(sys.modules, stubs):
        sensor = __import__(name + ".sensor", fromlist=["sensor"])
        coord = __import__(name + ".coordinator", fromlist=["coordinator"])
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
                {"host": "10.0.0.2", "threads": 8, "cores": 4},
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
