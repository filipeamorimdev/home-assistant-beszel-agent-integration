"""Validated Beszel metric discovery, independent of Home Assistant.

Sizes in system_stats are GiB; new I/O fields are bytes/second.
Missing optional fields remain missing (never fabricate a zero).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from math import isfinite
from typing import Any

# Device classes whose real readings can be negative.
SIGNED_DEVICE_CLASSES = ("temperature", "signal_strength")


def number(value: Any) -> float | int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return value if isfinite(value) else None
    except OverflowError:
        return None


def at(item: Any, path: tuple) -> Any:
    for key in path:
        if isinstance(item, Mapping):
            item = item.get(key)
        elif (
            isinstance(item, (list, tuple))
            and isinstance(key, int)
            and 0 <= key < len(item)
        ):
            item = item[key]
        else:
            return None
    return item


def temperature(item: Mapping) -> float | None:
    """Return Beszel's dashboard temperature, falling back to CPU probes.

    ``info.dt`` is the value Beszel itself shows in its Temp column (the agent
    picks it, optionally via its SENSORS setting), so the card matches the hub.
    """
    dashboard = number(at(item, ("info", "dt")))
    if dashboard is not None and -273.15 <= dashboard <= 200:
        return dashboard
    temps = at(item, ("stats", "t"))
    if isinstance(temps, Mapping):
        # Never label a drive, chipset or RP1 sensor as CPU temperature.
        values = [
            number(value)
            for name, value in temps.items()
            if any(
                token in str(name).lower() for token in ("cpu", "coretemp", "k10temp")
            )
        ]
        values = [
            value for value in values if value is not None and -273.15 <= value <= 200
        ]
        return max(values) if values else None
    return None


def network(item: Mapping, index: int) -> float | None:
    value = number(at(item, ("stats", "b", index)))
    if value is not None:
        return value
    # Legacy ns/nr are MiB/s, unlike the b tuple, which is B/s.
    value = number(at(item, ("stats", "ns" if index == 0 else "nr")))
    return value * 1024**2 if value is not None else None


@dataclass(frozen=True)
class Metric:
    key: str
    name: str
    path: tuple
    unit: str | None = None
    device_class: str | None = None
    enabled: bool = True
    operation: str | None = None
    other: tuple = ()
    counter: bool = False
    # Optional extractor for values that need more than a path lookup.
    fn: Callable[[Mapping], Any] | None = None
    binary: bool = False
    diagnostic: bool = False
    # False keeps reporting while the machine is offline (e.g. Beszel alerts).
    live: bool = True
    icon: str | None = None

    def value(self, item: Mapping) -> Any:
        raw = self.fn(item) if self.fn is not None else at(item, self.path)
        if self.binary:
            return raw if isinstance(raw, bool) else None
        if self.operation == "timestamp":
            # Beszel stores these as Unix milliseconds.
            ms = number(raw)
            if ms is None or ms <= 0:
                return None
            try:
                return datetime.fromtimestamp(ms / 1000, UTC)
            except (OverflowError, OSError, ValueError):
                return None
        if self.operation == "text":
            return (
                raw.strip()
                if isinstance(raw, str)
                and raw.strip().lower()
                not in ("", "unknown", "unavailable", "none", "null", "n/a")
                else None
            )
        value = number(raw)
        if self.operation in ("difference", "ratio"):
            other = number(at(item, self.other))
            if value is None or other is None:
                return None
            if self.operation == "difference":
                value -= other
            elif other > 0:
                value = value / other * 100
            else:
                return None
        elif self.operation == "rate" and value is None:
            legacy = number(at(item, self.other))
            value = legacy * 1024**2 if legacy is not None else None
        if number(value) is None:
            return None
        if self.device_class == "temperature":
            return value if -273.15 <= value <= 200 else None
        if self.device_class == "signal_strength":
            return value if -200 <= value <= 0 else None
        if value < 0 or (
            self.unit == "%" and self.operation != "io_time" and value > 100
        ):
            return None
        return value


IO_TIME_FIELDS = (
    "read_time",
    "write_time",
    "utilization",
    "read_latency",
    "write_latency",
    "weighted_time",
)


def _positive(value: Any) -> float | int | None:
    value = number(value)
    return value if value is not None and value > 0 else None


def metrics(item: Mapping):
    """Yield stable descriptors; dictionaries are discovered whenever new data arrives."""
    for key, name, field in (
        ("memory_total", "Memory total", "m"),
        ("memory_used", "Memory used", "mu"),
        ("memory_cache", "Memory cache", "mb"),
        ("memory_zfs_arc", "ZFS ARC memory", "mz"),
        ("swap_total", "Swap total", "s"),
        ("swap_used", "Swap used", "su"),
        ("disk_total", "Disk total", "d"),
        ("disk_used", "Disk used", "du"),
    ):
        yield Metric(key, name, ("stats", field), "GiB", "data_size")
    yield Metric(
        "disk_free",
        "Disk free",
        ("stats", "d"),
        "GiB",
        "data_size",
        operation="difference",
        other=("stats", "du"),
    )
    yield Metric(
        "swap_usage",
        "Swap usage",
        ("stats", "su"),
        "%",
        operation="ratio",
        other=("stats", "s"),
    )
    for index, direction, old in ((0, "read", "dr"), (1, "write", "dw")):
        yield Metric(
            f"disk_{direction}_speed",
            f"Disk {direction} speed",
            ("stats", "dio", index),
            "B/s",
            "data_rate",
            operation="rate",
            other=("stats", old),
        )
        yield Metric(
            f"disk_{direction}_total",
            f"Disk {direction} total",
            ("stats", "diot", index),
            "B",
            "data_size",
            False,
            counter=True,
        )
    for index, name in enumerate(
        ("user", "system", "iowait", "steal", "idle", "irq", "softirq", "nice")
    ):
        yield Metric(
            f"cpu_{name}",
            f"CPU {name}",
            ("stats", "cpub", index),
            "%",
            enabled=name in ("user", "system", "iowait"),
        )
    for index, name in enumerate(IO_TIME_FIELDS):
        yield Metric(
            f"disk_{name}",
            f"Disk {name.replace('_', ' ')}",
            ("stats", "dios", index),
            "ms" if "latency" in name else "%",
            "duration" if "latency" in name else None,
            False,
            operation="io_time",
        )
    for field, name in (
        ("hostname", "Hostname"),
        ("os_name", "Operating system"),
        ("kernel", "Kernel"),
        ("cpu", "CPU model"),
        ("arch", "Architecture"),
    ):
        yield Metric(
            f"system_{field}", name, ("details", field), enabled=False, operation="text"
        )
    for field in ("cores", "threads"):
        yield Metric(
            f"system_{field}", field.title(), ("details", field), enabled=False
        )
    yield Metric(
        "system_sockets",
        "CPU sockets",
        ("details", "sockets"),
        enabled=False,
        # Beszel stores 0 when the package count is unknown.
        fn=lambda i: _positive(at(i, ("details", "sockets"))),
    )
    yield Metric(
        "system_connection",
        "Agent connection",
        ("info", "ct"),
        enabled=False,
        operation="text",
        fn=lambda i: {1: "SSH", 2: "WebSocket"}.get(number(at(i, ("info", "ct")))),
    )
    for index, key, name in ((0, "package_updates", "Package updates"), (1, "security_updates", "Security updates")):
        yield Metric(key, name, ("info", "pu", index), icon="mdi:package-up")

    # Wi-Fi: signal per interface in stats, SSID in info.
    for field, suffix in (("stats", "signal"), ("info", "ssid")):
        data = at(item, (field, "wf"))
        if not isinstance(data, Mapping):
            continue
        for name in data:
            key = f"wifi_{str(name).encode().hex()}_{suffix}"
            if suffix == "signal":
                yield Metric(
                    key,
                    f"Wi-Fi {name} signal",
                    ("stats", "wf", name),
                    "dBm",
                    "signal_strength",
                )
            else:
                yield Metric(
                    key,
                    f"Wi-Fi {name} SSID",
                    ("info", "wf", name, "s"),
                    enabled=False,
                    operation="text",
                    icon="mdi:wifi",
                )

    cores = at(item, ("stats", "cpus"))
    if isinstance(cores, list):
        for index in range(len(cores)):
            yield Metric(
                f"cpu_core_{index}",
                f"CPU core {index}",
                ("stats", "cpus", index),
                "%",
                enabled=False,
            )
    for field, label, unit, cls, enabled in (
        ("t", "Temperature", "°C", "temperature", False),
        ("f", "Fan", "rpm", None, True),
        ("bats", "Battery", "%", "battery", False),
    ):
        data = at(item, ("stats", field))
        if isinstance(data, Mapping):
            for name in data:
                key = str(name).encode().hex()
                yield Metric(
                    f"{field}_{key}",
                    f"{label} {name}",
                    ("stats", field, name),
                    unit,
                    cls,
                    enabled,
                )

    interfaces = at(item, ("stats", "ni"))
    if isinstance(interfaces, Mapping):
        for name in interfaces:
            for index, label in enumerate(
                ("sent_speed", "received_speed", "sent_total", "received_total")
            ):
                yield Metric(
                    f"network_{str(name).encode().hex()}_{label}",
                    f"{name} {label.replace('_', ' ')}",
                    ("stats", "ni", name, index),
                    "B/s" if index < 2 else "B",
                    "data_rate" if index < 2 else "data_size",
                    False,
                    counter=index >= 2,
                )

    for field, label in (("efs", "Filesystem"), ("z", "ZFS pool")):
        data = at(item, ("stats", field))
        if not isinstance(data, Mapping):
            continue
        for name in data:
            base = ("stats", field, name)
            prefix = f"{field}_{str(name).encode().hex()}"
            title = at(data, (name, "n")) if field == "z" else None
            title = title if isinstance(title, str) and title.strip() else name
            for suffix, stat in (("total", "d"), ("used", "du")):
                yield Metric(
                    f"{prefix}_{suffix}",
                    f"{label} {title} {suffix}",
                    (*base, stat),
                    "GiB",
                    "data_size",
                    False,
                )
            yield Metric(
                f"{prefix}_free",
                f"{label} {title} free",
                (*base, "d"),
                "GiB",
                "data_size",
                False,
                "difference",
                (*base, "du"),
            )
            yield Metric(
                f"{prefix}_usage",
                f"{label} {title} usage",
                (*base, "du"),
                "%",
                enabled=False,
                operation="ratio",
                other=(*base, "d"),
            )
            for direction, stat, legacy in (("read", "rb", "r"), ("write", "wb", "w")):
                yield Metric(
                    f"{prefix}_{direction}",
                    f"{label} {title} {direction}",
                    (*base, stat),
                    "B/s",
                    "data_rate",
                    False,
                    "rate",
                    (*base, legacy),
                )
            if field == "z":
                yield Metric(
                    f"{prefix}_health",
                    f"{label} {title} health",
                    (*base, "h"),
                    enabled=False,
                    operation="text",
                )
                continue
            for direction, stat in (("read", "tr"), ("write", "tw")):
                yield Metric(
                    f"{prefix}_{direction}_total",
                    f"{label} {title} {direction} total",
                    (*base, stat),
                    "B",
                    "data_size",
                    False,
                    counter=True,
                )
            for index, stat in enumerate(IO_TIME_FIELDS):
                yield Metric(
                    f"{prefix}_{stat}",
                    f"{label} {title} {stat.replace('_', ' ')}",
                    (*base, "dios", index),
                    "ms" if "latency" in stat else "%",
                    "duration" if "latency" in stat else None,
                    False,
                    operation="io_time",
                )

    gpus = at(item, ("stats", "g"))
    if isinstance(gpus, Mapping):
        for name, gpu in gpus.items():
            if not isinstance(gpu, Mapping):
                continue
            for stat, label, unit, cls in (
                ("u", "usage", "%", None),
                ("mu", "memory used", "MiB", "data_size"),
                ("mt", "memory total", "MiB", "data_size"),
                ("p", "power", "W", "power"),
                ("pp", "package power", "W", "power"),
            ):
                yield Metric(
                    f"gpu_{str(name).encode().hex()}_{stat}",
                    f"GPU {gpu.get('n') or name} {label}",
                    ("stats", "g", name, stat),
                    unit,
                    cls,
                    False,
                )
            engines = gpu.get("e")
            if isinstance(engines, Mapping):
                for engine in engines:
                    yield Metric(
                        f"gpu_{str(name).encode().hex()}_e_{str(engine).encode().hex()}",
                        f"GPU {gpu.get('n') or name} {engine} engine",
                        ("stats", "g", name, "e", engine),
                        "%",
                        enabled=False,
                    )

    yield from collection_metrics(item)


# --- Per-system Beszel collections -------------------------------------------
# Records are stored under the keys listed in api.EXTRA_COLLECTIONS. Unique IDs
# hex-encode the stable record key so names with spaces or slashes stay valid.
# No key or name may end in a core suffix ("status", "battery", "uptime", ...):
# the cards resolve core sensors by that suffix.

CONTAINER_HEALTH = ("none", "starting", "healthy", "unhealthy")
SERVICE_STATES = (
    "active",
    "inactive",
    "failed",
    "activating",
    "deactivating",
    "reloading",
)
SERVICE_SUB_STATES = ("dead", "running", "exited", "failed", "unknown")
# Vdev states that mean a device is not serving data normally.
ZFS_BAD_VDEV_STATES = ("DEGRADED", "FAULTED", "OFFLINE", "UNAVAIL", "REMOVED")


def _hex(value: Any) -> str:
    return str(value).encode().hex()


def _records(item: Mapping, key: str) -> Mapping:
    records = item.get(key) if isinstance(item, Mapping) else None
    return records if isinstance(records, Mapping) else {}


def _record(item: Mapping, key: str, record_key: str) -> Mapping:
    record = _records(item, key).get(record_key)
    return record if isinstance(record, Mapping) else {}


def _label(values: tuple, raw: Any) -> str | None:
    index = number(raw)
    if index is None or index != int(index) or not 0 <= index < len(values):
        return None
    return values[int(index)]


def _count(item: Mapping, key: str, test: Callable[[Mapping], bool | None]):
    """Count matching records; None when the collection has no records."""
    records = [r for r in _records(item, key).values() if isinstance(r, Mapping)]
    if not records:
        return None
    results = [test(record) for record in records]
    if all(result is None for result in results):
        return None
    return sum(1 for result in results if result)


def _smart_attribute(record: Mapping, *names: str) -> float | int | None:
    """Raw value of the first SMART attribute whose normalised name matches."""
    attributes = record.get("attributes")
    if not isinstance(attributes, list):
        return None
    for attribute in attributes:
        if not isinstance(attribute, Mapping):
            continue
        name = "".join(ch for ch in str(attribute.get("n", "")).lower() if ch.isalnum())
        if name in names:
            value = number(attribute.get("rv"))
            return value if value is not None else number(attribute.get("v"))
    return None


def _smart_power_cycles(record: Mapping) -> float | int | None:
    attributes = record.get("attributes")
    if not isinstance(attributes, list):
        return None
    for attribute in attributes:
        if not isinstance(attribute, Mapping):
            continue
        name = str(attribute.get("n", "")).lower()
        if ("power" in name and "cycle" in name) or "startstopcycles" in name:
            return number(attribute.get("rv"))
    return None


def _scrub_errors(pool: Mapping) -> int | float | None:
    scrub = pool.get("scrub")
    if not isinstance(scrub, Mapping) or not scrub.get("state"):
        return None
    # The Hub omits a zero error count, so a reported scrub without one is 0.
    errors = scrub.get("errors", 0)
    return number(errors)


def _vdev_errors(vdev: Mapping) -> int | float | None:
    values = [number(vdev.get(field, 0)) for field in ("readErrs", "writeErrs", "checksumErrs")]
    return None if any(value is None for value in values) else sum(values)


def _vdevs(pool: Mapping) -> list[Mapping]:
    vdevs = pool.get("vdevs")
    return [v for v in vdevs if isinstance(v, Mapping)] if isinstance(vdevs, list) else []


def _percent_text(value: Any) -> float | None:
    if isinstance(value, str) and value.strip().endswith("%"):
        try:
            return number(float(value.strip()[:-1]))
        except ValueError:
            return None
    return None


def _monitor_ms(record: Mapping, field: str) -> float | None:
    if record.get("enabled") is False:
        return None
    value = number(record.get(field))
    # Response times are microseconds; 0 means no probe succeeded.
    return value / 1000 if value is not None and value > 0 else None


def _monitor_name(record: Mapping, monitor_id: str) -> str:
    target = record.get("target") if isinstance(record.get("target"), str) else ""
    port = number(record.get("port"))
    protocol = record.get("protocol") if isinstance(record.get("protocol"), str) else ""
    if target and port and protocol == "tcp":
        target = f"{target}:{int(port)}"
    if target and protocol:
        return f"{protocol.upper()} {target}"
    return target or monitor_id


def collection_metrics(item: Mapping):
    """Descriptors for SMART, ZFS pool detail, containers, services, monitors, alerts."""
    yield from _smart_metrics(item)
    yield from _zfs_metrics(item)
    yield from _container_metrics(item)
    yield from _service_metrics(item)
    yield from _monitor_metrics(item)
    yield from _alert_metrics(item)


def _smart_metrics(item: Mapping):
    yield Metric(
        "smart_failed",
        "Drives failing SMART",
        (),
        icon="mdi:harddisk-remove",
        fn=lambda i: _count(
            i,
            "smart",
            lambda r: r.get("state") == "FAILED" if r.get("state") else None,
        ),
    )
    for record_id, record in _records(item, "smart").items():
        if not isinstance(record, Mapping):
            continue
        rid = str(record_id)
        name = record.get("name") or rid
        prefix = f"smart_{_hex(rid)}"
        label = f"Drive {name}"

        def get(field, rid=rid):
            return lambda i: _record(i, "smart", rid).get(field)

        yield Metric(
            f"{prefix}_health",
            f"{label} SMART health",
            (),
            operation="text",
            icon="mdi:harddisk",
            fn=get("state"),
        )
        yield Metric(
            f"{prefix}_temperature",
            f"{label} temperature",
            (),
            "°C",
            "temperature",
            # Beszel stores 0 when smartctl reported no temperature.
            fn=lambda i, rid=rid: _positive(_record(i, "smart", rid).get("temp")),
        )
        yield Metric(
            f"{prefix}_power_on_hours",
            f"{label} power-on hours",
            (),
            "h",
            "duration",
            icon="mdi:clock-outline",
            fn=lambda i, rid=rid: _smart_attribute(
                _record(i, "smart", rid), "poweronhours"
            ),
        )
        yield Metric(
            f"{prefix}_power_cycles",
            f"{label} power cycles",
            (),
            enabled=False,
            counter=True,
            icon="mdi:power-cycle",
            fn=lambda i, rid=rid: _smart_power_cycles(_record(i, "smart", rid)),
        )
        yield Metric(
            f"{prefix}_capacity",
            f"{label} capacity",
            (),
            "B",
            "data_size",
            False,
            fn=lambda i, rid=rid: _positive(_record(i, "smart", rid).get("capacity")),
        )
        for key, title, names in (
            ("wear", "wear", ("percentageused",)),
            ("available_spare", "available spare", ("availablespare",)),
            ("reallocated_sectors", "reallocated sectors", ("reallocatedsectorct",)),
            ("pending_sectors", "pending sectors", ("currentpendingsector",)),
            ("uncorrectable", "uncorrectable sectors", ("offlineuncorrectable",)),
            ("media_errors", "media errors", ("mediaerrors",)),
            ("crc_errors", "CRC errors", ("udmacrcerrorcount",)),
        ):
            yield Metric(
                f"{prefix}_{key}",
                f"{label} {title}",
                (),
                "%" if key in ("wear", "available_spare") else None,
                enabled=False,
                fn=lambda i, rid=rid, names=names: _smart_attribute(
                    _record(i, "smart", rid), *names
                ),
            )
        for field, title in (
            ("model", "model"),
            ("serial", "serial number"),
            ("firmware", "firmware"),
            ("type", "type"),
        ):
            yield Metric(
                f"{prefix}_{field}",
                f"{label} {title}",
                (),
                enabled=False,
                operation="text",
                diagnostic=True,
                fn=get(field),
            )


def _zfs_metrics(item: Mapping):
    for pool_name, pool in _records(item, "zfs").items():
        if not isinstance(pool, Mapping):
            continue
        key = str(pool_name)
        prefix = f"zp_{_hex(key)}"
        title = pool.get("display_name") or key
        label = f"ZFS pool {title}"

        def pool_of(i, key=key):
            return _record(i, "zfs", key)

        yield Metric(
            f"{prefix}_scrub_errors",
            f"{label} scrub errors",
            (),
            icon="mdi:magnify-scan",
            fn=lambda i, pool_of=pool_of: _scrub_errors(pool_of(i)),
        )
        yield Metric(
            f"{prefix}_device_errors",
            f"{label} device errors",
            (),
            icon="mdi:alert-circle-outline",
            fn=lambda i, pool_of=pool_of: (
                sum(_vdev_errors(v) or 0 for v in _vdevs(pool_of(i)))
                if _vdevs(pool_of(i))
                else None
            ),
        )
        yield Metric(
            f"{prefix}_unhealthy_devices",
            f"{label} unhealthy devices",
            (),
            icon="mdi:harddisk-remove",
            fn=lambda i, pool_of=pool_of: (
                sum(
                    1
                    for v in _vdevs(pool_of(i))
                    if str(v.get("state", "")).upper() in ZFS_BAD_VDEV_STATES
                )
                if _vdevs(pool_of(i))
                else None
            ),
        )
        yield Metric(
            f"{prefix}_scrub_state",
            f"{label} scrub state",
            (),
            enabled=False,
            operation="text",
            fn=lambda i, pool_of=pool_of: (pool_of(i).get("scrub") or {}).get("state")
            if isinstance(pool_of(i).get("scrub"), Mapping)
            else None,
        )
        yield Metric(
            f"{prefix}_scrub_progress",
            f"{label} scrub progress",
            (),
            "%",
            enabled=False,
            fn=lambda i, pool_of=pool_of: _percent_text(
                (pool_of(i).get("scrub") or {}).get("progress")
            )
            if isinstance(pool_of(i).get("scrub"), Mapping)
            else None,
        )
        yield Metric(
            f"{prefix}_message",
            f"{label} status message",
            (),
            enabled=False,
            operation="text",
            fn=lambda i, pool_of=pool_of: pool_of(i).get("status"),
        )
        for vdev in _vdevs(pool):
            vname = vdev.get("name")
            if not isinstance(vname, str) or not vname:
                continue

            def vdev_of(i, pool_of=pool_of, vname=vname):
                return next(
                    (v for v in _vdevs(pool_of(i)) if v.get("name") == vname), {}
                )

            vprefix = f"{prefix}_vdev_{_hex(vname)}"
            yield Metric(
                f"{vprefix}_state",
                f"{label} {vname} state",
                (),
                enabled=False,
                operation="text",
                fn=lambda i, vdev_of=vdev_of: vdev_of(i).get("state"),
            )
            yield Metric(
                f"{vprefix}_errors",
                f"{label} {vname} errors",
                (),
                enabled=False,
                fn=lambda i, vdev_of=vdev_of: _vdev_errors(vdev_of(i))
                if vdev_of(i)
                else None,
            )
        datasets = pool.get("datasets")
        for dataset in datasets if isinstance(datasets, list) else []:
            if not isinstance(dataset, Mapping):
                continue
            dname = dataset.get("name")
            if not isinstance(dname, str) or not dname:
                continue

            def dataset_of(i, pool_of=pool_of, dname=dname):
                found = pool_of(i).get("datasets")
                return next(
                    (
                        d
                        for d in (found if isinstance(found, list) else [])
                        if isinstance(d, Mapping) and d.get("name") == dname
                    ),
                    {},
                )

            for suffix, field, title in (
                ("used", "used", "used"),
                ("available", "avail", "available"),
            ):
                yield Metric(
                    f"{prefix}_ds_{_hex(dname)}_{suffix}",
                    f"ZFS dataset {dname} {title}",
                    (),
                    "B",
                    "data_size",
                    False,
                    # Present datasets omit zero sizes.
                    fn=lambda i, dataset_of=dataset_of, field=field: number(
                        dataset_of(i).get(field, 0)
                    )
                    if dataset_of(i)
                    else None,
                )


def _container_metrics(item: Mapping):
    yield Metric(
        "containers_running",
        "Containers running",
        (),
        icon="mdi:docker",
        fn=lambda i: _count(
            i,
            "containers",
            lambda r: str(r.get("status", "")).lower().startswith("up")
            if isinstance(r.get("status"), str)
            else None,
        ),
    )
    yield Metric(
        "containers_unhealthy",
        "Containers unhealthy",
        (),
        icon="mdi:docker",
        fn=lambda i: _count(
            i,
            "containers",
            lambda r: _label(CONTAINER_HEALTH, r.get("health")) == "unhealthy"
            if _label(CONTAINER_HEALTH, r.get("health"))
            else None,
        ),
    )
    yield Metric(
        "container_updates",
        "Container updates",
        (),
        icon="mdi:package-up",
        fn=lambda i: _count(
            i,
            "containers",
            lambda r: r.get("updatable") if isinstance(r.get("updatable"), bool) else None,
        ),
    )
    for name, record in _records(item, "containers").items():
        if not isinstance(record, Mapping):
            continue
        key = str(name)
        prefix = f"container_{_hex(key)}"
        label = f"Container {key}"

        def get(field, key=key):
            return lambda i: _record(i, "containers", key).get(field)

        yield Metric(
            f"{prefix}_state", f"{label} state", (), enabled=False,
            operation="text", icon="mdi:docker", fn=get("status"),
        )
        yield Metric(
            f"{prefix}_health", f"{label} health", (), enabled=False,
            operation="text", icon="mdi:heart-pulse",
            fn=lambda i, key=key: _label(
                CONTAINER_HEALTH, _record(i, "containers", key).get("health")
            ),
        )
        yield Metric(
            f"{prefix}_cpu", f"{label} CPU", (), "%", enabled=False, fn=get("cpu"),
        )
        yield Metric(
            f"{prefix}_memory", f"{label} memory", (), "MiB", "data_size",
            False, fn=get("memory"),
        )
        yield Metric(
            f"{prefix}_network", f"{label} network", (), "B/s", "data_rate",
            False, fn=get("net"),
        )
        yield Metric(
            f"{prefix}_image", f"{label} image", (), enabled=False,
            operation="text", diagnostic=True, fn=get("image"),
        )
        yield Metric(
            f"{prefix}_update", f"{label} update", (), device_class="update", enabled=False,
            binary=True, fn=get("updatable"),
        )


def _service_metrics(item: Mapping):
    for name, record in _records(item, "services").items():
        if not isinstance(record, Mapping):
            continue
        key = str(name)
        prefix = f"service_{_hex(key)}"
        label = f"Service {key}"
        yield Metric(
            f"{prefix}_state", f"{label} state", (), enabled=False,
            operation="text", icon="mdi:cog-outline",
            fn=lambda i, key=key: _label(
                SERVICE_STATES, _record(i, "services", key).get("state")
            ),
        )
        yield Metric(
            f"{prefix}_sub_state", f"{label} sub-state", (), enabled=False,
            operation="text", icon="mdi:cog-outline",
            fn=lambda i, key=key: _label(
                SERVICE_SUB_STATES, _record(i, "services", key).get("sub")
            ),
        )
        yield Metric(
            f"{prefix}_cpu", f"{label} CPU", (), "%", enabled=False,
            fn=lambda i, key=key: _record(i, "services", key).get("cpu"),
        )
        yield Metric(
            f"{prefix}_memory", f"{label} memory", (), "B", "data_size", False,
            fn=lambda i, key=key: _record(i, "services", key).get("memory"),
        )


def _monitor_metrics(item: Mapping):
    for monitor_id, record in _records(item, "monitors").items():
        if not isinstance(record, Mapping):
            continue
        mid = str(monitor_id)
        prefix = f"monitor_{_hex(mid)}"
        label = f"Monitor {_monitor_name(record, mid)}"
        for suffix, field, title, enabled in (
            ("response", "res", "response time", True),
            ("response_avg_1h", "resAvg1h", "average response (1 h)", False),
            ("response_min_1h", "resMin1h", "minimum response (1 h)", False),
            ("response_max_1h", "resMax1h", "maximum response (1 h)", False),
        ):
            yield Metric(
                f"{prefix}_{suffix}",
                f"{label} {title}",
                (),
                "ms",
                "duration",
                enabled,
                icon="mdi:timer-outline",
                fn=lambda i, mid=mid, field=field: _monitor_ms(
                    _record(i, "monitors", mid), field
                ),
            )
        yield Metric(
            f"{prefix}_loss_1h",
            f"{label} packet loss (1 h)",
            (),
            "%",
            icon="mdi:lan-disconnect",
            fn=lambda i, mid=mid: _record(i, "monitors", mid).get("loss1h")
            if _record(i, "monitors", mid).get("enabled") is not False
            else None,
        )
        yield Metric(
            f"{prefix}_cert_expiry",
            f"{label} certificate expiry",
            (),
            device_class="timestamp",
            operation="timestamp",
            live=False,
            icon="mdi:certificate-outline",
            fn=lambda i, mid=mid: (
                _record(i, "monitors", mid).get("certInfo") or {}
            ).get("expires")
            if isinstance(_record(i, "monitors", mid).get("certInfo"), Mapping)
            else None,
        )


def _alert_metrics(item: Mapping):
    yield Metric(
        "alerts_active",
        "Active alerts",
        (),
        live=False,
        icon="mdi:bell-alert-outline",
        fn=lambda i: _count(
            i,
            "alerts",
            lambda r: r.get("triggered") if isinstance(r.get("triggered"), bool) else None,
        ),
    )
    for name, record in _records(item, "alerts").items():
        if not isinstance(record, Mapping):
            continue
        key = str(name)
        yield Metric(
            f"alert_{_hex(key)}",
            f"{key} alert",
            (),
            device_class="problem",
            binary=True,
            live=False,
            fn=lambda i, key=key: _record(i, "alerts", key).get("triggered"),
        )
