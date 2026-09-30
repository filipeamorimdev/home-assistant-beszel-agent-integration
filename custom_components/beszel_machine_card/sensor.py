"""Sensor platform for Home Assistant Beszel Agent Integration."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    PERCENTAGE,
    EntityCategory,
    UnitOfDataRate,
    UnitOfTemperature,
    UnitOfTime,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_URL, DOMAIN
from .coordinator import BeszelDataUpdateCoordinator
from .metrics import metrics
from .metrics import network as _network
from .metrics import number as _number
from .metrics import temperature as _temperature


def _info(item: Mapping[str, Any], key: str) -> Any:
    return item.get("info", {}).get(key)


def _stats_or_info(item: Mapping[str, Any], stats_key: str, info_key: str) -> Any:
    value = item.get("stats", {}).get(stats_key)
    stats_created = item.get("stats_created")
    info_updated = item.get("record", {}).get("updated")
    if (
        isinstance(stats_created, str)
        and isinstance(info_updated, str)
        and info_updated > stats_created
    ):
        overview = _info(item, info_key)
        if _number(overview) is not None:
            return overview
    return value if value is not None else _info(item, info_key)


STATUS_OPTIONS = ["up", "down", "paused", "pending", "unknown"]


def _status(item: Mapping[str, Any]) -> str | None:
    """Return a known Beszel status; unexpected values become unknown."""
    status = item.get("record", {}).get("status")
    return status if status in STATUS_OPTIONS else "unknown"


def _load(item: Mapping[str, Any], index: int) -> float | None:
    load = item.get("stats", {}).get("la") or _info(item, "la")
    if isinstance(load, list) and len(load) > index:
        return _number(load[index])
    return None


def _gpu_usage(item: Mapping[str, Any]) -> float | None:
    """Return the busiest GPU, falling back to Beszel's overview value."""
    gpu_data = item.get("stats", {}).get("g")
    if isinstance(gpu_data, Mapping):
        usage = [
            _number(gpu.get("u"))
            for gpu in gpu_data.values()
            if isinstance(gpu, Mapping)
        ]
        available = [value for value in usage if value is not None]
        if available:
            return max(available)
    return _number(_info(item, "g"))


def _battery(item: Mapping[str, Any]) -> float | None:
    """Return the representative battery percentage from Beszel's tuple."""
    battery = _info(item, "bat") or item.get("stats", {}).get("bat")
    if isinstance(battery, list) and battery:
        return _number(battery[0])
    batteries = item.get("stats", {}).get("bats")
    if isinstance(batteries, Mapping):
        percentages = [_number(value) for value in batteries.values()]
        available = [value for value in percentages if value is not None]
        if available:
            return min(available)
    return None


def _services(item: Mapping[str, Any], index: int) -> float | None:
    """Return total or failed systemd service count."""
    services = _info(item, "sv")
    if isinstance(services, list) and len(services) > index:
        return _number(services[index])
    return None


@dataclass(frozen=True, kw_only=True)
class BeszelSensorDescription(SensorEntityDescription):
    """Description plus a value extractor for a Beszel record."""

    value_fn: Callable[[Mapping[str, Any]], Any]


SENSORS = (
    BeszelSensorDescription(
        key="status",
        translation_key="status",
        icon="mdi:server-network",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda item: _status(item),
    ),
    BeszelSensorDescription(
        key="cpu_usage",
        translation_key="cpu_usage",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:cpu-64-bit",
        value_fn=lambda item: _number(_stats_or_info(item, "cpu", "cpu")),
    ),
    BeszelSensorDescription(
        key="memory_usage",
        translation_key="memory_usage",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:memory",
        value_fn=lambda item: _number(_stats_or_info(item, "mp", "mp")),
    ),
    BeszelSensorDescription(
        key="disk_usage",
        translation_key="disk_usage",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:harddisk",
        value_fn=lambda item: _number(_stats_or_info(item, "dp", "dp")),
    ),
    BeszelSensorDescription(
        key="cpu_temperature",
        translation_key="cpu_temperature",
        device_class=SensorDeviceClass.TEMPERATURE,
        native_unit_of_measurement=UnitOfTemperature.CELSIUS,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=_temperature,
    ),
    BeszelSensorDescription(
        key="network_received_speed",
        translation_key="network_received_speed",
        device_class=SensorDeviceClass.DATA_RATE,
        native_unit_of_measurement=UnitOfDataRate.BYTES_PER_SECOND,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:download-network",
        value_fn=lambda item: _network(item, 1),
    ),
    BeszelSensorDescription(
        key="network_sent_speed",
        translation_key="network_sent_speed",
        device_class=SensorDeviceClass.DATA_RATE,
        native_unit_of_measurement=UnitOfDataRate.BYTES_PER_SECOND,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:upload-network",
        value_fn=lambda item: _network(item, 0),
    ),
    BeszelSensorDescription(
        key="uptime",
        translation_key="uptime",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:timer-outline",
        value_fn=lambda item: _number(_info(item, "u")),
    ),
    BeszelSensorDescription(
        key="load_1m",
        translation_key="load_1m",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:chart-line",
        value_fn=lambda item: _load(item, 0),
    ),
    BeszelSensorDescription(
        key="load_5m",
        translation_key="load_5m",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:chart-line",
        value_fn=lambda item: _load(item, 1),
    ),
    BeszelSensorDescription(
        key="load_15m",
        translation_key="load_15m",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:chart-line",
        value_fn=lambda item: _load(item, 2),
    ),
    BeszelSensorDescription(
        key="gpu_usage",
        translation_key="gpu_usage",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:expansion-card-variant",
        value_fn=_gpu_usage,
    ),
    BeszelSensorDescription(
        key="battery",
        translation_key="battery",
        device_class=SensorDeviceClass.BATTERY,
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=_battery,
    ),
    BeszelSensorDescription(
        key="services_total",
        translation_key="services_total",
        state_class=SensorStateClass.MEASUREMENT,
        entity_category=EntityCategory.DIAGNOSTIC,
        icon="mdi:cog-outline",
        value_fn=lambda item: _services(item, 0),
    ),
    BeszelSensorDescription(
        key="services_failed",
        translation_key="services_failed",
        state_class=SensorStateClass.MEASUREMENT,
        entity_category=EntityCategory.DIAGNOSTIC,
        icon="mdi:alert-circle-outline",
        value_fn=lambda item: _services(item, 1),
    ),
    BeszelSensorDescription(
        key="agent_version",
        translation_key="agent_version",
        entity_category=EntityCategory.DIAGNOSTIC,
        icon="mdi:tag-outline",
        value_fn=lambda item: str(_info(item, "v")) if _info(item, "v") else None,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Create a stable sensor set for each system returned by Beszel."""
    coordinator: BeszelDataUpdateCoordinator = hass.data[DOMAIN][entry.entry_id]
    known: set[tuple[str, str]] = set()
    previous_items: dict[str, Any] = {}

    @callback
    def _async_add_new_systems() -> None:
        entities = []
        for system_id, item in (coordinator.data or {}).items():
            if previous_items.get(system_id) is item:
                continue
            previous_items[system_id] = item
            descriptions = list(SENSORS)
            for metric in metrics(item):
                if metric.value(item) is None:
                    continue
                descriptions.append(
                    BeszelSensorDescription(
                        key=metric.key,
                        name=metric.name,
                        native_unit_of_measurement=metric.unit,
                        device_class=metric.device_class,
                        state_class=(
                            SensorStateClass.TOTAL_INCREASING
                            if metric.counter
                            else SensorStateClass.MEASUREMENT
                            if metric.operation != "text"
                            else None
                        ),
                        entity_registry_enabled_default=metric.enabled,
                        entity_category=EntityCategory.DIAGNOSTIC
                        if metric.key.startswith("system_")
                        else None,
                        value_fn=metric.value,
                    )
                )
            for description in descriptions:
                identity = (system_id, description.key)
                if identity in known:
                    continue
                known.add(identity)
                entities.append(
                    BeszelSensor(coordinator, entry, system_id, description)
                )
        if entities:
            async_add_entities(entities)

    _async_add_new_systems()
    entry.async_on_unload(coordinator.async_add_listener(_async_add_new_systems))


class BeszelSensor(CoordinatorEntity[BeszelDataUpdateCoordinator], SensorEntity):
    """A metric belonging to one Beszel system."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: BeszelDataUpdateCoordinator,
        entry: ConfigEntry,
        system_id: str,
        description: BeszelSensorDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._system_id = system_id
        self._last_item = None
        self._last_success = None
        self._attr_unique_id = f"{system_id}_{description.key}"
        if description.key == "status":
            self._attr_device_class = SensorDeviceClass.ENUM
            self._attr_options = STATUS_OPTIONS

        item = coordinator.data[system_id]
        record = item["record"]
        info = item["info"]
        name = record.get("name") or system_id
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, system_id)},
            name=name,
            manufacturer="Beszel",
            model="Monitored system",
            sw_version=str(info.get("v")) if info.get("v") else None,
            configuration_url=entry.data[CONF_URL],
        )

    @property
    def available(self) -> bool:
        return super().available and self._system_id in self.coordinator.data

    @callback
    def _handle_coordinator_update(self) -> None:
        """Do not rewrite this host's entities when only another host changed."""
        item = (self.coordinator.data or {}).get(self._system_id)
        success = self.coordinator.last_update_success
        if item is self._last_item and success == self._last_success:
            return
        self._last_item = item
        self._last_success = success
        self.async_write_ha_state()

    @property
    def native_value(self) -> Any:
        item = self.coordinator.data.get(self._system_id)
        if not item:
            return None
        description = self.entity_description
        if (
            description.state_class is not None
            and item.get("record", {}).get("status") != "up"
        ):
            return None
        value = description.value_fn(item)
        if description.state_class is not None:
            value = _number(value)
            if value is None:
                return None
            if description.device_class == SensorDeviceClass.TEMPERATURE:
                return value if -273.15 <= value <= 200 else None
            if (
                value < 0
                or (
                    description.native_unit_of_measurement == PERCENTAGE
                    and not description.key.startswith("disk_")
                    and value > 100
                )
                or (description.key == "disk_usage" and value > 100)
            ):
                return None
        if isinstance(value, str) and value.strip().lower() in (
            "",
            "unknown",
            "unavailable",
            "none",
            "null",
        ):
            return None
        return value

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Expose host/port/agent on the status sensor for the offline card link."""
        if self.entity_description.key != "status":
            return None
        item = self.coordinator.data.get(self._system_id)
        if not item:
            return None
        record = item.get("record", {})
        info = item.get("info", {})
        attrs: dict[str, Any] = {}
        host = record.get("host")
        port = record.get("port")
        agent = info.get("v")
        if host:
            attrs["host"] = host
        if port is not None and port != "":
            attrs["port"] = port
        if agent:
            attrs["agent_version"] = str(agent)
        # Hardware threads/cores let the cards colour load average like Beszel.
        details = item.get("details", {})
        for key, detail_key, info_key in (
            ("threads", "threads", "t"),
            ("cores", "cores", "c"),
        ):
            value = _number(details.get(detail_key))
            if value is None:
                value = _number(info.get(info_key))
            if value is not None and value > 0:
                attrs[key] = int(value)
        return attrs or None
