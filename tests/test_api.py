"""Focused tests for Beszel API authentication and record mapping."""

from __future__ import annotations

import base64
import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path

# The production module uses Home Assistant's aiohttp dependency. Keep these
# unit tests runnable in a bare checkout by providing only the API surface the
# fake session exercises.
if "aiohttp" not in sys.modules:
    aiohttp = types.ModuleType("aiohttp")

    class ClientError(Exception):
        pass

    class ContentTypeError(Exception):
        pass

    class ClientTimeout:
        def __init__(self, **kwargs):
            self.settings = kwargs

    aiohttp.ClientError = ClientError
    aiohttp.ContentTypeError = ContentTypeError
    aiohttp.ClientTimeout = ClientTimeout
    sys.modules["aiohttp"] = aiohttp


API_PATH = (
    Path(__file__).parents[1] / "custom_components" / "beszel_machine_card" / "api.py"
)
SPEC = importlib.util.spec_from_file_location("beszel_api", API_PATH)
assert SPEC and SPEC.loader
API = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = API
SPEC.loader.exec_module(API)


def make_token(collection_id="_pb_users_auth_", user_id="user1", exp=4102444800):
    payload = json.dumps(
        {"collectionId": collection_id, "id": user_id, "exp": exp}
    ).encode()
    encoded = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    return f"header.{encoded}.signature"


class FakeResponse:
    def __init__(self, status: int, payload: object, content=None) -> None:
        self.status = status
        self._payload = payload
        self.content = content

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def json(self, content_type=None):
        return json.loads(json.dumps(self._payload))

    async def read(self):
        return b""


class FakeSession:
    def __init__(self) -> None:
        self.requests: list[tuple[str, str, dict]] = []

    def request(self, method, url, **kwargs):
        self.requests.append((method, url, kwargs))
        if "/users/records/" in url:
            return FakeResponse(200, {"id": "user1", "role": "readonly"})
        if url.endswith("/systems/records"):
            return FakeResponse(
                200,
                {
                    "items": [
                        {
                            "id": "system1",
                            "name": "NAS",
                            "status": "up",
                            "info": {
                                "cpu": 8.6,
                                "mp": 39.02,
                                "dp": 2.72,
                                "dt": 55.1,
                                "u": 105252,
                            },
                        }
                    ]
                },
            )
        return FakeResponse(
            200,
            {
                "items": [
                    {
                        "system": "system1",
                        "created": "2026-09-15 10:00:00Z",
                        "stats": {"cpu": 9.5, "b": [845, 2821]},
                    }
                ]
            },
        )


class BeszelApiClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_checks_hub_reachability(self) -> None:
        class HubSession(FakeSession):
            def request(self, method, url, **kwargs):
                self.requests.append((method, url, kwargs))
                return FakeResponse(200, {"password": {"enabled": True}})

        session = HubSession()
        client = API.BeszelApiClient(session, "http://beszel.test")

        await client.async_check_hub()

        self.assertTrue(session.requests[0][1].endswith("/users/auth-methods"))

    async def test_refreshes_token(self) -> None:
        class RefreshSession(FakeSession):
            def request(self, method, url, **kwargs):
                self.requests.append((method, url, kwargs))
                return FakeResponse(200, {"token": "replacement-token"})

        session = RefreshSession()
        client = API.BeszelApiClient(session, "http://beszel.test", "original-token")

        token = await client.async_refresh_token()

        self.assertEqual(token, "replacement-token")
        self.assertEqual(
            session.requests[0][2]["headers"]["Authorization"], "original-token"
        )

    async def test_validates_normal_user_token(self) -> None:
        session = FakeSession()
        token = make_token()
        client = API.BeszelApiClient(session, "http://beszel.test", token)

        await client.async_validate_token()

        self.assertIn("/users/records/user1", session.requests[0][1])
        self.assertEqual(session.requests[0][2]["headers"]["Authorization"], token)

    async def test_rejects_superuser_token_without_sending_it(self) -> None:
        session = FakeSession()
        client = API.BeszelApiClient(
            session, "http://beszel.test", make_token("_superusers")
        )

        with self.assertRaises(API.BeszelAuthError):
            await client.async_validate_token()

        self.assertEqual(session.requests, [])

    async def test_rejects_expired_token_without_sending_it(self) -> None:
        session = FakeSession()
        client = API.BeszelApiClient(session, "http://beszel.test", make_token(exp=1))

        with self.assertRaises(API.BeszelAuthError):
            await client.async_validate_token()

        self.assertEqual(session.requests, [])

    async def test_combines_systems_and_latest_stats(self) -> None:
        session = FakeSession()
        client = API.BeszelApiClient(
            session,
            "http://beszel.test/",
            "token-value",
        )

        data = await client.async_get_data()

        self.assertEqual(data["system1"]["info"]["u"], 105252)
        self.assertEqual(data["system1"]["stats"]["b"], [845, 2821])
        self.assertEqual(
            session.requests[0][2]["headers"]["Authorization"], "token-value"
        )

    async def test_rejects_invalid_token(self) -> None:
        class UnauthorizedSession(FakeSession):
            def request(self, method, url, **kwargs):
                return FakeResponse(401, {"message": "Token expired"})

        client = API.BeszelApiClient(UnauthorizedSession(), "http://beszel.test", "bad")
        with self.assertRaises(API.BeszelAuthError):
            await client.async_get_systems()

    async def test_authenticates_with_password(self) -> None:
        class PasswordSession(FakeSession):
            def request(self, method, url, **kwargs):
                self.requests.append((method, url, kwargs))
                if url.endswith("/users/auth-with-password"):
                    return FakeResponse(
                        200,
                        {"token": make_token(), "record": {"id": "user1"}},
                    )
                return super().request(method, url, **kwargs)

        session = PasswordSession()
        client = API.BeszelApiClient(session, "http://beszel.test")
        auth_data = await client.async_authenticate_password("ops@example.com", "secret")

        self.assertEqual(auth_data["token"], make_token())
        self.assertEqual(client._token, make_token())
        method, url, kwargs = session.requests[0]
        self.assertEqual(method, "POST")
        self.assertTrue(url.endswith("/users/auth-with-password"))
        self.assertEqual(
            kwargs["json"],
            {"identity": "ops@example.com", "password": "secret"},
        )

    async def test_password_login_does_not_retry_on_expired_token_reads(self) -> None:
        class ExpiredTokenSession(FakeSession):
            def __init__(self) -> None:
                super().__init__()
                self.request_count = 0

            def request(self, method, url, **kwargs):
                self.request_count += 1
                return FakeResponse(401, {"message": "Token expired"})

        session = ExpiredTokenSession()
        client = API.BeszelApiClient(
            session,
            "http://beszel.test",
            "expired-token",
        )

        with self.assertRaises(API.BeszelAuthError):
            await client.async_get_systems()

        self.assertEqual(session.request_count, 1)

    async def test_parses_pocketbase_sse_events(self) -> None:
        async def content():
            for line in (
                b"event: PB_CONNECT\n",
                b'data: {"clientId":"client-1"}\n',
                b"\n",
                b"event: systems/system1\n",
                b'data: {"action":"update","record":{"id":"system1"}}\n',
                b"\n",
            ):
                yield line

        events = [event async for event in API._iter_sse_events(content())]

        self.assertEqual(events[0], ("PB_CONNECT", {"clientId": "client-1"}))
        self.assertEqual(events[1][0], "systems/system1")
        self.assertEqual(events[1][1]["action"], "update")

    async def test_subscribes_realtime_client_with_access_token(self) -> None:
        async def content():
            for line in (
                b"event: PB_CONNECT\n",
                b'data: {"clientId":"client-1"}\n',
                b"\n",
                b"event: system_stats/stat1\n",
                b'data: {"action":"create","record":{"system":"system1"}}\n',
                b"\n",
            ):
                yield line

        class RealtimeSession(FakeSession):
            def __init__(self) -> None:
                super().__init__()
                self.subscription = None

            def get(self, url, **kwargs):
                return FakeResponse(200, {}, content())

            def post(self, url, **kwargs):
                if url.endswith("/api/realtime"):
                    self.subscription = kwargs
                    return FakeResponse(204, {})
                return super().post(url, **kwargs)

        session = RealtimeSession()
        client = API.BeszelApiClient(
            session,
            "http://beszel.test",
            "token-value",
        )
        received = []
        connections = []

        await client.async_listen_realtime(
            lambda topic, payload: received.append((topic, payload)),
            connections.append,
        )

        self.assertEqual(session.subscription["json"]["clientId"], "client-1")
        self.assertEqual(
            session.subscription["json"]["subscriptions"],
            ["systems/*", "system_stats/*", "system_details/*"],
        )
        self.assertEqual(
            session.subscription["headers"]["Authorization"], "token-value"
        )
        self.assertEqual(received[0][0], "system_stats/stat1")
        self.assertEqual(connections, [True, False])


class ExpandedApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_one_sample_per_host_and_details(self):
        class Session(FakeSession):
            def request(self, method, url, **kwargs):
                if url.endswith("/system_details/records"):
                    self.requests.append((method, url, kwargs))
                    return FakeResponse(
                        200, {"items": [{"system": "system1", "hostname": "NAS"}]}
                    )
                return super().request(method, url, **kwargs)

        session = Session()
        client = API.BeszelApiClient(session, "http://beszel.test", make_token())
        result = await client.async_get_data()
        self.assertEqual(result["system1"]["details"]["hostname"], "NAS")
        self.assertEqual(result["system1"]["stats_created"], "2026-09-15 10:00:00Z")
        request = next(
            r for r in session.requests if r[1].endswith("/system_stats/records")
        )
        self.assertEqual(request[2]["params"]["perPage"], 1)
        self.assertIn('system = "system1"', request[2]["params"]["filter"])
        self.assertEqual(request[2]["params"]["skipTotal"], "true")

    async def test_systems_pagination(self):
        class Session(FakeSession):
            def request(self, method, url, **kwargs):
                self.requests.append((method, url, kwargs))
                page = kwargs["params"]["page"]
                return FakeResponse(
                    200, {"items": [{"id": f"s{page}"}], "totalPages": 2}
                )

        session = Session()
        client = API.BeszelApiClient(session, "http://beszel.test", make_token())
        self.assertEqual(await client.async_get_systems(), [{"id": "s1"}, {"id": "s2"}])

    async def test_optional_details_failure_keeps_system_metrics(self):
        class Session(FakeSession):
            def request(self, method, url, **kwargs):
                if url.endswith("/system_details/records"):
                    return FakeResponse(404, {})
                return super().request(method, url, **kwargs)

        result = await API.BeszelApiClient(
            Session(), "http://beszel.test", make_token()
        ).async_get_data()
        self.assertEqual(result["system1"]["stats"]["cpu"], 9.5)
        self.assertEqual(result["system1"]["details"], {})

    async def test_per_host_failure_does_not_drop_other_hosts(self):
        class Client(API.BeszelApiClient):
            async def _request(self, method, path, **kwargs):
                if '"offline"' in kwargs["params"]["filter"]:
                    raise API.BeszelApiError("unavailable")
                return {
                    "items": [
                        {"system": "online", "stats": {"cpu": 0}, "created": "now"}
                    ]
                }

        result = await Client(
            FakeSession(), "http://beszel.test", make_token()
        ).async_get_latest_stats(["offline", "online"])
        self.assertEqual(result["offline"], {})
        self.assertEqual(result["online"]["stats"]["cpu"], 0)

    async def test_stats_requests_have_bounded_concurrency(self):
        import asyncio

        class Client(API.BeszelApiClient):
            active = 0
            peak = 0

            async def _request(self, *args, **kwargs):
                self.active += 1
                self.peak = max(self.peak, self.active)
                await asyncio.sleep(0)
                self.active -= 1
                return {"items": []}

        client = Client(FakeSession(), "http://beszel.test", make_token())
        await client.async_get_latest_stats([str(i) for i in range(50)])
        self.assertEqual(client.peak, 4)


if __name__ == "__main__":
    unittest.main()
