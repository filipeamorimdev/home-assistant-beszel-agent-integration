"""Beszel Hub version as a Home Assistant update entity (read-only)."""

from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.components.update import UpdateEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_call_later

from .api import BeszelApiError
from .const import DOMAIN, HUB_INFO_POLL_INTERVAL, HUB_INFO_RETRY_INTERVAL
from .coordinator import BeszelDataUpdateCoordinator
from .sensor import hub_device_info

_LOGGER = logging.getLogger(__name__)

SCAN_INTERVAL = timedelta(seconds=HUB_INFO_POLL_INTERVAL)
PARALLEL_UPDATES = 1

# Shown as the release summary while the Hub does not look for new releases.
CHECK_UPDATES_HINT = (
    "Activate CHECK_UPDATES on the Hub (CHECK_UPDATES=true) to see when a "
    "newer Beszel release is available."
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Add the Hub update entity."""
    coordinator: BeszelDataUpdateCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([BeszelHubUpdate(coordinator, entry)], update_before_add=True)


class BeszelHubUpdate(UpdateEntity):
    """Installed Beszel Hub version and, when the Hub checks, the newest release.

    The Hub only looks for new releases when it runs with ``CHECK_UPDATES=true``.
    Without it the latest version stays unknown rather than claiming the Hub is
    up to date. Installing is not offered: the integration never writes to the
    Hub.
    """

    _attr_has_entity_name = True
    _attr_translation_key = "hub_update"
    _attr_title = "Beszel Hub"
    _attr_should_poll = True

    def __init__(
        self, coordinator: BeszelDataUpdateCoordinator, entry: ConfigEntry
    ) -> None:
        self._client = coordinator.client
        self._attr_unique_id = f"{entry.entry_id}_hub_update"
        self._attr_device_info = hub_device_info(entry)
        self._device_identifier = (DOMAIN, f"hub_{entry.entry_id}")
        self._cancel_retry = None

    async def async_added_to_hass(self) -> None:
        """The first read runs before the device exists; sync it now."""
        await super().async_added_to_hass()
        self._async_sync_device_version(self._attr_installed_version)

    async def async_will_remove_from_hass(self) -> None:
        self._async_cancel_retry()

    def _async_cancel_retry(self) -> None:
        if self._cancel_retry is not None:
            self._cancel_retry()
            self._cancel_retry = None

    def _async_schedule_retry(self) -> None:
        """Read again in a few minutes instead of waiting for the hourly poll."""
        if self._cancel_retry is not None or self.hass is None:
            return

        @callback
        def _retry(_now) -> None:
            self._cancel_retry = None
            self.async_schedule_update_ha_state(True)

        self._cancel_retry = async_call_later(
            self.hass, HUB_INFO_RETRY_INTERVAL, _retry
        )

    async def async_update(self) -> None:
        """Read the Hub version, then the newest release if the Hub checks."""
        try:
            info = await self._client.async_get_hub_info()
        except BeszelApiError as err:
            _LOGGER.debug("Could not read the Beszel Hub version: %s", err)
            self._attr_available = False
            self._async_schedule_retry()
            return
        self._async_cancel_retry()
        self._attr_available = True
        installed = info.get("version")
        self._attr_installed_version = installed
        latest = None
        release_url = None
        # The state itself cannot carry text (HA derives it from the versions),
        # so the reason for "unknown" goes in the release summary.
        self._attr_release_summary = (
            None if info.get("check_updates") else CHECK_UPDATES_HINT
        )
        if installed and info.get("check_updates"):
            try:
                update = await self._client.async_get_hub_update()
            except BeszelApiError as err:
                _LOGGER.debug("Could not read Beszel Hub updates: %s", err)
            else:
                # An empty version means the Hub found nothing newer.
                latest = update.get("version") or installed
                if update.get("version"):
                    release_url = update.get("url")
        self._attr_latest_version = latest
        self._attr_release_url = release_url
        self._async_sync_device_version(installed)

    def _async_sync_device_version(self, version: str | None) -> None:
        """Show the Hub version on its device page too."""
        if not version or self.hass is None:
            return
        registry = dr.async_get(self.hass)
        device = registry.async_get_device(identifiers={self._device_identifier})
        if device is not None and device.sw_version != version:
            registry.async_update_device(device.id, sw_version=version)
