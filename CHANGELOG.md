# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
