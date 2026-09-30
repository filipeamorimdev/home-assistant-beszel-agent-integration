"""Config flow for Beszel Agent Integration — username/password auth."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.config_entries import ConfigEntry, ConfigFlowResult
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .api import BeszelApiClient, BeszelApiError, BeszelAuthError
from .const import (
    AUTH_METHOD_PASSWORD,
    CONF_AUTH_METHOD,
    CONF_TOKEN,
    CONF_URL,
    CONF_USERNAME,
    DOMAIN,
)
from .helpers import normalise_url

URL_SELECTOR = TextSelector(
    TextSelectorConfig(type=TextSelectorType.URL, autocomplete="url")
)
USERNAME_SELECTOR = TextSelector(
    TextSelectorConfig(type=TextSelectorType.TEXT, autocomplete="username")
)
PASSWORD_SELECTOR = TextSelector(
    TextSelectorConfig(type=TextSelectorType.PASSWORD, autocomplete="current-password")
)


async def _validate_session(hass: HomeAssistant, data: dict[str, Any]) -> int:
    """Confirm the session token can read systems."""
    client = BeszelApiClient(
        async_get_clientsession(hass), data[CONF_URL], data[CONF_TOKEN]
    )
    await client.async_validate_token()
    return len(await client.async_get_systems())


class BeszelMachineCardConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Configure Beszel with username and password."""

    VERSION = 1

    def __init__(self) -> None:
        self._url: str | None = None
        self._reauth_entry: ConfigEntry | None = None
        self._username: str | None = None

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Collect the Hub URL, then ask for Beszel credentials."""
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                url = normalise_url(user_input[CONF_URL])
                client = BeszelApiClient(async_get_clientsession(self.hass), url)
                await client.async_check_hub()
            except ValueError:
                errors["base"] = "invalid_url"
            except BeszelApiError:
                errors["base"] = "cannot_connect"
            else:
                await self.async_set_unique_id(url)
                self._abort_if_unique_id_configured()
                self._url = url
                return await self.async_step_password()

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_URL,
                        default=(user_input or {}).get(CONF_URL, "http://"),
                    ): URL_SELECTOR
                }
            ),
            errors=errors,
        )

    async def async_step_password(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Sign in with the same Beszel web UI email/username and password."""
        errors: dict[str, str] = {}
        defaults = {
            CONF_USERNAME: self._username
            or (
                self._reauth_entry.data.get(CONF_USERNAME, "")
                if self._reauth_entry
                else ""
            )
        }
        if user_input is not None and self._url is not None:
            username = user_input[CONF_USERNAME].strip()
            password = user_input["password"]
            client = BeszelApiClient(async_get_clientsession(self.hass), self._url)
            try:
                auth_data = await client.async_authenticate_password(
                    username, password
                )
                data = {
                    CONF_URL: self._url,
                    CONF_TOKEN: auth_data["token"],
                    CONF_USERNAME: username,
                    CONF_AUTH_METHOD: AUTH_METHOD_PASSWORD,
                }
                await _validate_session(self.hass, data)
            except BeszelAuthError:
                errors["base"] = "invalid_auth"
            except BeszelApiError:
                errors["base"] = "cannot_connect"
            else:
                if self._reauth_entry is not None:
                    return self.async_update_reload_and_abort(
                        self._reauth_entry, data=data
                    )
                return self.async_create_entry(
                    title=f"Beszel ({urlsplit(self._url).netloc})", data=data
                )
            defaults[CONF_USERNAME] = username

        return self.async_show_form(
            step_id="password",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_USERNAME, default=defaults.get(CONF_USERNAME, "")
                    ): USERNAME_SELECTOR,
                    vol.Required("password"): PASSWORD_SELECTOR,
                }
            ),
            errors=errors,
        )

    async def async_step_reauth(self, entry_data: dict[str, Any]) -> ConfigFlowResult:
        """Start authorization again when a stored session is missing or rejected."""
        self._reauth_entry = self.hass.config_entries.async_get_entry(
            self.context["entry_id"]
        )
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Confirm that the user wants to sign in again."""
        if user_input is None:
            return self.async_show_form(
                step_id="reauth_confirm", data_schema=vol.Schema({})
            )
        if self._reauth_entry is None:
            return self.async_abort(reason="reauth_failed")

        self._url = self._reauth_entry.data[CONF_URL]
        self._username = self._reauth_entry.data.get(CONF_USERNAME)
        return await self.async_step_password()
