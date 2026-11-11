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


def call_later(hass, delay, action):
    """Record the retry instead of waiting; return its cancel function."""
    hass.timers.append((delay, action))
    return lambda: hass.timers.remove((delay, action))


class UpdateEntity:
    hass = None

    def async_schedule_update_ha_state(self, force_refresh=False):
        self.refresh_requests = getattr(self, "refresh_requests", 0) + 1

    _attr_available = True
    _attr_installed_version = None
    _attr_latest_version = None
    _attr_release_url = None

    async def async_added_to_hass(self):
        pass


class DeviceRegistry:
    def __init__(self, device=None):
        self.device = device
        self.updates = []

    def async_get_device(self, identifiers):
        return self.device

    def async_update_device(self, device_id, **changes):
        self.updates.append((device_id, changes))


DEVICE_REGISTRY = types.SimpleNamespace(
    DeviceInfo=dict, async_get=lambda hass: hass.device_registry
)


class EntityRegistry:
    """Entity registry double: entries keyed by entity ID."""

    def __init__(self):
        self.entries = {}
        self.created = 0

    def add(self, domain, unique_id, disabled_by=None):
        self.created += 1
        entity_id = f"{domain}.e{self.created}"
        self.entries[entity_id] = types.SimpleNamespace(
            entity_id=entity_id,
            domain=domain,
            unique_id=unique_id,
            disabled_by=disabled_by,
        )
        return entity_id

    def async_get_entity_id(self, domain, platform, unique_id):
        for entry in self.entries.values():
            if entry.domain == domain and entry.unique_id == unique_id:
                return entry.entity_id
        return None

    def async_get(self, entity_id):
        return self.entries.get(entity_id)

    def async_remove(self, entity_id):
        del self.entries[entity_id]


def _entity_registry(hass):
    if getattr(hass, "entity_registry", None) is None:
        hass.entity_registry = EntityRegistry()
    return hass.entity_registry


ENTITY_REGISTRY = types.SimpleNamespace(
    async_get=_entity_registry,
    async_entries_for_config_entry=lambda registry, entry_id: list(
        registry.entries.values()
    ),
    RegistryEntryDisabler=types.SimpleNamespace(INTEGRATION="integration", USER="user"),
)


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
                SENSOR="sensor", BINARY_SENSOR="binary_sensor", UPDATE="update"
            ),
        ),
        "homeassistant.core": module("", HomeAssistant=object, callback=lambda fn: fn),
        "homeassistant.helpers.device_registry": DEVICE_REGISTRY,
        "homeassistant.helpers.entity_registry": ENTITY_REGISTRY,
        "homeassistant.helpers": module(
            "", device_registry=DEVICE_REGISTRY, entity_registry=ENTITY_REGISTRY
        ),
        "homeassistant.components.update": module("", UpdateEntity=UpdateEntity),
        "homeassistant.helpers.event": module("", async_call_later=call_later),
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
        update = __import__(name + ".update", fromlist=["update"])
    sensor.binary = binary
    sensor.update = update
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


class DiscoveryCostTests(unittest.IsolatedAsyncioTestCase):
    """Discovery runs once per data change; vanished records are cleaned up."""

    def setUp(self):
        self.sensor, self.coord = load_package(
            ROOT / "custom_components/beszel_machine_card", "beszel_machine_card"
        )

    @staticmethod
    def system(containers):
        return {
            "record": {"status": "up", "name": "NAS"},
            "info": {},
            "stats": {"cpu": 1},
            "containers": {
                name: {"status": "Up", "cpu": 5, "updatable": False}
                for name in containers
            },
        }

    async def setup(self, registry=None):
        hass = types.SimpleNamespace(data={}, entity_registry=registry)
        coordinator = self.coord.BeszelDataUpdateCoordinator(hass, None)
        coordinator.data = {"s1": self.system(["web", "job"])}
        hass.data[self.sensor.DOMAIN] = {"entry": coordinator}
        entry = types.SimpleNamespace(
            entry_id="entry",
            data={"url": "http://hub"},
            async_on_unload=lambda fn: None,
        )
        sensors, binaries = [], []
        await self.sensor.async_setup_entry(hass, entry, sensors.extend)
        await self.sensor.binary.async_setup_entry(hass, entry, binaries.extend)
        return hass, coordinator, sensors, binaries

    async def test_platforms_share_one_discovery_pass(self):
        calls = []
        real = self.coord.metrics

        def counting(item):
            calls.append(item)
            return real(item)

        with patch.object(self.coord, "metrics", counting):
            _hass, coordinator, _sensors, _binaries = await self.setup()
            self.assertEqual(len(calls), 1)  # sensor + binary_sensor setup
            item = coordinator.data["s1"]
            self.assertIs(
                coordinator.metrics_for("s1", item), coordinator.metrics_for("s1", item)
            )
            coordinator.async_set_updated_data({"s1": item})  # nothing replaced
            self.assertEqual(len(calls), 1)
            coordinator.async_set_updated_data({"s1": self.system(["web", "job"])})
            self.assertEqual(len(calls), 2)  # one pass for both platforms

    async def test_vanished_never_enabled_entities_are_removed(self):
        registry = EntityRegistry()
        hex_of = lambda name: name.encode().hex()
        # Left by an earlier run: one never enabled, one the user enabled, one
        # the user disabled, plus an aggregate and another system's entity.
        old = registry.add("sensor", f"s1_container_{hex_of('old')}_cpu", "integration")
        enabled = registry.add("sensor", f"s1_container_{hex_of('kept')}_cpu", None)
        by_user = registry.add("sensor", f"s1_container_{hex_of('mine')}_cpu", "user")
        aggregate = registry.add("sensor", "s1_container_updates", "integration")
        other = registry.add("sensor", f"s2_container_{hex_of('old')}_cpu", "integration")
        old_update = registry.add(
            "binary_sensor", f"s1_container_{hex_of('old')}_update", "integration"
        )
        _hass, coordinator, sensors, _binaries = await self.setup(registry)
        for entity_id in (old, old_update):
            self.assertNotIn(entity_id, registry.entries)
        for entity_id in (enabled, by_user, aggregate, other):
            self.assertIn(entity_id, registry.entries)

        # "job" disappears: its registered, never-enabled entities go; "web" stays.
        job_cpu = registry.add("sensor", f"s1_container_{hex_of('job')}_cpu", "integration")
        web_cpu = registry.add("sensor", f"s1_container_{hex_of('web')}_cpu", "integration")
        before = len(sensors)
        coordinator.async_set_updated_data({"s1": self.system(["web"])})
        self.assertNotIn(job_cpu, registry.entries)
        self.assertIn(web_cpu, registry.entries)
        self.assertEqual(len(sensors), before)

        # A collection that could not be read is missing: nothing is removed.
        unread = self.system([])
        del unread["containers"]
        coordinator.async_set_updated_data({"s1": unread})
        self.assertIn(web_cpu, registry.entries)

        # Read and empty: the last container is gone, so its entities go too.
        coordinator.async_set_updated_data({"s1": self.system([])})
        self.assertNotIn(web_cpu, registry.entries)
        self.assertIn(enabled, registry.entries)

        # A container that comes back is discovered again.
        coordinator.async_set_updated_data({"s1": self.system(["web", "job"])})
        added = [e.entity_description.key for e in sensors[before:]]
        self.assertIn(f"container_{hex_of('job')}_cpu", added)
        self.assertIn(f"container_{hex_of('web')}_cpu", added)


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


class LanguageAndUpdateTests(unittest.IsolatedAsyncioTestCase):
    LANGUAGES = ("en", "pt", "es", "fr", "de")

    def setUp(self):
        self.sensor, self.coord = load_package(
            ROOT / "custom_components/beszel_machine_card", "beszel_machine_card"
        )
        self.translations = ROOT / "custom_components/beszel_machine_card/translations"

    def load(self, language):
        import json

        return json.loads((self.translations / f"{language}.json").read_text("utf-8"))

    def test_translation_files_match(self):
        import json
        import re

        def flat(data, prefix=""):
            for key, value in data.items():
                if isinstance(value, dict):
                    yield from flat(value, f"{prefix}{key}.")
                else:
                    yield f"{prefix}{key}", value

        strings = json.loads(
            (self.translations.parent / "strings.json").read_text("utf-8")
        )
        self.assertEqual(strings, self.load("en"), "strings.json is the English source")
        self.assertEqual(
            sorted(p.stem for p in self.translations.glob("*.json")),
            sorted(self.LANGUAGES),
        )
        english = dict(flat(self.load("en")))
        for language in self.LANGUAGES:
            values = dict(flat(self.load(language)))
            self.assertEqual(set(values), set(english), language)
            for key, text in values.items():
                self.assertTrue(text.strip(), f"{language}: {key} is empty")
                self.assertEqual(
                    set(re.findall(r"{[a-z_]+}", text)),
                    set(re.findall(r"{[a-z_]+}", english[key])),
                    f"{language}: {key} placeholders",
                )
                self.assertNotRegex(text, r"https?://[a-z]", f"{language}: {key} has a URL")
            # Every core sensor has a label; the language is a card option,
            # so the setup and options dialogs must not ask for one.
            names = values
            for description in self.sensor.SENSORS:
                self.assertIn(
                    f"entity.sensor.{description.translation_key}.name", names
                )
            self.assertFalse(
                [key for key in names if "language" in key or key.startswith("options.")]
            )

    async def test_entities_keep_translation_keys_without_fixed_names(self):
        """Home Assistant names core entities; the integration sets no language."""
        hass = types.SimpleNamespace(data={})
        coordinator = self.coord.BeszelDataUpdateCoordinator(hass, None)
        coordinator.data = {
            "s1": {"record": {"status": "up", "name": "NAS"}, "info": {}, "stats": {"m": 4}}
        }
        hass.data[self.sensor.DOMAIN] = {"entry": coordinator}
        entry = types.SimpleNamespace(
            entry_id="entry", data={"url": "http://hub"}, async_on_unload=lambda fn: None
        )
        sensors, binaries = [], []
        await self.sensor.async_setup_entry(hass, entry, sensors.extend)
        await self.sensor.binary.async_setup_entry(hass, entry, binaries.extend)
        by_key = {e.entity_description.key: e for e in sensors}
        cpu = by_key["cpu_usage"]
        # The cards find core sensors by translation key, so it must stay.
        self.assertEqual(cpu.entity_description.translation_key, "cpu_usage")
        self.assertIsNone(getattr(cpu, "_attr_name", None))
        hub = next(e for e in binaries if not hasattr(e, "_metric"))
        self.assertEqual(hub._attr_translation_key, "hub_connection")
        self.assertIsNone(getattr(hub, "_attr_name", None))
        package = ROOT / "custom_components/beszel_machine_card"
        self.assertFalse((package / "language.py").exists())
        self.assertNotIn("OptionsFlow", (package / "config_flow.py").read_text("utf-8"))

    async def test_hub_update_entity(self):
        update = self.sensor.update
        API = sys.modules["test_api"].API

        class Client:
            def __init__(self):
                self.info = {"version": "0.21.1", "check_updates": False}
                self.update = {"version": None, "url": None}
                self.fail = None
                self.update_calls = 0

            async def async_get_hub_info(self):
                if self.fail:
                    raise self.fail
                return dict(self.info)

            async def async_get_hub_update(self):
                self.update_calls += 1
                return dict(self.update)

        client = Client()
        coordinator = types.SimpleNamespace(client=client)
        entry = types.SimpleNamespace(entry_id="entry", data={"url": "http://hub"})
        entity = update.BeszelHubUpdate(coordinator, entry)
        self.assertEqual(entity._attr_unique_id, "entry_hub_update")
        self.assertEqual(entity._attr_translation_key, "hub_update")
        self.assertEqual(
            entity._attr_device_info["identifiers"],
            {(self.sensor.DOMAIN, "hub_entry")},
        )
        self.assertFalse(hasattr(entity, "_attr_supported_features"), "no install")

        # Without CHECK_UPDATES the Hub never looks, so "latest" stays unknown.
        await entity.async_update()
        self.assertEqual(entity._attr_installed_version, "0.21.1")
        self.assertIsNone(entity._attr_latest_version)
        self.assertEqual(client.update_calls, 0)
        self.assertIn("CHECK_UPDATES", entity._attr_release_summary)

        client.info["check_updates"] = True
        await entity.async_update()
        self.assertEqual(entity._attr_latest_version, "0.21.1")
        self.assertIsNone(entity._attr_release_summary)
        self.assertIsNone(entity._attr_release_url)

        url = "https://github.com/henrygd/beszel/releases/tag/v0.22.0"
        client.update = {"version": "0.22.0", "url": url}
        await entity.async_update()
        self.assertEqual(entity._attr_latest_version, "0.22.0")
        self.assertEqual(entity._attr_release_url, url)
        self.assertTrue(entity._attr_available)

        client.fail = API.BeszelAuthError("expired")
        await entity.async_update()
        self.assertFalse(entity._attr_available)
        self.assertEqual(entity._attr_installed_version, "0.21.1")

        # A failed read is retried in minutes, once, not at the next hourly poll.
        entity.hass = types.SimpleNamespace(
            timers=[],
            device_registry=DeviceRegistry(
                types.SimpleNamespace(id="dev0", sw_version="0.21.1")
            ),
        )
        await entity.async_update()
        await entity.async_update()
        self.assertEqual([delay for delay, _ in entity.hass.timers], [300])
        entity.hass.timers.pop()[1](None)
        self.assertEqual(entity.refresh_requests, 1)
        await entity.async_update()
        client.fail = None
        await entity.async_update()
        self.assertEqual(entity.hass.timers, [], "success cancels the retry")
        self.assertTrue(entity._attr_available)

        # The installed version is mirrored onto the Hub device.
        device = types.SimpleNamespace(id="dev1", sw_version=None)
        entity.hass = types.SimpleNamespace(device_registry=DeviceRegistry(device))
        client.fail = None
        await entity.async_update()
        self.assertEqual(
            entity.hass.device_registry.updates, [("dev1", {"sw_version": "0.21.1"})]
        )
        device.sw_version = "0.21.1"
        await entity.async_update()
        self.assertEqual(len(entity.hass.device_registry.updates), 1)
