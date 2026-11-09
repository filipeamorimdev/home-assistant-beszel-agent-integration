"""URL helpers shared by the Beszel Agent Integration config flow."""

from __future__ import annotations

from ipaddress import ip_address
from urllib.parse import urlsplit, urlunsplit

# Older beszel_card package paths that 404 after migration and break the
# dashboard loader with "Failed to load Lovelace resource". Only these exact
# folders are ours; a file name alone may belong to another card.
LEGACY_LOVELACE_PREFIXES = (
    "/beszel_card/",
    "/hacsfiles/beszel_card/",
)


def normalise_url(value: str) -> str:
    """Return a validated Beszel origin without a trailing slash."""
    parts = urlsplit(value.strip())
    if (
        parts.scheme not in ("http", "https")
        or not parts.hostname
        or parts.username
        or parts.password
    ):
        raise ValueError("Invalid Beszel URL")
    return urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), "", ""))


def is_private_host(host: str | None) -> bool:
    """Return True for LAN, loopback and single-label/mDNS host names."""
    if not host:
        return False
    try:
        address = ip_address(host)
    except ValueError:
        name = host.rstrip(".").lower()
        return "." not in name or name.endswith(
            (".local", ".lan", ".home", ".internal", ".home.arpa", ".localhost")
        )
    return address.is_private or address.is_loopback or address.is_link_local


def is_insecure_remote_url(url: str) -> bool:
    """Return True when a plain-HTTP URL points outside the local network."""
    parts = urlsplit(url)
    return parts.scheme == "http" and not is_private_host(parts.hostname)


def lovelace_resource_path(url: str) -> str:
    """Strip query string from a Lovelace resource URL."""
    return (url or "").split("?", 1)[0]


def is_legacy_lovelace_resource(url: str) -> bool:
    """Return True for leftover beszel_card / legacy card module URLs."""
    path = lovelace_resource_path(url)
    return any(path.startswith(prefix) for prefix in LEGACY_LOVELACE_PREFIXES)
