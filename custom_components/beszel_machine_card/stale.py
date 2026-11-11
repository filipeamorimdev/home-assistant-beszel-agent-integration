"""Remove registry entries of containers and services that no longer exist.

Every container name registers seven entities and every systemd service four.
They are disabled by default, but the entity registry keeps them forever, so a
host that runs randomly named containers would grow it without limit. Entries
the user enabled, or disabled themselves, are never touched.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from typing import Any

from .const import DOMAIN

# Per-record keys only; aggregates such as ``container_updates`` do not match.
_RECORD_KEY = re.compile(r"^(container|service)_[0-9a-f]+_[a-z_]+$")
_COLLECTIONS = {"container": "containers", "service": "services"}


def record_collection(key: str) -> str | None:
    """Return the item key holding the record a per-record metric belongs to."""
    match = _RECORD_KEY.match(key)
    return _COLLECTIONS[match.group(1)] if match else None


class StaleEntityCleaner:
    """Track one platform's per-record entities and drop the vanished ones."""

    def __init__(
        self,
        registry: Any,
        entries: Iterable[Any],
        domain: str,
        disabled_by_integration: Any,
    ) -> None:
        self._registry = registry
        self._domain = domain
        self._integration = disabled_by_integration
        self._keys: dict[str, set[str]] = {}
        # Entries left by earlier runs: unique IDs are "<system id>_<key>".
        for entry in entries:
            if getattr(entry, "domain", None) != domain:
                continue
            system_id, _, key = str(getattr(entry, "unique_id", "")).partition("_")
            self.track(system_id, key)

    def track(self, system_id: str, key: str) -> None:
        """Remember an entity that may need removing later."""
        if system_id and record_collection(key):
            self._keys.setdefault(system_id, set()).add(key)

    def remove_vanished(
        self, system_id: str, item: Mapping[str, Any], current: set[str]
    ) -> set[str]:
        """Remove never-enabled entities whose record is gone; return their keys."""
        tracked = self._keys.get(system_id)
        if not tracked:
            return set()
        removed: set[str] = set()
        for key in tracked - current:
            # A collection that could not be read is left out of the item;
            # only one that was read (even if now empty) proves the record gone.
            if not isinstance(item.get(record_collection(key)), Mapping):
                continue
            entity_id = self._registry.async_get_entity_id(
                self._domain, DOMAIN, f"{system_id}_{key}"
            )
            entry = self._registry.async_get(entity_id) if entity_id else None
            if entry is not None:
                if entry.disabled_by != self._integration:
                    continue
                self._registry.async_remove(entity_id)
            removed.add(key)
        tracked -= removed
        return removed
