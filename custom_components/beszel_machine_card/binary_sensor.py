"""Diagnostic binary sensors for the Beszel Hub connection."""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_URL, DOMAIN
from .coordinator import BeszelDataUpdateCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Create one connection diagnostic for this Beszel Hub."""
    coordinator: BeszelDataUpdateCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([BeszelHubConnectionSensor(coordinator, entry)])


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
