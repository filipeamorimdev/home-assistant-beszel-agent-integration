"""Validated Beszel metric discovery, independent of Home Assistant.

Sizes in system_stats are GiB; new I/O fields are bytes/second.
Missing optional fields remain missing (never fabricate a zero).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from math import isfinite
from typing import Any


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

    def value(self, item: Mapping) -> Any:
        raw = at(item, self.path)
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
        if value < 0 or (
            self.unit == "%" and self.operation != "io_time" and value > 100
        ):
            return None
        return value


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
    for index, name in enumerate(("user", "system", "iowait", "steal", "idle")):
        yield Metric(
            f"cpu_{name}",
            f"CPU {name}",
            ("stats", "cpub", index),
            "%",
            enabled=name in ("user", "system", "iowait"),
        )
    for index, name in enumerate(
        (
            "read_time",
            "write_time",
            "utilization",
            "read_latency",
            "write_latency",
            "weighted_time",
        )
    ):
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
            for suffix, stat in (("total", "d"), ("used", "du")):
                yield Metric(
                    f"{prefix}_{suffix}",
                    f"{label} {name} {suffix}",
                    (*base, stat),
                    "GiB",
                    "data_size",
                    False,
                )
            yield Metric(
                f"{prefix}_free",
                f"{label} {name} free",
                (*base, "d"),
                "GiB",
                "data_size",
                False,
                "difference",
                (*base, "du"),
            )
            yield Metric(
                f"{prefix}_usage",
                f"{label} {name} usage",
                (*base, "du"),
                "%",
                enabled=False,
                operation="ratio",
                other=(*base, "d"),
            )
            for direction, stat, legacy in (("read", "rb", "r"), ("write", "wb", "w")):
                yield Metric(
                    f"{prefix}_{direction}",
                    f"{label} {name} {direction}",
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
                    f"{label} {name} health",
                    (*base, "h"),
                    enabled=False,
                    operation="text",
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
