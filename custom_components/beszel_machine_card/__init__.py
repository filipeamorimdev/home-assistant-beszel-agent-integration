"""Beszel Agent Integration with bundled Lovelace cards."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import BeszelApiClient, BeszelApiError, BeszelAuthError
from .const import (
    CARD_URL,
    CARD_VERSION,
    CONF_TOKEN,
    CONF_URL,
    DOMAIN,
    PLATFORMS,
    TABLE_CARD_URL,
)
from .coordinator import BeszelDataUpdateCoordinator
from .helpers import is_legacy_lovelace_resource, lovelace_resource_path

FRONTEND_DIR = Path(__file__).parent / "frontend"
FRONTEND_REGISTERED = f"{DOMAIN}_frontend_registered"
_LOGGER = logging.getLogger(__name__)

CARD_URLS = (
    (CARD_URL, FRONTEND_DIR / "beszel-machine-card.js"),
    (TABLE_CARD_URL, FRONTEND_DIR / "beszel-systems-table-card.js"),
)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Serve and register the bundled Lovelace cards."""
    hass.data.setdefault(DOMAIN, {})
    await _async_register_frontend(hass)
    return True


async def _async_register_frontend(hass: HomeAssistant) -> None:
    """Serve card JS and register it as Lovelace resources.

    ``add_extra_js_url`` alone can lose a race against the dashboard on cold
    start (Custom element not found). Lovelace resources are loaded with the
    dashboard itself, which is the reliable path HACS cards use.
    """
    if hass.data.get(FRONTEND_REGISTERED):
        return

    # Both cards import the shared helpers module from the same static path.
    required = [path for _, path in CARD_URLS] + [FRONTEND_DIR / "beszel-common.js"]
    missing = [path for path in required if not path.is_file()]
    if missing:
        _LOGGER.error("Beszel card frontend files missing: %s", missing)
        return

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(f"/{DOMAIN}", str(FRONTEND_DIR), False),
        ]
    )

    await _async_remove_legacy_lovelace_resources(hass)

    for url, _path in CARD_URLS:
        versioned = f"{url}?v={CARD_VERSION}"
        frontend.add_extra_js_url(hass, versioned)
        await _async_ensure_lovelace_resource(hass, url, versioned)

    hass.data[FRONTEND_REGISTERED] = True
    _LOGGER.info("Beszel Agent Integration frontend registered (v%s)", CARD_VERSION)


async def _async_lovelace_resources(hass: HomeAssistant):
    """Return the loaded Lovelace resource collection, or None."""
    lovelace = hass.data.get("lovelace")
    resources = getattr(lovelace, "resources", None) if lovelace else None
    if resources is None:
        return None
    if not resources.loaded:
        await resources.async_load()
    return resources


async def _async_remove_legacy_lovelace_resources(hass: HomeAssistant) -> None:
    """Delete Lovelace modules left behind by the old beszel_card package."""
    resources = await _async_lovelace_resources(hass)
    if resources is None:
        return

    try:
        for item in list(resources.async_items()):
            url = item.get("url", "")
            if not is_legacy_lovelace_resource(url):
                continue
            await resources.async_delete_item(item["id"])
            _LOGGER.info("Removed legacy Lovelace resource %s", url)
    except Exception:
        _LOGGER.debug("Could not remove legacy Lovelace resources", exc_info=True)


async def _async_ensure_lovelace_resource(
    hass: HomeAssistant, bare_url: str, versioned_url: str
) -> None:
    """Create or update a persistent Lovelace module resource."""
    resources = await _async_lovelace_resources(hass)
    if resources is None:
        _LOGGER.debug(
            "Lovelace resource storage unavailable; using add_extra_js_url only for %s",
            bare_url,
        )
        return

    try:
        existing = None
        for item in list(resources.async_items()):
            item_path = lovelace_resource_path(item.get("url", ""))
            if item_path == bare_url:
                existing = item
                break

        if existing is None:
            await resources.async_create_item(
                {"res_type": "module", "url": versioned_url}
            )
            _LOGGER.info("Registered Lovelace resource %s", versioned_url)
        elif existing.get("url") != versioned_url:
            await resources.async_update_item(
                existing["id"],
                {"res_type": "module", "url": versioned_url},
            )
            _LOGGER.info("Updated Lovelace resource to %s", versioned_url)
    except Exception:
        _LOGGER.debug(
            "Could not register Lovelace resource for %s", bare_url, exc_info=True
        )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up an authenticated Beszel connection from a config entry."""
    await _async_register_frontend(hass)

    token = entry.data.get(CONF_TOKEN)
    if not isinstance(token, str) or not token:
        raise ConfigEntryAuthFailed("A Beszel access token is required")

    client = BeszelApiClient(
        async_get_clientsession(hass),
        entry.data[CONF_URL],
        token,
    )
    coordinator = BeszelDataUpdateCoordinator(hass, client, entry.entry_id)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    entry.async_on_unload(entry.add_update_listener(_async_reload_entry))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_create_background_task(
        hass,
        coordinator.async_listen_realtime(),
        f"{DOMAIN}-realtime-{entry.entry_id}",
    )
    entry.async_create_background_task(
        hass,
        coordinator.async_poll_after_realtime_silence(),
        f"{DOMAIN}-fallback-poll-{entry.entry_id}",
    )
    entry.async_create_background_task(
        hass,
        _async_refresh_token_loop(hass, entry, client),
        f"{DOMAIN}-token-refresh-{entry.entry_id}",
    )
    return True


async def _async_refresh_token_loop(
    hass: HomeAssistant, entry: ConfigEntry, client: BeszelApiClient
) -> None:
    """Refresh the PocketBase user JWT before expiry and keep the loop alive."""
    while True:
        await asyncio.sleep(client.seconds_until_token_refresh())
        try:
            token = await client.async_refresh_token()
        except BeszelAuthError as err:
            _LOGGER.warning("Beszel session must be authorized again: %s", err)
            entry.async_start_reauth(hass)
            return
        except BeszelApiError as err:
            _LOGGER.warning("Unable to refresh Beszel token; retrying: %s", err)
            await asyncio.sleep(60)
            continue

        # Persist without reloading the entry; the in-memory client already
        # holds the replacement token from async_refresh_token().
        hass.config_entries.async_update_entry(
            entry,
            data={**entry.data, CONF_TOKEN: token},
        )


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a Beszel connection."""
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    hass.data[DOMAIN].pop(entry.entry_id, None)
    return True


async def _async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the coordinator after the config entry changes."""
    await hass.config_entries.async_reload(entry.entry_id)


def async_remove_stale_devices(
    hass: HomeAssistant, entry: ConfigEntry, active_system_ids: set[str]
) -> None:
    """Remove Home Assistant devices for systems that no longer exist in Beszel."""
    registry = dr.async_get(hass)
    for device in dr.async_entries_for_config_entry(registry, entry.entry_id):
        system_ids = {
            identifier[1]
            for identifier in device.identifiers
            if identifier[0] == DOMAIN and not str(identifier[1]).startswith("hub_")
        }
        if system_ids and system_ids.isdisjoint(active_system_ids):
            registry.async_remove_device(device.id)
