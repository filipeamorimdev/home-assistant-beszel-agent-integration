# Sensors

[← Back to README](../README.md)

Every Beszel system becomes a device with core sensors: status, CPU, memory, disk, temperature, network, uptime and load. GPU, battery, systemd health and agent version appear when Beszel reports them. New systems appear without a restart, and offline machines show as down instead of publishing stale numbers.

Extra detail, such as RAM and disk totals, swap and fan speed, appears when Beszel reports it. Very detailed sensors (per-core CPU, per-interface network, per-GPU, machine identity) are disabled by default; enable them on the device page.

## Extra data

When Beszel collects them, these are imported too:

| Source | Enabled by default | Disabled by default |
| --- | --- | --- |
| **Drives (SMART)** | Health, temperature, power-on hours, "drives failing SMART" count | Wear, spare, reallocated / pending sectors, serial, firmware |
| **ZFS pools** | Scrub errors, device errors, unhealthy devices | Scrub state, each vdev, each dataset |
| **Containers and services** | Running, unhealthy and update counts | Per-container and per-service sensors |
| **Network monitors** | Response time, packet loss, certificate expiry | Hourly average / min / max |
| **Alerts** | Active alert count, one problem sensor per alert (keeps working while the machine is offline) | |
| **Other** | Package updates, Wi-Fi signal | Filesystem I/O totals |

## Troubleshooting

**Can't see your disks or pools (e.g. TrueNAS)?** Check the Beszel web UI first.

- If Beszel doesn't show them, the agent needs access: use the `henrygd/beszel-agent:alpine` image (it includes `zpool` and `smartctl`) or the agent binary on the host, and add extra disks with `EXTRA_FILESYSTEMS` or mounts under `/extra-filesystems/`.
- If Beszel shows them, enable the matching `Filesystem …` / `ZFS pool …` sensors on the device page.

**A machine is missing.** It appears only once it shows as **Up** in Beszel and your Beszel user can see it.

**Cards look outdated after an update.** Restart Home Assistant and hard-refresh the browser.
