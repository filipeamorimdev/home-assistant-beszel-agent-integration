/**
 * beszel-machine-card.js — bundled with the Beszel Agent Integration
 * A Lovelace custom card for one machine monitored by Beszel.
 *
 * Installed and served automatically by custom_components/beszel_machine_card.
 * After configuring the integration, add custom:beszel-machine-card from the
 * dashboard card picker. No separate Lovelace resource is required.
 *
 * Layouts:
 *   layout: compact    # tiles (CPU / RAM / Disk + pinned extras) — default
 *   layout: detailed   # Beszel-style list: CPU, Memory, Disk, GPU, Load, Net…
 *   style: terminal    # plain monospace view for older WebViews
 *
 * CONFIG (easiest via the UI editor — pick a device and everything else is
 * auto-filled from the Home Assistant entity registry):
 *   type: custom:beszel-machine-card
 *   device_id: <registry id>
 *   title: "NAS"                 # optional, defaults to the device name
 *   subtitle: "TrueNAS"          # optional footer label
 *   hide_when_offline: false
 *   show_empty_rows: false       # detailed: keep blank GPU/Bat/Services rows
 *   split_network: false         # detailed: ↓/↑ instead of Beszel's combined total
 *   warning_threshold: 65        # meter colours (Beszel defaults)
 *   critical_threshold: 90
 *   entity_cpu: sensor.nas_cpu_usage   # any entity_* key overrides discovery
 */

import {
  CORE_KEYS,
  DETAIL_CSS,
  THEME_CSS,
  buildSystemModel,
  clampPercent,
  deviceName,
  entityLabel,
  escapeHtml,
  formatNumber,
  formatPercentValue,
  formatRate,
  formatSize,
  formatUptimeShort,
  formatUsedTotal,
  hubConnectionDown,
  hubEntityIds,
  meterLevel,
  openMoreInfo,
  openSystem,
  pick,
  readingNumber,
  renderDetailRows,
  systemEntitiesForDevice,
  systemEntitiesFromSeeds,
  temperatureLevel,
  thresholds,
  validReading,
} from './beszel-common.js?v=0.7.0';

// ─── Sensor discovery heuristics ────────────────────────────────────────────
// For each slot, we try a list of patterns (ordered by confidence).
// The first entity that exists in hass.states wins.

const SENSOR_PATTERNS = {
  status: [
    d => `sensor.${d}_status`,
    d => `binary_sensor.${d}_status`,
    d => `binary_sensor.${d}_connectivity`,
  ],
  cpu: [
    d => `sensor.${d}_cpu_usage`,
    d => `sensor.${d}_cpu_load`,
    d => `sensor.${d}_processor_use`,
    d => `sensor.${d}_cpu`,
  ],
  mem: [
    d => `sensor.${d}_memory_usage`,
    d => `sensor.${d}_ram_usage`,
    d => `sensor.${d}_memory_use_percent`,
    d => `sensor.${d}_memory`,
  ],
  disk: [
    d => `sensor.${d}_disk_usage`,
    d => `sensor.${d}_etc_hostname_disk_usage`,
    d => `sensor.${d}_disk_use_percent`,
    d => `sensor.${d}_disk`,
  ],
  temp: [
    d => `sensor.${d}_cpu_thermal_0_temperature`,
    d => `sensor.${d}_cpu_temperature`,
    d => `sensor.${d}_processor_temperature`,
    d => `sensor.${d}_temperature`,
  ],
  net_rx: [
    d => `sensor.${d}_network_received_speed`,
    d => `sensor.${d}_network_receive_speed`,
    d => `sensor.${d}_eth0_rx`,
    d => `sensor.${d}_end0_rx`,
    d => `sensor.${d}_received`,
    d => `sensor.${d}_network_in`,
    d => `sensor.${d}_throughput_network_in_eth0`,
  ],
  net_tx: [
    d => `sensor.${d}_network_sent_speed`,
    d => `sensor.${d}_network_send_speed`,
    d => `sensor.${d}_eth0_tx`,
    d => `sensor.${d}_end0_tx`,
    d => `sensor.${d}_sent`,
    d => `sensor.${d}_network_out`,
    d => `sensor.${d}_throughput_network_out_eth0`,
  ],
  uptime: [
    d => `sensor.${d}_uptime`,
    d => `sensor.${d}_uptime_2`,
    d => `sensor.${d}_last_boot`,
  ],
};

function autoDetect(devicePrefix, hass) {
  const result = {};
  const prefix = devicePrefix.toLowerCase().replace(/[\s-]/g, '_');
  for (const [slot, patterns] of Object.entries(SENSOR_PATTERNS)) {
    for (const fn of patterns) {
      const id = fn(prefix);
      if (hass.states[id]) { result[slot] = id; break; }
    }
  }
  return result;
}


// Config key → metric key used by beszel-common.
const ENTITY_CONFIG_KEYS = {
  entity_status: 'status',
  entity_cpu: 'cpu_usage',
  entity_mem: 'memory_usage',
  entity_disk: 'disk_usage',
  entity_temp: 'cpu_temperature',
  entity_net_rx: 'network_received_speed',
  entity_net_tx: 'network_sent_speed',
  entity_uptime: 'uptime',
  entity_load_1: 'load_1m',
  entity_load_5: 'load_5m',
  entity_load_15: 'load_15m',
  entity_gpu: 'gpu_usage',
  entity_battery: 'battery',
  entity_services_total: 'services_total',
  entity_services_failed: 'services_failed',
  entity_agent: 'agent_version',
};
const LEGACY_SLOT_KEYS = {
  status: 'status', cpu: 'cpu_usage', mem: 'memory_usage', disk: 'disk_usage',
  temp: 'cpu_temperature', net_rx: 'network_received_speed',
  net_tx: 'network_sent_speed', uptime: 'uptime',
};

// Advanced Beszel metrics are grouped in the editor. Groups match the stable
// unique-ID key ("<system>_<key>"), never the name-derived entity ID.
const ADVANCED_SENSOR_GROUPS = [
  { key: 'processor', label: 'Processor', test: id => /_(cpu_(user|system|iowait|steal|idle)|cpu_core_\d+)$/.test(id) },
  { key: 'memory', label: 'Memory and swap', test: id => /_(memory_(total|used|cache|zfs_arc)|swap_(total|used|usage))$/.test(id) },
  { key: 'storage', label: 'Storage and disk I/O', test: id => /_(disk_(total|used|free|read_speed|write_speed|read_total|write_total|read_time|write_time|utilization|read_latency|write_latency|weighted_time)|(?:efs|z)_[a-f0-9]+_(total|used|free|usage|read|write|health))$/.test(id) },
  { key: 'network', label: 'Network interfaces', test: id => /_network_[a-f0-9]+_(sent_speed|received_speed|sent_total|received_total)$/.test(id) },
  { key: 'cooling', label: 'Temperatures and fans', test: id => /_(t|f)_[a-f0-9]+$/.test(id) },
  { key: 'graphics', label: 'GPU and battery', test: id => /_(gpu_[a-f0-9]+_(u|mu|mt|p|pp)|bats_[a-f0-9]+)$/.test(id) },
  { key: 'about', label: 'Machine details', test: id => /_system_(hostname|os_name|kernel|cpu|arch|cores|threads)$/.test(id) },
];
const CORE_SENSOR_SUFFIXES = new Set(['status','cpu_usage','memory_usage','disk_usage','cpu_temperature','network_received_speed','network_sent_speed','uptime','load_1m','load_5m','load_15m','gpu_usage','battery','services_total','services_failed','agent_version','hub_connection']);

// "_<metric key>" from the registry unique ID, or the entity ID as a fallback.
function advancedKey(entityId, registry) {
  const uniqueId = (registry && typeof registry.get === 'function' ? pick(registry.get(entityId), 'unique_id') : undefined);
  if (typeof uniqueId === 'string' && uniqueId.includes('_')) {
    return `_${uniqueId.slice(uniqueId.indexOf('_') + 1).toLowerCase()}`;
  }
  return String(entityId || '').toLowerCase();
}
function advancedSensorGroup(entityId, registry) {
  const id = advancedKey(entityId, registry);
  const parts = id.split('_');
  if (CORE_SENSOR_SUFFIXES.has(parts.slice(-2).join('_')) || CORE_SENSOR_SUFFIXES.has(parts.slice(-3).join('_')) || CORE_SENSOR_SUFFIXES.has(id.slice(1))) return null;
  return ADVANCED_SENSOR_GROUPS.find(group => group.test(id)) || null;
}
function advancedSensorLabel(entityId, hass) {
  return entityLabel(hass, entityId);
}
function advancedSensorState(entityId, hass) {
  const value = pick(hass, 'states', entityId, 'state');
  if (!validReading(value)) return '';
  const unit = pick(hass, 'states', entityId, 'attributes', 'unit_of_measurement') || '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return /B$/.test(unit) ? n.toFixed(1) : formatNumber(n);
}

function asciiBar(pct, width = 12) {
  const n = readingNumber(pct);
  if (!Number.isFinite(n) || n < 0) return `[${'.'.repeat(width)}]`;
  const filled = Math.round(Math.min(100, n) / 100 * width);
  return `[${'#'.repeat(filled)}${'.'.repeat(Math.max(0, width - filled))}]`;
}

// ─── Card renderer ───────────────────────────────────────────────────────────
const BASE_CSS = `
  :host { display: block; min-width: 0; container: machine-card / inline-size; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .card {
    padding: 14px 16px;
    font-family: var(--ha-font-family-body, var(--paper-font-common-base_-_font-family, sans-serif));
    color: var(--primary-text-color);
  }
  .offline { padding: 18px 8px; text-align: center; color: var(--secondary-text-color); font-size: 12px; }
  .hub-warning {
    padding: 7px 9px; margin-bottom: 9px; border-radius: 6px;
    color: var(--bz-warn); background: rgba(186, 117, 23, .12); font-size: 12px;
  }
  .subtitle { min-width: 0; overflow-wrap: anywhere; font-size: 10px; font-family: monospace; color: var(--secondary-text-color); }
`;

const COMPACT_CSS = `
  .header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px 8px; margin-bottom: 10px; }
  .title { min-width: 0; overflow-wrap: anywhere; font-size: 13px; font-weight: 500; }
  .header-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; max-width: 100%; }
  .status { display: flex; align-items: center; font-family: monospace; font-size: 9px; text-transform: uppercase; color: var(--secondary-text-color); }
  .status .bz-dot { width: 6px; height: 6px; margin-right: 4px; }
  .uptime {
    font-family: monospace; font-size: 10px; padding: 2px 7px; border-radius: 4px; white-space: nowrap;
    color: var(--bz-ok); background: color-mix(in srgb, var(--bz-ok) 15%, transparent);
  }
  .metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .metric {
    min-width: 0; container-type: inline-size; border-radius: 6px; padding: 7px 9px;
    background: var(--secondary-background-color, rgba(127, 127, 127, .08));
  }
  .metrics > .metric:last-child:nth-child(odd) { grid-column: 1 / -1; }
  .metric-label { font-size: 9px; text-transform: uppercase; letter-spacing: .07em; opacity: .7; margin-bottom: 3px; color: var(--secondary-text-color); overflow-wrap: anywhere; }
  .metric-val { font-family: monospace; font-size: 16px; font-size: clamp(10px, 15cqi, 16px); font-weight: 500; }
  .metric-unit { font-family: monospace; font-size: 9px; font-size: clamp(7px, 9cqi, 9px); opacity: .6; margin-left: 1px; }
  .metric-sub { font-family: monospace; font-size: 10px; color: var(--secondary-text-color); margin-top: 2px; overflow-wrap: anywhere; }
  .bar-wrap { margin-top: 5px; height: 3px; border-radius: 2px; overflow: hidden; background: var(--bz-track); }
  .bar-fill { height: 100%; border-radius: 2px; transition: width .6s ease; }
  .footer { display: flex; flex-wrap: wrap; gap: 4px 8px; justify-content: space-between; align-items: center; margin-top: 8px; }
  .net { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-width: 0; font-family: monospace; font-size: 11px; color: var(--secondary-text-color); }
  .temp { display: inline-flex; align-items: center; color: var(--primary-text-color); white-space: nowrap; }
  .temp .bz-dot { width: 6px; height: 6px; margin-right: 5px; }
  @container machine-card (max-width: 130px) { .metrics { grid-template-columns: minmax(0, 1fr); } }
`;

const DETAILED_CSS = `
  .card.detailed { padding: 0; }
  .bz-head { display: flex; align-items: center; gap: 4px; padding: 10px 10px 10px 16px; border-bottom: 1px solid var(--bz-track); }
  .bz-name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 14px; font-weight: 600; }
  .bz-menu {
    display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px;
    border: 0; border-radius: 6px; background: none; color: var(--secondary-text-color); cursor: pointer;
  }
  .bz-menu:hover { background: var(--secondary-background-color, rgba(127, 127, 127, .12)); }
  .bz-menu ha-icon { --mdc-icon-size: 18px; }
  .bz-body { padding: 14px 16px; }
  .bz-body .footer { display: flex; justify-content: flex-end; margin-top: 10px; }
`;

class BeszelMachineCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const signature = JSON.stringify(this._watchedIds().map(id => pick(hass, 'states', id)));
    if (signature === this._stateSignature) return;
    this._stateSignature = signature;
    this._render();
  }

  setConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('beszel-machine-card: configuration must be an object');
    }
    this._config = { ...config };
    this._resolved = null;
    this._stateSignature = undefined;
    this._render();
  }

  getCardSize() { return this._layout() === 'detailed' ? 7 : 4; }

  // New configs use `layout`. Legacy `view: compact` was the icon list, which
  // is now the Beszel-style detailed layout; legacy `view: full` was the tiles.
  _layout() {
    const c = this._config || {};
    if (c.layout === 'compact' || c.layout === 'detailed') return c.layout;
    return c.view === 'compact' ? 'detailed' : 'compact';
  }

  _explicitEntities() {
    const c = this._config || {};
    const result = {};
    if (c.device) {
      for (const [slot, id] of Object.entries(autoDetect(c.device, this._hass || { states: {} }))) {
        if (LEGACY_SLOT_KEYS[slot]) result[LEGACY_SLOT_KEYS[slot]] = id;
      }
    }
    for (const [configKey, key] of Object.entries(ENTITY_CONFIG_KEYS)) {
      if (typeof c[configKey] === 'string' && c[configKey]) result[key] = c[configKey];
    }
    return result;
  }

  // Cards saved by the visual editor carry a device plus entity_* slots (empty
  // string = deliberately left blank). Those selections are authoritative.
  _editorManaged() {
    const c = this._config || {};
    return Boolean(c.device_id)
      && Object.keys(ENTITY_CONFIG_KEYS).some(key => Object.prototype.hasOwnProperty.call(c, key));
  }

  // Resolve every metric. Editor-managed cards show only the selected slots,
  // plus expanded metrics (RAM/disk sizes, cache, fans) chosen under
  // "Additional Beszel metrics". Minimal YAML (device_id only) resolves every
  // metric from the device's registry entities; entity_* only configs derive
  // siblings of the configured IDs.
  _entities() {
    const hass = this._hass;
    if (this._resolved && this._resolved.config === this._config
        && this._resolved.registry === pick(hass, 'entities') && pick(hass, 'entities')) {
      return this._resolved.value;
    }
    const explicit = this._explicitEntities();
    const seeds = Object.values(explicit);
    const deviceId = this._config.device_id
      || seeds.map(id => pick(hass, 'entities', id, 'device_id')).find(Boolean)
      || '';
    const discovered = deviceId && pick(hass, 'entities')
      ? systemEntitiesForDevice(hass, deviceId)
      : systemEntitiesFromSeeds(hass, seeds);
    let base = discovered;
    if (this._editorManaged()) {
      const chosen = new Set(this._config.extra_entities || []);
      base = {};
      for (const [key, id] of Object.entries(discovered)) {
        if (key === 'fans') {
          const fans = id.filter(fan => chosen.has(fan));
          if (fans.length) base.fans = fans;
        } else if (!CORE_KEYS.includes(key) && chosen.has(id)) {
          base[key] = id;
        }
      }
    }
    const value = { entities: { ...base, ...explicit }, deviceId };
    this._resolved = { config: this._config, registry: pick(hass, 'entities'), value };
    return value;
  }

  _extraIds(layout = this._layout()) {
    const c = this._config || {};
    const all = Array.isArray(c.extra_entities) ? c.extra_entities : [];
    if (layout === 'detailed') return all;
    return Array.isArray(c.extra_pinned) && c.extra_pinned.length ? c.extra_pinned : all;
  }

  _watchedIds() {
    const { entities } = this._entities();
    return [
      ...Object.values(entities).flat(),
      ...(this._config.extra_entities || []),
      ...(this._config.extra_pinned || []),
      ...(this._config.show_hub_status === true ? hubEntityIds(this._hass) : []),
    ];
  }

  _extras(skip = new Set()) {
    return this._extraIds()
      .filter(id => !skip.has(id))
      .map(id => ({
        id,
        label: entityLabel(this._hass, id),
        value: advancedSensorState(id, this._hass),
        unit: pick(this._hass, 'states', id, 'attributes', 'unit_of_measurement') || '',
      }))
      .filter(extra => extra.value);
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (this._config.style === 'terminal') {
      this._renderTerminal();
      return;
    }
    const c = this._config;
    const { entities, deviceId } = this._entities();
    const model = buildSystemModel(this._hass, entities);
    const limits = thresholds(c);
    const layout = this._layout();
    const name = c.title || c.device_name || deviceName(this._hass, deviceId) || c.device || 'Beszel machine';
    const offline = c.hide_when_offline === true && model.statusClass === 'down';
    const hubDown = c.show_hub_status === true && hubConnectionDown(this._hass);
    const warning = hubDown
      ? '<div class="hub-warning">Beszel Hub is unreachable. Displayed values may be stale.</div>'
      : '';
    const body = layout === 'detailed'
      ? this._detailedHtml(model, limits, entities, name, warning, offline)
      : this._compactHtml(model, limits, entities, name, warning, offline);

    this.shadowRoot.innerHTML = `
      <style>${THEME_CSS}${BASE_CSS}${layout === 'detailed' ? `${DETAIL_CSS}${DETAILED_CSS}` : COMPACT_CSS}</style>
      <ha-card><div class="card ${layout}">${body}</div></ha-card>`;

    const menu = (this.shadowRoot.querySelector ? this.shadowRoot.querySelector('.bz-menu') : null);
    if (menu) {
      menu.addEventListener('click', () => openSystem(this, this._hass, {
        deviceId, entityId: entities.status,
      }, c.menu_action || 'device'));
    }
  }

  _tile(label, value, limits, sub = '') {
    const has = Number.isFinite(value);
    const fill = has
      ? `<div class="bar-fill bz-${meterLevel(value, limits)}" style="width:${clampPercent(value)}%"></div>`
      : '';
    return `<div class="metric"><div class="metric-label">${escapeHtml(label)}</div>`
      + `<span class="metric-val">${escapeHtml(formatPercentValue(value))}</span><span class="metric-unit">${has ? '%' : ''}</span>`
      + `${sub ? `<div class="metric-sub">${escapeHtml(sub)}</div>` : ''}`
      + `<div class="bar-wrap">${fill}</div></div>`;
  }

  _compactHtml(model, limits, entities, name, warning, offline) {
    const c = this._config;
    const statusLabel = model.status;
    const uptime = formatUptimeShort(model.uptime);
    const header = `<div class="header"><div class="title">${escapeHtml(name)}</div>
      <div class="header-meta">
        ${statusLabel ? `<div class="status ${model.statusClass}"><span class="bz-dot bz-${meterLevelForStatus(model.statusClass)}"></span>${escapeHtml(statusLabel)}</div>` : ''}
        ${uptime ? `<div class="uptime">↑ ${escapeHtml(uptime)}</div>` : ''}
      </div></div>`;
    if (offline) return `${header}${warning}<div class="offline">System offline</div>`;

    const memorySub = [
      formatUsedTotal(model.memoryUsed, model.memoryTotal),
      model.memoryCache ? `cache ${formatSize(model.memoryCache)}` : '',
    ].filter(Boolean).join(' · ');
    const diskSub = formatUsedTotal(model.diskUsed, model.diskTotal);
    // Memory/disk sizes are merged into their tiles; don't repeat them.
    const merged = new Set([
      entities.memory_used, entities.memory_total, entities.memory_cache,
      entities.disk_used, entities.disk_total,
    ].filter(Boolean));
    // A tile appears only when its sensor is selected and has a valid reading.
    const tiles = [
      ['CPU', model.cpu, ''],
      ['RAM', model.memory, memorySub],
      ['Disk', model.disk, diskSub],
      ['GPU', model.gpu, ''],
    ].filter(([, value]) => Number.isFinite(value))
      .map(([label, value, sub]) => this._tile(label, value, limits, sub));
    for (const extra of this._extras(merged)) {
      tiles.push(`<div class="metric extra-row"><div class="metric-label">${escapeHtml(extra.label)}</div>`
        + `<span class="metric-val">${escapeHtml(extra.value)}</span><span class="metric-unit">${escapeHtml(extra.unit)}</span></div>`);
    }

    const rx = formatRate(model.rx);
    const tx = formatRate(model.tx);
    const temp = model.temperature
      ? `<span class="temp"><span class="bz-dot bz-${temperatureLevel(model.temperature.celsius)}"></span>${escapeHtml(model.temperature.text)}</span>`
      : '';
    const net = [rx && `<span>↓ ${escapeHtml(rx)}</span>`, tx && `<span>↑ ${escapeHtml(tx)}</span>`, temp]
      .filter(Boolean).join('');
    const footer = net || c.subtitle
      ? `<div class="footer"><div class="net">${net}</div>${c.subtitle ? `<div class="subtitle">${escapeHtml(c.subtitle)}</div>` : ''}</div>`
      : '';
    const metrics = tiles.length ? `<div class="metrics">${tiles.join('')}</div>` : '';
    return `${header}${warning}${metrics}${footer}`;
  }

  _detailedHtml(model, limits, entities, name, warning, offline) {
    const c = this._config;
    const menu = entities.status || this._entities().deviceId
      ? '<button class="bz-menu" type="button" title="Open device" aria-label="Open device"><ha-icon icon="mdi:dots-horizontal"></ha-icon></button>'
      : '';
    const head = `<div class="bz-head"><span class="bz-dot bz-${meterLevelForStatus(model.statusClass)}"></span><span class="bz-name">${escapeHtml(name)}</span>${menu}</div>`;
    const rows = offline
      ? '<div class="offline">System offline</div>'
      : renderDetailRows(model, {
        limits,
        showEmpty: c.show_empty_rows === true,
        splitNetwork: c.split_network === true,
        extras: this._extras(),
      });
    const footer = c.subtitle ? `<div class="footer"><div class="subtitle">${escapeHtml(c.subtitle)}</div></div>` : '';
    return `${head}<div class="bz-body">${warning}${rows}${footer}</div>`;
  }

  _renderTerminal() {
    const c = this._config;
    const { entities } = this._entities();
    const model = buildSystemModel(this._hass, entities);
    const title = c.title || c.device_name || deviceName(this._hass, this._entities().deviceId) || c.device || 'machine';
    const offline = c.hide_when_offline === true && model.statusClass === 'down';
    const statusMark = model.statusClass === 'up' ? 'OK' : model.statusClass === 'pending' ? '..' : '!!';
    const pct = value => (Number.isFinite(value) ? `${value.toFixed(1)}%` : '');
    // Rows without a selected, valid reading are skipped entirely.
    const line = (label, bar, value) => !value ? '' :
      `<tr><td class="k">${escapeHtml((label + '     ').slice(0, 5))}</td>`
      + `<td class="b">${escapeHtml(bar)}</td>`
      + `<td class="v">${escapeHtml(value)}</td></tr>`;
    const blank = '            ';

    let rows = '';
    if (offline) {
      rows = '<tr><td colspan="3" class="off">system offline</td></tr>';
    } else {
      rows += line('cpu', asciiBar(model.cpu), pct(model.cpu));
      rows += line('mem', asciiBar(model.memory), pct(model.memory));
      rows += line('disk', asciiBar(model.disk), pct(model.disk));
      const rx = formatRate(model.rx);
      const tx = formatRate(model.tx);
      rows += line('net', blank, [rx && `rx ${rx}`, tx && `tx ${tx}`].filter(Boolean).join('  '));
      rows += line('up', blank, formatUptimeShort(model.uptime));
      for (const extra of this._extras()) {
        const label = String(extra.id).replace(/^.*_/, '').slice(0, 5);
        rows += line(label, blank, `${extra.value}${extra.unit ? ` ${extra.unit}` : ''}`);
      }
      const temp = model.temperature;
      rows += line('temp', blank, temp ? `${temp.value.toFixed(1)}${temp.unit.replace('°', '')}` : '');
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        .term {
          background:#0b0f0c; color:#33ff66; border:1px solid #1f3d28;
          padding:8px; font-family:"Courier New",Courier,monospace;
          font-size:12px; line-height:1.35;
        }
        .head { margin:0 0 6px 0; white-space:pre; }
        table { width:100%; border-collapse:collapse; }
        td { padding:1px 4px; vertical-align:top; }
        td.k { width:3.5em; color:#7CFF9B; }
        td.b { width:14em; color:#2bd464; white-space:pre; }
        td.v { text-align:right; white-space:nowrap; }
        td.off { color:#ff6666; text-align:center; padding:10px 0; }
        .foot { margin-top:6px; color:#1f8f45; font-size:11px; }
      </style>
      <div class="term">
        <div class="head">+-- ${escapeHtml(title)} [${escapeHtml(statusMark)}] ${escapeHtml(model.status)} --+</div>
        ${c.subtitle ? `<div class="foot">${escapeHtml(c.subtitle)}</div>` : ''}
        <table>${rows}</table>
      </div>`;
  }

  // ─── UI Editor ────────────────────────────────────────────────────────────
  static getConfigElement() {
    return document.createElement('beszel-machine-card-editor');
  }

  static getStubConfig() {
    return {
      device_id: '',
      device_name: '',
      title: '',
      subtitle: '',
      layout: 'compact',
      style: 'default',
      hide_when_offline: false,
      show_empty_rows: false,
      split_network: false,
      extra_entities: [],
      extra_pinned: [],
    };
  }
}

function meterLevelForStatus(statusClassName) {
  return { up: 'ok', pending: 'warn', down: 'crit', unknown: 'none' }[statusClassName] || 'none';
}

function editorLayout(config) {
  if (pick(config, 'layout') === 'compact' || pick(config, 'layout') === 'detailed') return config.layout;
  return pick(config, 'view') === 'compact' ? 'detailed' : 'compact';
}

// ─── UI Editor element ───────────────────────────────────────────────────────
// Built on Home Assistant form elements, including its native entity picker.
class BeszelMachineCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._devices = [];
    this._devicesLoaded = false;
    this._entityRegistry = new Map();
    this._openAdvancedGroups = new Set();
  }

  set hass(value) {
    this._hass = value;
    this._syncNativePickerContext();
    if (value && !this._devicesLoaded) this._loadDevices();
    // HA pushes a new hass object frequently. Preserve focus and open menus
    // by updating in place instead of rebuilding the editor.
    if (!this.shadowRoot.querySelector('.editor')) {
      this._render();
    }
  }

  get hass() { return this._hass; }

  setConfig(config) {
    const previous = this._config || {};
    this._config = { ...config };
    if (!this.shadowRoot.getElementById('advanced-sensors')) {
      this._render();
      return;
    }
    // Keep expanded advanced groups open when only their selection changes.
    if (this._onlyAdvancedConfigChanged(previous, this._config)) {
      this._renderAdvancedSensors();
      return;
    }
    // Never wipe the whole form on every config push — update controls in place.
    this._syncEditorFromConfig(previous);
  }

  connectedCallback() { this._render(); }

  _onlyAdvancedConfigChanged(previous, next) {
    const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
    for (const key of keys) {
      if (key === 'extra_entities' || key === 'extra_pinned') continue;
      if (JSON.stringify(pick(previous, key)) !== JSON.stringify(pick(next, key))) {
        return false;
      }
    }
    return true;
  }

  _syncEditorFromConfig(previous = {}) {
    const c = this._config || {};
    const root = this.shadowRoot;
    if (!root || !this.hass) return;

    for (const key of ['title', 'subtitle']) {
      const input = root.getElementById(key);
      if (input && input.value !== (c[key] || '')) input.value = c[key] || '';
    }

    const hideWhenOffline = root.getElementById('hide-when-offline');
    if (hideWhenOffline) hideWhenOffline.checked = c.hide_when_offline === true;
    const layout = root.getElementById('layout');
    if (layout && layout.value !== editorLayout(c)) layout.value = editorLayout(c);
    const showEmpty = root.getElementById('show-empty-rows');
    if (showEmpty) showEmpty.checked = c.show_empty_rows === true;
    const splitNetwork = root.getElementById('split-network');
    if (splitNetwork) splitNetwork.checked = c.split_network === true;
    const terminalStyle = root.getElementById('terminal-style');
    if (terminalStyle) terminalStyle.checked = c.style === 'terminal';

    const select = root.getElementById('device');
    if (select && select.value !== (c.device_id || '')) {
      select.value = c.device_id || '';
    }

    const autofill = root.getElementById('autofill');
    if (autofill) autofill.disabled = !c.device_id;

    const deviceChanged = previous.device_id !== c.device_id;
    const pickers = root.getElementById('entity-pickers');
    const pickersNeedFill = Boolean(
      c.device_id
      && pickers
      && /Pick a device first/.test(pickers.textContent || '')
    );
    if (deviceChanged || pickersNeedFill) {
      this._renderEntitySelects();
    } else {
      for (const field of BeszelMachineCardEditor.FIELDS) {
        const picker = root.querySelector(`ha-entity-picker[data-key="${field.key}"]`);
        if (picker && picker.value !== (c[field.key] || '')) {
          picker.value = c[field.key] || '';
        }
      }
    }

    if (deviceChanged || previous.extra_entities !== c.extra_entities
        || previous.extra_pinned !== c.extra_pinned) {
      this._renderAdvancedSensors();
    }
  }

  // Field slots rendered as entity pickers.
  static get FIELDS() {
    return [
      { key: 'entity_status', label: 'Status', icon: 'mdi:server-network' },
      { key: 'entity_cpu',    label: 'CPU', icon: 'mdi:cpu-64-bit' },
      { key: 'entity_mem',    label: 'Memory', icon: 'mdi:memory' },
      { key: 'entity_disk',   label: 'Disk', icon: 'mdi:harddisk' },
      { key: 'entity_temp',   label: 'Temperature', icon: 'mdi:thermometer' },
      { key: 'entity_net_rx', label: 'Network ↓ (RX)', icon: 'mdi:download-network' },
      { key: 'entity_net_tx', label: 'Network ↑ (TX)', icon: 'mdi:upload-network' },
      { key: 'entity_uptime', label: 'Uptime', icon: 'mdi:clock-outline' },
      { key: 'entity_load_1', label: 'Load average (1 min)', icon: 'mdi:chart-timeline-variant' },
      { key: 'entity_load_5', label: 'Load average (5 min)', icon: 'mdi:chart-timeline-variant' },
      { key: 'entity_load_15', label: 'Load average (15 min)', icon: 'mdi:chart-timeline-variant' },
      { key: 'entity_gpu', label: 'GPU usage', icon: 'mdi:expansion-card-variant' },
      { key: 'entity_battery', label: 'Battery', icon: 'mdi:battery' },
      { key: 'entity_services_total', label: 'Systemd services', icon: 'mdi:console-line' },
      { key: 'entity_services_failed', label: 'Failed services', icon: 'mdi:alert-circle-outline' },
      { key: 'entity_agent', label: 'Agent version', icon: 'mdi:access-point' },
    ];
  }

  // Pull devices that belong to the Beszel integration from the registries.
  async _loadDevices() {
    if (this._devicesLoaded || !pick(this.hass, 'callWS')) return;
    this._devicesLoaded = true;
    try {
      const [entries, devices, entities] = await Promise.all([
        this.hass.callWS({ type: 'config_entries/get' }),
        this.hass.callWS({ type: 'config/device_registry/list' }),
        this.hass.callWS({ type: 'config/entity_registry/list' }),
      ]);

      // Config-entry IDs for this integration.
      const beszelEntries = new Set(
        entries
          .filter(e => e.domain === 'beszel_machine_card')
          .map(e => e.entry_id)
      );

      // A device belongs to Beszel if any of its config entries is a Beszel
      // entry, OR (fallback) it owns an entity whose platform is this integration.
      const beszelDeviceIds = new Set();
      for (const dev of devices) {
        const ids = dev.config_entries || [];
        if (ids.some(id => beszelEntries.has(id))) beszelDeviceIds.add(dev.id);
      }
      for (const ent of entities) {
        if (ent.platform === 'beszel_machine_card' && ent.device_id) {
          beszelDeviceIds.add(ent.device_id);
        }
      }

      const list = devices
        .filter(d => beszelDeviceIds.has(d.id))
        .map(d => ({ id: d.id, name: d.name_by_user || d.name || d.id }))
        .sort((a, b) => a.name.localeCompare(b.name));

      this._devices = list;
      this._deviceRegistry = Object.fromEntries(devices.map(device => [device.id, device]));

      // Keep entity registry entries keyed by device for auto-fill.
      this._entityRegistry = new Map(entities.map(ent => [ent.entity_id, ent]));
      this._entitiesByDevice = new Map();
      for (const ent of entities) {
        if (ent.platform !== 'beszel_machine_card' || !ent.device_id) continue;
        if (!this._entitiesByDevice.has(ent.device_id)) {
          this._entitiesByDevice.set(ent.device_id, []);
        }
        this._entitiesByDevice.get(ent.device_id).push(ent.entity_id);
      }
      this._syncNativePickerContext();
      if (this.shadowRoot.getElementById('device')) {
        this._refreshDeviceSelect();
        this._syncEditorFromConfig();
      } else {
        this._render();
      }
    } catch (e) {
      console.debug('beszel-machine-card: device lookup failed', e);
      this._devices = [];
      if (this.shadowRoot.getElementById('device')) {
        this._refreshDeviceSelect();
      } else {
        this._render();
      }
    }
  }

  _refreshDeviceSelect() {
    const select = this.shadowRoot.getElementById('device');
    if (!select) return;
    const devices = this._devices || [];
    const current = this._config.device_id || '';
    select.innerHTML = devices.length === 0
      ? '<option value="">No Beszel devices found</option>'
      : ['<option value="">Select a device</option>'].concat(
          devices.map(d =>
            `<option value="${escapeHtml(d.id)}"${d.id === current ? ' selected' : ''}>${escapeHtml(d.name)}</option>`
          )
        ).join('');
    select.value = current;
  }

  _emit(patch) {
    const previous = this._config;
    this._config = { ...this._config, ...patch };
    // Update controls now: HA may echo an identical config, or no config at all.
    this._syncEditorFromConfig(previous);
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    }));
  }

  _textChanged(ev) {
    const id = ev.target.dataset.key;
    this._emit({ [id]: ev.target.value });
  }

  _deviceChanged(ev) {
    const id = pick(ev.target, 'value') || '';
    if (id === this._config.device_id) return;
    const selected = this._devices.find(device => device.id === id);
    const patch = {
      device_id: id,
      device_name: pick(selected, 'name') || '',
      extra_entities: [],
      extra_pinned: [],
    };
    for (const field of BeszelMachineCardEditor.FIELDS) patch[field.key] = '';
    // Publish the device and its sensors together, without an intermediate
    // config that pairs the new device with the previous device's readings.
    this._emit({ ...patch, ...this._autoFillPatch(patch) });
  }

  _entityChanged(ev) {
    const key = ev.target.dataset.key;
    this._emit({ [key]: pick(ev.detail, 'value') || '' });
  }

  _deviceEntityIds() {
    const deviceId = this._config.device_id;
    if (!deviceId || !this._entitiesByDevice) return [];
    return this._entitiesByDevice.get(deviceId) || [];
  }

  _entitiesForField(field) {
    const pattern = BeszelMachineCardEditor.FIELD_PATTERNS[field.key];
    return this._deviceEntityIds().filter(id => {
      const uniqueId = pick(this._entityRegistry ? this._entityRegistry.get(id) : undefined, 'unique_id') || id;
      return Boolean(pattern && pattern.test(uniqueId));
    });
  }

  _syncNativePickerContext() {
    if (!this._hass) return;
    const registries = {
      entities: Object.fromEntries(this._entityRegistry || []),
      devices: this._deviceRegistry || {},
      areas: this._hass.areas || {},
      floors: this._hass.floors || {},
      labels: this._hass.labels || {},
    };
    const i18n = {
      language: this._hass.language || 'en',
      locale: this._hass.locale || { language: this._hass.language || 'en' },
      translationMetadata: this._hass.translationMetadata || {},
      localize: (key, ...args) => (this._hass.localize ? this._hass.localize(key, ...args) : '') || key,
      loadBackendTranslation: () => Promise.resolve(),
      loadFragmentTranslation: () => Promise.resolve(),
    };
    for (const picker of this.shadowRoot.querySelectorAll('ha-entity-picker') || []) {
      // The card-editor shadow root has no Lit context provider; seed the
      // native picker with HA's read-only state, registry, and translation data.
      picker._states = this._hass.states || {};
      picker._registries = registries;
      picker._i18n = i18n;
      picker._config = { ...(this._hass.config || {}), userData: {} };
    }
  }

  _renderEntitySelects() {
    const host = this.shadowRoot.getElementById('entity-pickers');
    if (!host) return;
    const c = this._config || {};
    host.innerHTML = BeszelMachineCardEditor.FIELDS.map(field =>
      `<ha-entity-picker class="native-entity-picker" data-key="${escapeHtml(field.key)}"></ha-entity-picker>`
    ).join('');
    for (const picker of host.querySelectorAll('ha-entity-picker[data-key]')) {
      const field = BeszelMachineCardEditor.FIELDS.find(item => item.key === picker.dataset.key);
      picker.label = field.label;
      picker.includeDomains = ['sensor'];
      picker.includeEntities = this._entitiesForField(field);
      picker.allowCustomEntity = false;
      picker.disabled = !c.device_id;
      picker.value = c[field.key] || '';
      picker.addEventListener('value-changed', ev => this._entityChanged(ev));
    }
    this._syncNativePickerContext();
  }

  _advancedEntities() {
    return ((this._entitiesByDevice && this._entitiesByDevice.get(this._config.device_id)) || [])
      .filter(id => advancedSensorGroup(id, this._entityRegistry));
  }

  _setAdvancedEntities(ids, pins = this._config.extra_pinned || []) {
    const unique = [...new Set(ids)];
    this._emit({ extra_entities: unique, extra_pinned: pins.filter(id => unique.includes(id)) });
    this._renderAdvancedSensors();
  }

  _applyAdvancedPreset(value) {
    const available = this._advancedEntities();
    const ids = value === 'all'
      ? available
      : available.filter(id => value === 'storage'
        ? /_(disk_|memory_(total|used)|swap_)/.test(advancedKey(id, this._entityRegistry))
        : /_(cpu_(user|system|iowait)|disk_(read_speed|write_speed|read_latency|write_latency)|t_|f_)/.test(advancedKey(id, this._entityRegistry)));
    const pins = ids.filter(id => /_(disk_free|disk_read_speed|disk_write_speed|cpu_user|cpu_system)$/.test(advancedKey(id, this._entityRegistry)));
    this._setAdvancedEntities(ids, pins);
  }

  _rememberOpenAdvancedGroups() {
    this.shadowRoot.querySelectorAll('#advanced-sensors details[data-group]').forEach(el => {
      if (!el.dataset.group) return;
      if (el.open) this._openAdvancedGroups.add(el.dataset.group);
      else this._openAdvancedGroups.delete(el.dataset.group);
    });
  }

  _renderAdvancedSensors() {
    const host = this.shadowRoot.getElementById('advanced-sensors');
    if (!host) return;
    this._rememberOpenAdvancedGroups();
    const selected = new Set(this._config.extra_entities || []);
    const pinned = new Set(this._config.extra_pinned || []);
    const available = this._advancedEntities();
    host.innerHTML = ADVANCED_SENSOR_GROUPS.map(group => {
      const ids = available.filter(id => pick(advancedSensorGroup(id, this._entityRegistry), 'key') === group.key);
      if (!ids.length) return '';
      const count = ids.filter(id => selected.has(id)).length;
      const open = this._openAdvancedGroups.has(group.key) ? ' open' : '';
      return `<details data-group="${escapeHtml(group.key)}"${open}><summary>${escapeHtml(group.label)} <span class="hint">${count}/${ids.length}</span></summary>
        <div class="advanced-actions"><button type="button" data-advanced-select="${group.key}">Select group</button><button type="button" data-advanced-clear="${group.key}">Clear</button></div>
        ${ids.map(id => {
          const disabled = pick(this._entityRegistry.get(id), 'disabled_by') ? ' (disabled in Home Assistant)' : '';
          const label = advancedSensorLabel(id, this.hass) + disabled;
          return `<div class="advanced-row"><label><input type="checkbox" data-advanced-entity="${escapeHtml(id)}" ${selected.has(id) ? 'checked' : ''}><span>${escapeHtml(label)}</span></label><button type="button" data-advanced-pin="${escapeHtml(id)}" aria-pressed="${pinned.has(id)}">${pinned.has(id) ? 'At a glance' : 'Pin to compact'}</button><button type="button" data-advanced-details="${escapeHtml(id)}">Details</button></div>`;
        }).join('')}
      </details>`;
    }).join('') || '<span class="hint">No advanced sensors are reported by this machine yet.</span>';
    const summary = this.shadowRoot.getElementById('advanced-summary');
    const disabledCount = [...selected].filter(id => pick(this._entityRegistry.get(id), 'disabled_by')).length;
    if (summary) summary.textContent = selected.size ? `${selected.size} selected${disabledCount ? ` · ${disabledCount} need enabling` : ''}` : 'None selected';
    host.querySelectorAll('details[data-group]').forEach(details => {
      details.addEventListener('toggle', () => {
        if (details.open) this._openAdvancedGroups.add(details.dataset.group);
        else this._openAdvancedGroups.delete(details.dataset.group);
      });
    });
    host.querySelectorAll('[data-advanced-entity]').forEach(input => input.addEventListener('change', () => {
      const next = new Set(this._config.extra_entities || []);
      if (input.checked) next.add(input.dataset.advancedEntity); else next.delete(input.dataset.advancedEntity);
      this._setAdvancedEntities([...next]);
    }));
    host.querySelectorAll('[data-advanced-pin]').forEach(button => button.addEventListener('click', () => {
      const next = new Set(this._config.extra_pinned || []);
      if (next.has(button.dataset.advancedPin)) next.delete(button.dataset.advancedPin); else next.add(button.dataset.advancedPin);
      this._setAdvancedEntities(this._config.extra_entities || [], [...next]);
    }));
    host.querySelectorAll('[data-advanced-details]').forEach(button => button.addEventListener('click', () => {
      openMoreInfo(this, button.dataset.advancedDetails);
    }));
    host.querySelectorAll('[data-advanced-select]').forEach(button => button.addEventListener('click', () => {
      const ids = available.filter(id => pick(advancedSensorGroup(id, this._entityRegistry), 'key') === button.dataset.advancedSelect);
      this._setAdvancedEntities([...(this._config.extra_entities || []), ...ids]);
    }));
    host.querySelectorAll('[data-advanced-clear]').forEach(button => button.addEventListener('click', () => {
      const ids = new Set(available.filter(id => pick(advancedSensorGroup(id, this._entityRegistry), 'key') === button.dataset.advancedClear));
      this._setAdvancedEntities((this._config.extra_entities || []).filter(id => !ids.has(id)));
    }));
  }

  // Stable unique-ID suffixes keep each selector and auto-fill tied to one metric.
  static get FIELD_PATTERNS() {
    return {
      entity_status: /_status$/,
      entity_cpu: /_cpu_usage$/,
      entity_mem: /_memory_usage$/,
      entity_disk: /_disk_usage$/,
      entity_temp: /_cpu_temperature$/,
      entity_net_rx: /_network_received_speed$/,
      entity_net_tx: /_network_sent_speed$/,
      entity_uptime: /_uptime$/,
      entity_load_1: /_load_1m$/,
      entity_load_5: /_load_5m$/,
      entity_load_15: /_load_15m$/,
      entity_gpu: /_gpu_usage$/,
      entity_battery: /_battery$/,
      entity_services_total: /_services_total$/,
      entity_services_failed: /_services_failed$/,
      entity_agent: /_agent_version$/,
    };
  }

  // Scan the selected device's entities and fill empty slots by keyword.
  _autoFill() {
    const patch = this._autoFillPatch(this._config);
    if (Object.keys(patch).length) this._emit(patch);
  }

  _autoFillPatch(config) {
    const devId = config.device_id;
    if (!devId) return {};
    const entities = (this._entitiesByDevice && this._entitiesByDevice.get(devId)) || [];
    if (entities.length === 0) return {};

    const patch = {};

    for (const f of BeszelMachineCardEditor.FIELDS) {
      if (config[f.key]) continue; // keep what's already set
      const pattern = BeszelMachineCardEditor.FIELD_PATTERNS[f.key];
      const hit = entities.find(id => pattern && pattern.test(pick(this._entityRegistry ? this._entityRegistry.get(id) : undefined, 'unique_id') || id));
      if (hit) patch[f.key] = hit;
    }
    return patch;
  }

  _render() {
    if (!this.shadowRoot || !this.hass) return;
    const c = this._config;
    const devices = this._devices || [];

    const deviceItems = devices.length === 0
      ? '<option value="">No Beszel devices found</option>'
      : ['<option value="">Select a device</option>'].concat(
          devices.map(d =>
            `<option value="${escapeHtml(d.id)}"${d.id === (c.device_id || '') ? ' selected' : ''}>${escapeHtml(d.name)}</option>`
          )
        ).join('');

    this.shadowRoot.innerHTML = `
      <style>
        .editor { display: flex; flex-direction: column; gap: 8px; padding: 8px 4px; }
        .section-title {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: .08em;
          color: var(--secondary-text-color);
          margin-top: 8px;
        }
        .section-title:first-child { margin-top: 0; }
        #device, #layout, #advanced-preset { display: block; width: 100%; }
        .text-field { display: flex; flex-direction: column; gap: 4px; }
        .text-field input {
          box-sizing: border-box; width: 100%; min-height: 40px; padding: 0 10px;
          border: 1px solid var(--divider-color); border-radius: 4px;
          background: transparent; color: var(--primary-text-color); font: inherit;
        }
        .text-field input:focus { outline: none; border-color: var(--primary-color); }
        .native-entity-picker { display: block; width: 100%; }
        .entity-field { display: flex; flex-direction: column; gap: 4px; }
        .field-label { font-size: 12px; color: var(--primary-text-color); }
        .select-shell {
          position: relative; display:flex; align-items:center; width:100%; min-height:48px;
          border:1px solid var(--input-idle-line-color, var(--divider-color)); border-radius:4px;
          background:var(--input-fill-color, transparent);
        }
        .select-shell:hover { border-color:var(--input-hover-line-color, var(--primary-text-color)); }
        .select-shell:focus-within { border-color:var(--primary-color); box-shadow:inset 0 0 0 1px var(--primary-color); }
        .select-leading, .select-chevron { position:absolute; pointer-events:none; color:var(--secondary-text-color); --mdc-icon-size:22px; }
        .select-leading { left:13px; } .select-chevron { right:11px; }
        #device, #layout, #advanced-preset {
          box-sizing:border-box; min-height:46px; padding:0 42px 0 44px; border:0; outline:0;
          appearance:none; -webkit-appearance:none; background:transparent; color:var(--primary-text-color);
          font:inherit; cursor:pointer;
        }
        #entity-pickers { display: flex; flex-direction: column; gap: 8px; }
        #advanced-sensors { display:flex; flex-direction:column; gap:8px; }
        #advanced-sensors details { border-top:1px solid var(--divider-color); padding:6px 0; }
        #advanced-sensors summary { cursor:pointer; padding:6px 0; }
        .advanced-row { display:flex; justify-content:space-between; gap:8px; align-items:center; padding:5px 0; }
        .advanced-row label { display:flex; gap:8px; align-items:center; min-width:0; }
        .advanced-row label span { overflow-wrap:anywhere; }
        .advanced-row button, .advanced-actions button { font-size:11px; padding:3px 7px; }
        .advanced-actions { display:flex; gap:6px; margin:3px 0; }
        .hint {
          font-size: 11px;
          color: var(--secondary-text-color);
          opacity: 0.8;
        }
        ha-button.autofill {
          --mdc-theme-primary: var(--primary-color);
          align-self: flex-start;
        }
      </style>
      <div class="editor">
        <div class="section-title">Display</div>

        <label class="field-label text-field">Title
          <input type="text" id="title" data-key="title" autocomplete="off">
        </label>

        <label class="field-label text-field">Subtitle (bottom-right)
          <input type="text" id="subtitle" data-key="subtitle" autocomplete="off">
        </label>

        <ha-formfield label="Hide metrics while the system is offline">
          <ha-checkbox id="hide-when-offline"></ha-checkbox>
        </ha-formfield>
        <label class="entity-field">
          <span class="field-label">Layout</span>
          <span class="select-shell">
            <ha-icon class="select-leading" icon="mdi:view-dashboard-outline"></ha-icon>
            <select id="layout" aria-label="Layout">
              <option value="compact">Compact tiles</option>
              <option value="detailed">Detailed list (Beszel style)</option>
            </select>
            <ha-icon class="select-chevron" icon="mdi:menu-down"></ha-icon>
          </span>
        </label>
        <ha-formfield label="Detailed list: keep empty rows (GPU, battery…)">
          <ha-checkbox id="show-empty-rows"></ha-checkbox>
        </ha-formfield>
        <ha-formfield label="Detailed list: split network into ↓ / ↑">
          <ha-checkbox id="split-network"></ha-checkbox>
        </ha-formfield>
        <ha-formfield label="Terminal style (plain monospace layout)">
          <ha-checkbox id="terminal-style"></ha-checkbox>
        </ha-formfield>

        <div class="section-title">Device</div>

        <label class="entity-field">
          <span class="field-label">Beszel device</span>
          <span class="select-shell">
            <ha-icon class="select-leading" icon="mdi:server"></ha-icon>
            <select id="device" aria-label="Beszel device">${deviceItems}</select>
            <ha-icon class="select-chevron" icon="mdi:menu-down"></ha-icon>
          </span>
        </label>
        <div class="hint">
          Pick your machine, then choose its sensors below. Each list is
          limited to the selected device's entities.
        </div>

        <ha-button id="autofill" class="autofill">
          ⚡ Auto-fill sensors from device
        </ha-button>

        <div class="section-title">Sensors</div>
        <div id="entity-pickers"></div>
        <div class="section-title">Additional Beszel metrics</div>
        <div class="hint">Choose advanced readings by group. The detailed list shows every selected reading; compact tiles show only the ones pinned to compact (or all, when none are pinned). Disabled entities must be enabled on the Home Assistant device page first.</div>
        <span id="advanced-summary" class="hint">None selected</span>
        <span class="select-shell">
          <ha-icon class="select-leading" icon="mdi:tune-variant"></ha-icon>
          <select id="advanced-preset" aria-label="Advanced metric preset">
            <option value="">Choose a preset…</option><option value="storage">Storage health</option><option value="troubleshooting">Troubleshooting</option><option value="all">All reported advanced metrics</option>
          </select>
          <ha-icon class="select-chevron" icon="mdi:menu-down"></ha-icon>
        </span>
        <div id="advanced-sensors"></div>
      </div>
    `;

    for (const key of ['title', 'subtitle']) {
      const input = this.shadowRoot.getElementById(key);
      input.value = c[key] || '';
      input.addEventListener('input', ev => this._textChanged(ev));
    }

    const hideWhenOffline = this.shadowRoot.getElementById('hide-when-offline');
    hideWhenOffline.checked = c.hide_when_offline === true;
    hideWhenOffline.addEventListener('change', () => {
      this._emit({ hide_when_offline: hideWhenOffline.checked });
    });
    const layout = this.shadowRoot.getElementById('layout');
    layout.value = editorLayout(c);
    layout.addEventListener('change', () => {
      // Replace the legacy `view` key with `layout`.
      const { view, ...rest } = this._config;
      this._config = rest;
      this._emit({ layout: layout.value });
    });
    const showEmpty = this.shadowRoot.getElementById('show-empty-rows');
    showEmpty.checked = c.show_empty_rows === true;
    showEmpty.addEventListener('change', () => this._emit({ show_empty_rows: showEmpty.checked }));
    const splitNetwork = this.shadowRoot.getElementById('split-network');
    splitNetwork.checked = c.split_network === true;
    splitNetwork.addEventListener('change', () => {
      this._emit({ split_network: splitNetwork.checked });
    });
    const terminalStyle = this.shadowRoot.getElementById('terminal-style');
    terminalStyle.checked = c.style === 'terminal';
    terminalStyle.addEventListener('change', () => {
      this._emit({ style: terminalStyle.checked ? 'terminal' : 'default' });
    });

    const select = this.shadowRoot.getElementById('device');
    select.value = c.device_id || '';
    select.addEventListener('change', ev => this._deviceChanged(ev));

    const autofill = this.shadowRoot.getElementById('autofill');
    autofill.disabled = !c.device_id;
    autofill.addEventListener('click', () => this._autoFill());

    this._renderEntitySelects();
    const preset = this.shadowRoot.getElementById('advanced-preset');
    preset.addEventListener('change', () => { if (preset.value) this._applyAdvancedPreset(preset.value); preset.value = ''; });
    this._renderAdvancedSensors();
  }
}

// ─── Register ────────────────────────────────────────────────────────────────
if (!customElements.get('beszel-machine-card')) {
  customElements.define('beszel-machine-card', BeszelMachineCard);
}
if (!customElements.get('beszel-machine-card-editor')) {
  customElements.define('beszel-machine-card-editor', BeszelMachineCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === 'beszel-machine-card')) {
  window.customCards.push({
    type: 'beszel-machine-card',
    name: 'Beszel Agent Machine Card',
    description: 'Single-machine card from the Beszel Agent Integration.',
    preview: false,
  });
}

console.info(
  '%c BESZEL-AGENT-MACHINE-CARD %c loaded ',
  'background:#1D9E75;color:#fff;padding:2px 6px;border-radius:4px 0 0 4px;font-weight:600',
  'background:#333;color:#fff;padding:2px 6px;border-radius:0 4px 4px 0'
);
