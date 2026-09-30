"""Data update coordinator for Beszel Agent Integration."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import BeszelApiClient, BeszelApiError, BeszelAuthError
from .const import DOMAIN, FALLBACK_POLL_INTERVAL

_LOGGER = logging.getLogger(__name__)


class BeszelDataUpdateCoordinator(DataUpdateCoordinator[dict]):
    """Share polled and realtime Beszel data between every system entity."""

    def __init__(
        self, hass, client: BeszelApiClient, entry_id: str | None = None
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=None,
        )
        self.client = client
        self.entry_id = entry_id
        self._realtime_activity = asyncio.Event()
        self.realtime_connected = False
        self.last_realtime_event: datetime | None = None

    async def _async_update_data(self) -> dict:
        try:
            data = await self.client.async_get_data()
        except BeszelAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except BeszelApiError as err:
            raise UpdateFailed(str(err)) from err
        self._async_cleanup_stale_devices(set(data))
        return data

    def _async_cleanup_stale_devices(self, active_system_ids: set[str]) -> None:
        """Drop Home Assistant devices for systems that disappeared from Beszel."""
        if not self.entry_id:
            return
        from . import async_remove_stale_devices

        entry = self.hass.config_entries.async_get_entry(self.entry_id)
        if entry is None:
            return
        async_remove_stale_devices(self.hass, entry, active_system_ids)

    async def async_listen_realtime(self) -> None:
        """Maintain a realtime subscription, reconnecting after interruptions."""
        retry_delay = 1
        reconnecting = False
        while True:
            try:
                if reconnecting:
                    await self.async_request_refresh()
                reconnecting = True
                await self.client.async_listen_realtime(
                    self._handle_realtime_event,
                    self._handle_realtime_connection,
                )
                retry_delay = 1
            except asyncio.CancelledError:
                raise
            except BeszelApiError as err:
                _LOGGER.debug(
                    "Beszel realtime stream interrupted; reconnecting in %s seconds: %s",
                    retry_delay,
                    err,
                )
            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 60)

    async def async_poll_after_realtime_silence(self) -> None:
        """Poll only when no realtime record update arrives for five minutes."""
        while True:
            try:
                await asyncio.wait_for(
                    self._realtime_activity.wait(),
                    timeout=FALLBACK_POLL_INTERVAL,
                )
            except TimeoutError:
                _LOGGER.debug(
                    "No Beszel realtime update for %s seconds; running fallback poll",
                    FALLBACK_POLL_INTERVAL,
                )
                await self.async_request_refresh()
            finally:
                self._realtime_activity.clear()

    def _handle_realtime_event(self, topic: str, payload: Mapping[str, Any]) -> None:
        """Apply a systems or system_stats event without another HTTP call."""
        action = payload.get("action")
        record = payload.get("record")
        if action not in ("create", "update", "delete") or not isinstance(
            record, Mapping
        ):
            return

        updated = dict(self.data or {})
        if topic.startswith("systems/"):
            system_id = record.get("id")
            if not isinstance(system_id, str) or not system_id:
                return
            if action == "delete":
                updated.pop(system_id, None)
                self._async_cleanup_stale_devices(set(updated))
            else:
                previous = updated.get(system_id, {})
                info = record.get("info")
                updated[system_id] = {
                    **previous,
                    "record": dict(record),
                    "info": dict(info) if isinstance(info, Mapping) else {},
                    "stats": previous.get("stats", {}),
                }
        elif topic.startswith("system_stats/") and action != "delete":
            if record.get("type") != "1m":
                return
            system_id = record.get("system")
            stats = record.get("stats")
            if (
                not isinstance(system_id, str)
                or system_id not in updated
                or not isinstance(stats, Mapping)
            ):
                return
            created = record.get("created")
            previous_created = updated[system_id].get("stats_created")
            if (
                isinstance(created, str)
                and isinstance(previous_created, str)
                and created < previous_created
            ):
                return
            updated[system_id] = {
                **updated[system_id],
                "stats": dict(stats),
                "stats_created": created,
            }
        elif topic.startswith("system_details/"):
            system_id = record.get("system")
            if not isinstance(system_id, str) or system_id not in updated:
                return
            updated[system_id] = {
                **updated[system_id],
                "details": {} if action == "delete" else dict(record),
            }
        else:
            return

        self._realtime_activity.set()
        self.last_realtime_event = datetime.now(UTC)
        self.async_set_updated_data(updated)

    def _handle_realtime_connection(self, connected: bool) -> None:
        """Expose realtime connection changes to diagnostic entities."""
        if self.realtime_connected == connected:
            return
        self.realtime_connected = connected
        if connected and self.data is not None:
            self.async_set_updated_data(self.data)
        else:
            self.async_update_listeners()
