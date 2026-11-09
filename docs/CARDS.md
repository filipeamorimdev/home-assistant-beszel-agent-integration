# Dashboard cards

[← Back to README](../README.md)

Both cards appear in the Lovelace card picker under **Add card**, with a visual editor. Pick a device and the sensors are filled in for you.

![Add Beszel cards](images/add-beszel-cards.jpg)

## Machine card

One server, as compact tiles or as a detailed list.

| Compact tiles | Detailed list |
| --- | --- |
| ![Compact machine card](images/beszel-machine-compact.png) | ![Detailed machine card](images/beszel-machine-detailed.png) |

- **Compact** (default): CPU, RAM and disk tiles with meters and used / total sizes, plus network speed, temperature and uptime.
- **Detailed:** the rows of a Beszel system card (CPU, memory, disk, load, network, temperature, services, uptime, agent) plus any extra metrics you add.
- Meters change colour at the warning / critical thresholds (65% / 90% by default).
- `hide_when_offline: true` hides the whole card while the machine is down. It stays visible in edit mode.

```yaml
type: custom:beszel-machine-card
device_id: 0123456789abcdef0123456789abcdef
title: TrueNAS
layout: detailed          # or compact (default)
hide_when_offline: false
```

![Card configuration](images/beszel-card-configuration.jpg)

## Systems table

Beszel's "All Systems" view for every machine: a sortable table, or a grid of cards that suits phones and narrow columns.

| Table | Grid |
| --- | --- |
| ![Systems table](images/beszel-systems-table.png) | ![Systems grid](images/beszel-systems-grid.png) |

- Click a header to sort; click a row to open the device page.
- Choose only the columns you need. Columns no machine reports are hidden automatically.
- Offline machines stay in the list with blank metrics. `hide_when_offline: true` removes them.
- `only_alerts: true` keeps only machines with an amber or red indicator (high usage, hot CPU, low battery, a failed service, a pending status) and hides the card when there are none. It stays visible in edit mode.

```yaml
type: custom:beszel-systems-table-card
title: Homelab
layout: auto              # table | grid | auto
columns: [cpu, load, temperature]
hide_when_offline: true
only_alerts: false
```

## Terminal style

Turn on **Terminal style** in either editor (`style: terminal`) for a green monospace look that also renders on very old browsers.

| Machine card | Systems list |
| --- | --- |
| ![Terminal style machine card](images/beszel-terminal.png) | ![Terminal style systems list](images/beszel-terminal-systems.png) |

For old tablets where custom cards don't run at all (Android 4), paste the bundled [native terminal card](../custom_components/beszel_machine_card/frontend/beszel-native-terminal.yaml) into a **Manual** card instead.
