# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.3] - 2026-11-11

### Added
- **Beszel Hub update entity** on the Hub device: shows the installed Hub version and, when the Hub runs with `CHECK_UPDATES=true`, the newest release with a link to its notes. Without that setting the latest version stays unknown and the entity's details say to activate `CHECK_UPDATES` on the Hub. The Hub version also appears on the Hub device page.
- **Language per card:** both cards have a **Language of this card** setting (`language: en | pt | es | fr | de`, English by default), so dashboards in different languages can use the same integration. Labels, messages and the names of extra metrics (per core, per drive, per container…) follow it.
- **Translations** of the setup dialogs and main sensor names in Portuguese, Spanish, French and German; they follow Home Assistant's own language.

### Changed
- Card editors: **Terminal** is now a choice in the Layout dropdown instead of a separate checkbox. Cards with `style: terminal` keep working.
- Detailed list (machine card and systems table grid): percentage bars now sit under their value, and on narrow cards each label sits above its value. With split network on, ↓ and ↑ always sit on separate lines.
- Machine card: **Show sensors without a value** and **Split network** now apply to compact tiles and terminal as well as the detailed list. Compact tiles and terminal now show Beszel's combined network total by default; turn on Split network for separate ↓ / ↑.
- Per-container and per-service sensors that were never enabled are removed from Home Assistant once the container or service no longer exists in Beszel, so hosts with short-lived containers no longer fill the entity registry. Sensors you enabled, or disabled yourself, are kept, and nothing is removed when the list could not be read.

### Fixed
- Both cards now show network and disk speeds in the unit you picked in the sensor's settings (for example MB/s) instead of always converting to KiB/s / MiB/s. Sensors left on the default B/s keep Beszel's automatic scaling.
- Both cards now follow the **display precision** set in a sensor's settings (CPU, memory, disk, GPU, battery, load, temperature, sizes, speeds in a chosen unit, extra metrics), in every layout. Sensors without one keep the cards' usual rounding.
- Extra metrics that report plain bytes or bytes per second (network and disk byte counters, per-interface speeds) are now scaled to a readable unit instead of showing a long raw number; a unit picked in Home Assistant is kept as chosen and a display precision applies to the scaled value too.
- Detailed list: long labels such as "Containers unhealthy" no longer overlap their values; the label column is wider and very long labels are shortened with "…" (full name on hover) ([#1](https://github.com/filipeamorimdev/home-assistant-beszel-agent-integration/issues/1)).
- Both cards check for changes far more cheaply on every Home Assistant update, which matters most on old tablets.
- The native terminal (Markdown) card renders several times faster with many systems; its output is unchanged.
- Sensor discovery runs once per update instead of once per platform.

## [0.1.2.1] - 2026-11-09

### Changed
- The integration is now called **Beszel Agent Integration** (was "Home Assistant Beszel Agent Integration"). Existing setups, devices and entities are unchanged.
- The integration icon is now the Beszel logo.
- The README is now a short landing page; installation, card and sensor details moved to `docs/`.

### Fixed
- Card editors: checkbox options (display toggles, systems, columns) showed no labels on current Home Assistant versions, which no longer ship the `ha-formfield` element. They now use labelled native checkboxes.

## [0.1.2] - 2026-11-09

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
