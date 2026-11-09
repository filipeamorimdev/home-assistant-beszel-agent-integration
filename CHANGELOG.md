# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **HACS support** as a custom repository (`hacs.json`), an integration icon (shown by Home Assistant 2026.3+), and CI that runs the tests, `hassfest` and the HACS validator.
- Drives (SMART), ZFS pool detail, containers, systemd services, network monitors and Beszel alerts are now imported as sensors on each system's device. Per-container, per-service, per-vdev and per-dataset sensors are disabled by default.
- A repair warning when the Hub is reached over plain `http://` outside the local network.
- Devices for systems the Hub no longer reports can be deleted from the device page.
- `SECURITY.md` with private vulnerability reporting.
- Systems table: **Show only systems with alerts** (`only_alerts`) hides all-green and offline machines, keeping only those with a warning or critical indicator. When no system has an alert the whole card is hidden (still visible in edit mode).

### Fixed
- Startup cleanup of old `beszel_card` dashboard resources no longer removes another card's resource that happens to share the file name `beszel-card.js` / `beszel-overview-card.js`.
- An empty answer from the Hub (for example after a permission change) no longer deletes every Beszel device.
- Refreshing the Beszel session no longer reloads the whole integration.
- Live updates reconnect after unexpected stream errors instead of silently falling back to 5-minute polling.
- Setup text and manifest now pass Home Assistant's `hassfest` validation.
- Systems table editor: unchecking the last selected system no longer silently selects all systems.
- Systems table: the Temp column now shows the same colour dot as the machine card.

### Changed
- The status sensor no longer exposes the agent `host` and `port` attributes (readable by every Home Assistant user and stored in history).
- Machine card: `hide_when_offline` now hides the whole card while the system is offline, like a conditional card, instead of showing the name with a "System offline" label. The card stays visible in dashboard edit mode.

## [0.1.0] - 2026-09-30

First public release.

### Added
- Home Assistant integration for [Beszel](https://beszel.dev/): one device per Beszel system, with sensors for status, CPU, memory, disk, temperature, network, uptime and load. GPU, battery, systemd health and agent version appear when Beszel reports them.
- Live updates from the Hub, with new systems appearing without a restart.
- Bundled Lovelace cards: a machine card (compact and detailed layouts) and a systems table (table, grid and auto layouts), both with visual editors.
- Terminal style for both cards, including a native terminal card for very old browsers (Android 4 / Firefox 68).
- Sign-in with a normal (readonly) Beszel account; the password is used once and only the renewable access token is stored.
- Offline machines are shown as down instead of publishing stale values.

### Not included
- Containers, SMART devices, individual systemd services and ZFS datasets are not imported.
- HACS is not supported yet; install manually (see the README).
