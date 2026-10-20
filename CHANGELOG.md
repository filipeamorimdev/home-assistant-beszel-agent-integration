# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Systems table: **Show only systems with alerts** (`only_alerts`) hides all-green and offline machines, keeping only those with a warning or critical indicator. When no system has an alert the whole card is hidden (still visible in edit mode).

### Fixed
- Systems table editor: unchecking the last selected system no longer silently selects all systems.
- Systems table: the Temp column now shows the same colour dot as the machine card.

### Changed
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
