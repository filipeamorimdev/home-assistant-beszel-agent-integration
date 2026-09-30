"""Async client for the Beszel PocketBase API."""

from __future__ import annotations

import asyncio
import base64
import json
import time
from collections.abc import AsyncIterator, Callable, Mapping
from typing import Any
from urllib.parse import quote

import aiohttp


class BeszelApiError(Exception):
    """Base exception raised by the Beszel API client."""


class BeszelAuthError(BeszelApiError):
    """Raised when Beszel rejects the supplied access token."""


class BeszelApiClient:
    """Small PocketBase client containing only the calls this integration needs."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        base_url: str,
        token: str | None = None,
    ) -> None:
        self._session = session
        self.base_url = base_url.rstrip("/")
        self._token = token.strip() if token else None
        self._details_available = True

    async def async_check_hub(self) -> None:
        """Confirm the Hub answers unauthenticated API requests."""
        await self._public_json_request("GET", "/api/collections/users/auth-methods")

    async def async_authenticate_password(
        self, identity: str, password: str
    ) -> dict[str, Any]:
        """Sign in with a normal Beszel users-collection email/username and password."""
        auth_data = await self._public_json_request(
            "POST",
            "/api/collections/users/auth-with-password",
            json_data={
                "identity": identity.strip(),
                "password": password,
            },
        )
        token = auth_data.get("token") if isinstance(auth_data, Mapping) else None
        if not isinstance(token, str) or not token:
            raise BeszelAuthError("Beszel password login did not return a user token")
        self._token = token
        return dict(auth_data)

    async def async_refresh_token(self) -> str:
        """Refresh and return the PocketBase user auth token."""
        if not self._token:
            raise BeszelAuthError("No Beszel access token is available")
        payload = await self._public_json_request(
            "POST",
            "/api/collections/users/auth-refresh",
            headers={"Authorization": self._token},
        )
        token = payload.get("token") if isinstance(payload, Mapping) else None
        if not isinstance(token, str) or not token:
            raise BeszelAuthError("Beszel token refresh did not return a token")
        self._token = token
        return token

    def seconds_until_token_refresh(self) -> float:
        """Return a safe delay that refreshes the token before it expires."""
        if not self._token:
            return 60
        expires_at = self._token_claims().get("exp")
        if not isinstance(expires_at, (int, float)):
            return 3600
        return max(60, expires_at - time.time() - 3600)

    async def async_validate_token(self) -> None:
        """Verify that the token belongs to a normal, unexpired Beszel user."""
        claims = self._token_claims()
        user_id = claims.get("id")
        if (
            claims.get("collectionId") != "_pb_users_auth_"
            or not isinstance(user_id, str)
            or not user_id
        ):
            raise BeszelAuthError(
                "The session must belong to the normal Beszel users "
                "collection, not a superuser, agent, or universal token"
            )

        expires_at = claims.get("exp")
        if isinstance(expires_at, (int, float)) and expires_at <= time.time():
            raise BeszelAuthError("Beszel access token has expired")

        await self._request(
            "GET",
            f"/api/collections/users/records/{quote(user_id, safe='')}",
            auth_not_found=True,
        )

    async def _async_records(self, collection: str) -> list[dict[str, Any]]:
        """Read all pages, including installations with more than 500 systems."""
        records = []
        page = 1
        while True:
            payload = await self._request(
                "GET",
                f"/api/collections/{collection}/records",
                params={"page": page, "perPage": 500, "sort": "id"},
            )
            records.extend(self._items(payload))
            if page >= payload.get("totalPages", 1):
                return records
            page += 1

    async def async_get_systems(self) -> list[dict[str, Any]]:
        """Return every system visible to the authenticated Beszel user."""
        return await self._async_records("systems")

    async def async_get_latest_stats(
        self, system_ids: list[str] | None = None
    ) -> dict[str, dict[str, Any]]:
        """Fetch one timestamped sample per host, with four requests in flight."""
        if system_ids is None:
            system_ids = [
                item["id"]
                for item in await self.async_get_systems()
                if isinstance(item.get("id"), str)
            ]
        semaphore = asyncio.Semaphore(4)

        async def latest(system_id: str):
            async with semaphore:
                try:
                    payload = await self._request(
                        "GET",
                        "/api/collections/system_stats/records",
                        params={
                            "page": 1,
                            "perPage": 1,
                            "skipTotal": "true",
                            "sort": "-created",
                            "filter": f'type = "1m" && system = {json.dumps(system_id)}',
                            "fields": "system,stats,created",
                        },
                    )
                except BeszelAuthError:
                    raise
                except BeszelApiError:
                    return system_id, {}
            for record in self._items(payload):
                if record.get("system") == system_id and isinstance(
                    record.get("stats"), Mapping
                ):
                    return system_id, {
                        "stats": dict(record["stats"]),
                        "created": record.get("created"),
                    }
            return system_id, {}

        return dict(
            await asyncio.gather(*(latest(system_id) for system_id in system_ids))
        )

    async def _async_get_details(self) -> dict[str, dict[str, Any]]:
        """Hardware metadata is optional on older or restricted hubs."""
        try:
            records = await self._async_records("system_details")
        except BeszelAuthError:
            raise
        except BeszelApiError:
            self._details_available = False
            return {}
        self._details_available = True
        return {
            record["system"]: record
            for record in records
            if isinstance(record.get("system"), str)
        }

    async def async_get_data(self) -> dict[str, dict[str, Any]]:
        """Fetch systems, one latest sample per host, and hardware metadata."""
        systems = await self.async_get_systems()
        system_ids = [
            record["id"]
            for record in systems
            if isinstance(record.get("id"), str) and record["id"]
        ]
        latest_stats, details = await asyncio.gather(
            self.async_get_latest_stats(system_ids), self._async_get_details()
        )
        result = {}
        for record in systems:
            system_id = record.get("id")
            if not isinstance(system_id, str) or not system_id:
                continue
            info = record.get("info")
            result[system_id] = {
                "record": record,
                "info": dict(info) if isinstance(info, Mapping) else {},
                "stats": latest_stats.get(system_id, {}).get("stats", {}),
                "stats_created": latest_stats.get(system_id, {}).get("created"),
                "details": details.get(system_id, {}),
            }
        return result

    async def async_listen_realtime(
        self,
        callback: Callable[[str, Mapping[str, Any]], None],
        connection_callback: Callable[[bool], None] | None = None,
    ) -> None:
        """Listen for PocketBase record changes until the SSE stream closes."""
        if not self._token:
            raise BeszelAuthError("No Beszel access token is available")
        connected = False
        try:
            async with self._session.get(
                f"{self.base_url}/api/realtime",
                headers={"Accept": "text/event-stream"},
                timeout=aiohttp.ClientTimeout(
                    total=None, sock_connect=15, sock_read=360
                ),
            ) as response:
                if response.status in (401, 403):
                    raise BeszelAuthError("Beszel rejected the realtime connection")
                if response.status >= 400:
                    raise BeszelApiError(
                        f"Beszel realtime connection failed with HTTP {response.status}"
                    )

                subscribed = False
                async for event_name, payload in _iter_sse_events(response.content):
                    if event_name == "PB_CONNECT":
                        client_id = payload.get("clientId")
                        if not isinstance(client_id, str) or not client_id:
                            raise BeszelApiError(
                                "Beszel realtime response did not contain a client ID"
                            )
                        await self._async_set_realtime_subscriptions(
                            client_id,
                            ["systems/*", "system_stats/*"]
                            + (["system_details/*"] if self._details_available else []),
                        )
                        subscribed = True
                        connected = True
                        if connection_callback is not None:
                            connection_callback(True)
                        continue

                    if subscribed and event_name not in (
                        "PB_DISCONNECT",
                        "PB_CONNECT",
                    ):
                        callback(event_name, payload)
        except (aiohttp.ClientError, TimeoutError) as err:
            raise BeszelApiError(f"Beszel realtime connection failed: {err}") from err
        finally:
            if connected and connection_callback is not None:
                connection_callback(False)

    async def _async_set_realtime_subscriptions(
        self,
        client_id: str,
        subscriptions: list[str],
    ) -> None:
        """Subscribe a PocketBase SSE client to the requested topics."""
        try:
            async with self._session.post(
                f"{self.base_url}/api/realtime",
                json={
                    "clientId": client_id,
                    "subscriptions": subscriptions,
                },
                headers={"Authorization": self._token or ""},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as response:
                await response.read()
        except (aiohttp.ClientError, TimeoutError) as err:
            raise BeszelApiError(
                f"Unable to subscribe to Beszel realtime events: {err}"
            ) from err

        if response.status in (401, 403):
            raise BeszelAuthError("Beszel rejected the realtime subscription")
        if response.status >= 400:
            raise BeszelApiError(
                f"Beszel realtime subscription failed with HTTP {response.status}"
            )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        auth_not_found: bool = False,
    ) -> Any:
        if not self._token:
            raise BeszelAuthError("No Beszel access token is available")
        try:
            async with self._session.request(
                method,
                f"{self.base_url}{path}",
                params=params,
                headers={"Authorization": self._token or ""},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as response:
                payload = await self._json(response)
        except (aiohttp.ClientError, TimeoutError) as err:
            raise BeszelApiError(f"Unable to connect to Beszel: {err}") from err

        if response.status in (401, 403) or (auth_not_found and response.status == 404):
            raise BeszelAuthError("Beszel access token is invalid, expired, or denied")
        if response.status >= 400:
            raise BeszelApiError(self._message(payload, response.status))
        return payload

    async def _public_json_request(
        self,
        method: str,
        path: str,
        *,
        json_data: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> Any:
        """Send an unauthenticated JSON request (login, refresh, reachability)."""
        try:
            async with self._session.request(
                method,
                f"{self.base_url}{path}",
                json=json_data,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as response:
                payload = await self._json(response)
        except (aiohttp.ClientError, TimeoutError) as err:
            raise BeszelApiError(f"Unable to connect to Beszel: {err}") from err

        if response.status in (400, 401, 403):
            raise BeszelAuthError(self._message(payload, response.status))
        if response.status >= 400:
            raise BeszelApiError(self._message(payload, response.status))
        return payload

    def _token_claims(self) -> Mapping[str, Any]:
        """Decode untrusted JWT claims for early type and expiry validation."""
        try:
            encoded = self._token.split(".")[1]
            padding = "=" * (-len(encoded) % 4)
            payload = json.loads(base64.urlsafe_b64decode(encoded + padding))
        except (IndexError, ValueError, json.JSONDecodeError) as err:
            raise BeszelAuthError("Beszel access token has an invalid format") from err
        if not isinstance(payload, Mapping):
            raise BeszelAuthError("Beszel access token has an invalid payload")
        return payload

    @staticmethod
    async def _json(response: aiohttp.ClientResponse) -> Any:
        try:
            return await response.json(content_type=None)
        except (ValueError, aiohttp.ContentTypeError) as err:
            raise BeszelApiError(
                f"Beszel returned an invalid response (HTTP {response.status})"
            ) from err

    @staticmethod
    def _message(payload: Any, status: int) -> str:
        if isinstance(payload, Mapping):
            message = payload.get("message")
            if isinstance(message, str) and message:
                return f"Beszel API error {status}: {message}"
        return f"Beszel API request failed with HTTP {status}"

    @staticmethod
    def _items(payload: Any) -> list[dict[str, Any]]:
        if not isinstance(payload, Mapping) or not isinstance(
            payload.get("items"), list
        ):
            raise BeszelApiError("Beszel returned an unexpected collection response")
        return [item for item in payload["items"] if isinstance(item, dict)]


async def _iter_sse_events(content: Any) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """Parse a PocketBase SSE byte stream into event name and JSON payload."""
    event_name = "message"
    data_lines: list[str] = []

    async for raw_line in content:
        line = raw_line.decode("utf-8").rstrip("\r\n")
        if not line:
            if data_lines:
                try:
                    payload = json.loads("\n".join(data_lines))
                except json.JSONDecodeError:
                    payload = None
                if isinstance(payload, dict):
                    yield event_name, payload
            event_name = "message"
            data_lines = []
            continue
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_name = line[6:].strip()
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
