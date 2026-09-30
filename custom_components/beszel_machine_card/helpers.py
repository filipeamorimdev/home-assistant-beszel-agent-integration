"""URL helpers shared by the Beszel Agent Integration config flow."""

from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

# Older beszel_card package paths that 404 after migration and break the
# dashboard loader with "Failed to load Lovelace resource".
LEGACY_LOVELACE_PREFIXES = (
    "/beszel_card/",
    "/hacsfiles/beszel_card/",
)
LEGACY_LOVELACE_SUFFIXES = (
    "/beszel-card.js",
    "/beszel-overview-card.js",
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


def lovelace_resource_path(url: str) -> str:
    """Strip query string from a Lovelace resource URL."""
    return (url or "").split("?", 1)[0]


def is_legacy_lovelace_resource(url: str) -> bool:
    """Return True for leftover beszel_card / legacy card module URLs."""
    path = lovelace_resource_path(url)
    if any(path.startswith(prefix) for prefix in LEGACY_LOVELACE_PREFIXES):
        return True
    return any(path.endswith(suffix) for suffix in LEGACY_LOVELACE_SUFFIXES)
