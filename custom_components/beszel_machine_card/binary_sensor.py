"""Diagnostic binary sensors for the Beszel Hub connection."""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_URL, DOMAIN
from .coordinator import BeszelDataUpdateCoordinator
from .metrics import Metric, metrics
from .sensor import system_device_info


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Create the Hub diagnostic plus per-system binary metrics as they appear."""
    coordinator: BeszelDataUpdateCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([BeszelHubConnectionSensor(coordinator, entry)])
    known: set[tuple[str, str]] = set()
    previous_items: dict[str, Any] = {}

    @callback
    def _async_add_new_metrics() -> None:
        entities = []
        for system_id, item in (coordinator.data or {}).items():
            if previous_items.get(system_id) is item:
                continue
            previous_items[system_id] = item
            for metric in metrics(item):
                identity = (system_id, metric.key)
                if not metric.binary or identity in known:
                    continue
                if metric.value(item) is None:
                    continue
                known.add(identity)
                entities.append(
                    BeszelBinaryMetricSensor(coordinator, entry, system_id, metric)
                )
        if entities:
            async_add_entities(entities)

    _async_add_new_metrics()
    entry.async_on_unload(coordinator.async_add_listener(_async_add_new_metrics))


class BeszelBinaryMetricSensor(
    CoordinatorEntity[BeszelDataUpdateCoordinator], BinarySensorEntity
):
    """A yes/no Beszel reading such as a triggered alert or a container update."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: BeszelDataUpdateCoordinator,
        entry: ConfigEntry,
        system_id: str,
        metric: Metric,
    ) -> None:
        super().__init__(coordinator)
        self._metric = metric
        self._system_id = system_id
        self._last_item = None
        self._last_success = None
        self._attr_unique_id = f"{system_id}_{metric.key}"
        self._attr_name = metric.name
        self._attr_device_class = metric.device_class
        self._attr_icon = metric.icon
        self._attr_entity_registry_enabled_default = metric.enabled
        if metric.diagnostic:
            self._attr_entity_category = EntityCategory.DIAGNOSTIC
        self._attr_device_info = system_device_info(
            entry, system_id, coordinator.data[system_id]
        )

    @property
    def available(self) -> bool:
        return super().available and self._system_id in (self.coordinator.data or {})

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
    def is_on(self) -> bool | None:
        item = (self.coordinator.data or {}).get(self._system_id)
        if not item:
            return None
        if self._metric.live and item.get("record", {}).get("status") != "up":
            return None
        return self._metric.value(item)


class BeszelHubConnectionSensor(
    CoordinatorEntity[BeszelDataUpdateCoordinator], BinarySensorEntity
):
    """Report whether REST or the authenticated realtime stream is healthy."""

    _attr_has_entity_name = True
    _attr_translation_key = "hub_connection"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(
        self, coordinator: BeszelDataUpdateCoordinator, entry: ConfigEntry
    ) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_hub_connection"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"hub_{entry.entry_id}")},
            name="Beszel Hub",
            manufacturer="Beszel",
            model="Monitoring Hub",
            configuration_url=entry.data[CONF_URL],
        )

    @property
    def available(self) -> bool:
        """Keep the diagnostic available so an outage can be represented as off."""
        return True

    @property
    def is_on(self) -> bool:
        """Return true when REST succeeded or realtime is currently connected."""
        return (
            self.coordinator.last_update_success or self.coordinator.realtime_connected
        )

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose transport details useful when diagnosing stale data."""
        last_event = self.coordinator.last_realtime_event
        return {
            "realtime_connected": self.coordinator.realtime_connected,
            "last_realtime_event": last_event.isoformat() if last_event else None,
        }
