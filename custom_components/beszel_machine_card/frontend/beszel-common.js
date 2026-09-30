/**
 * beszel-common.js — shared helpers for the Beszel Agent Integration cards.
 *
 * Imported as an ES module by beszel-machine-card.js and
 * beszel-systems-table-card.js so both cards format, colour and resolve
 * entities the same way. No DOM side effects; nothing is loaded from a CDN.
 */

export const INTEGRATION_DOMAIN = 'beszel_machine_card';

// ─── Compatibility ───────────────────────────────────────────────────────────
// Firefox 68 (the last Firefox for Android 4.x) has no optional chaining or
// nullish coalescing, and one syntax error would stop the whole module — even
// the terminal style. Use pick(obj, 'a', key) instead of obj?.a?.[key].
export function pick(value, ...keys) {
  for (const key of keys) {
    if (value == null) return undefined;
    value = value[key];
  }
  return value;
}

// ─── Readings ────────────────────────────────────────────────────────────────
const INVALID_READINGS = ['', 'unknown', 'unavailable', 'none', 'null', 'n/a', 'nan', 'infinity', '-infinity', '—'];

export function validReading(value) {
  if (value == null || typeof value === 'boolean') return false;
  return !INVALID_READINGS.includes(String(value).trim().toLowerCase());
}

export function readingNumber(value) {
  if (!validReading(value)) return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

// Values and labels come from Home Assistant and Beszel. Escape everything
// interpolated into innerHTML so renamed devices cannot inject markup.
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Thresholds (Beszel's default meter thresholds) ──────────────────────────
export const DEFAULT_THRESHOLDS = Object.freeze({ warning: 65, critical: 90 });

export function thresholds(config = {}) {
  const pick = (value, fallback) => {
    const n = Number(value);
    return value !== undefined && value !== null && value !== '' && Number.isFinite(n) && n > 0 && n <= 100 ? n : fallback;
  };
  const warning = pick(config.warning_threshold, DEFAULT_THRESHOLDS.warning);
  const critical = pick(config.critical_threshold, DEFAULT_THRESHOLDS.critical);
  return critical > warning ? { warning, critical } : { ...DEFAULT_THRESHOLDS };
}

export function meterLevel(percent, limits = DEFAULT_THRESHOLDS) {
  if (!Number.isFinite(percent)) return 'none';
  if (percent >= limits.critical) return 'crit';
  return percent >= limits.warning ? 'warn' : 'ok';
}

// Low battery is the bad direction.
export function batteryLevel(percent) {
  if (!Number.isFinite(percent)) return 'none';
  if (percent <= 15) return 'crit';
  return percent <= 30 ? 'warn' : 'ok';
}

export function temperatureLevel(celsius) {
  if (!Number.isFinite(celsius)) return 'none';
  if (celsius >= 80) return 'crit';
  return celsius >= 65 ? 'warn' : 'ok';
}

// Load relative to hardware threads, like Beszel's load-average dot.
export function loadLevel(loads, threads, limits = DEFAULT_THRESHOLDS) {
  const values = (loads || []).filter(Number.isFinite);
  if (!values.length || !(threads > 0)) return 'none';
  return meterLevel(Math.max(...values) / threads * 100, limits);
}

export function statusClass(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'up' || value === 'on') return 'up';
  if (value === 'paused' || value === 'pending') return 'pending';
  return value ? 'down' : 'unknown';
}

export function statusLevel(status) {
  return { up: 'ok', pending: 'warn', down: 'crit', unknown: 'none' }[statusClass(status)];
}

// ─── Formatting ──────────────────────────────────────────────────────────────
export function clampPercent(value) {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

// Beszel style: 16.1 / 0.49 / 1.78
export function formatPercentValue(value) {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(Math.abs(value) >= 10 ? 1 : 2);
}

export function formatPercent(value) {
  const text = formatPercentValue(value);
  return text ? `${text}%` : '';
}

export function formatNumber(value) {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(Math.abs(value) >= 10 ? 1 : 2);
}

export function formatSize(reading) {
  if (!reading || !Number.isFinite(reading.value)) return '';
  return `${reading.value.toFixed(1)}${reading.unit ? ` ${reading.unit}` : ''}`;
}

// "8.1 / 15.6 GiB" when both sides share a unit.
export function formatUsedTotal(used, total) {
  if (!used || !total) return used ? formatSize(used) : '';
  if (used.unit !== total.unit) return `${formatSize(used)} / ${formatSize(total)}`;
  return `${used.value.toFixed(1)} / ${total.value.toFixed(1)}${total.unit ? ` ${total.unit}` : ''}`;
}

const RATE_FACTORS = {
  'bit/s': 1 / 8, 'kbit/s': 125, 'mbit/s': 125e3, 'gbit/s': 125e6,
  'b/s': 1, 'byte/s': 1, 'bytes/s': 1,
  'kb/s': 1e3, 'mb/s': 1e6, 'gb/s': 1e9,
  'kib/s': 1024, 'mib/s': 1024 ** 2, 'gib/s': 1024 ** 3,
};

// Convert a data-rate entity to bytes/second, honouring HA display units.
export function rateBytes(stateObj) {
  const n = readingNumber(pick(stateObj, 'state'));
  if (!Number.isFinite(n) || n < 0) return NaN;
  const unit = String(pick(stateObj, 'attributes', 'unit_of_measurement') || 'B/s').toLowerCase();
  const factor = RATE_FACTORS[unit];
  return factor ? n * factor : NaN;
}

export function formatRate(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return '';
  const units = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s', 'TiB/s'];
  let value = bytesPerSecond;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = index === 0 || value >= 100 ? 0 : 2;
  return `${value.toFixed(digits)} ${units[index]}`;
}

const DURATION_FACTORS = { ms: 0.001, s: 1, min: 60, h: 3600, d: 86400 };

// Seconds since boot from a duration sensor (any HA display unit) or a
// timestamp sensor.
export function uptimeSeconds(stateObj) {
  const state = pick(stateObj, 'state');
  if (!validReading(state)) return NaN;
  const attributes = pick(stateObj, 'attributes') || {};
  const numeric = Number(state);
  if (attributes.device_class !== 'timestamp' && Number.isFinite(numeric)) {
    const factor = DURATION_FACTORS[attributes.unit_of_measurement] || 1;
    const seconds = numeric * factor;
    return seconds >= 0 ? seconds : NaN;
  }
  const parsed = Date.parse(state);
  if (Number.isNaN(parsed)) return NaN;
  const seconds = (Date.now() - parsed) / 1000;
  return seconds >= 0 ? seconds : NaN;
}

// "7d 6h", "5h 3m", "12m"
export function formatUptimeShort(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Beszel style: "7 days", "1 day", otherwise hours/minutes.
export function formatUptimeLong(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${days} ${days === 1 ? 'day' : 'days'}`;
  return formatUptimeShort(seconds);
}

// Temperature in the entity's own unit; thresholds use Celsius.
export function temperatureReading(stateObj) {
  const value = readingNumber(pick(stateObj, 'state'));
  if (!Number.isFinite(value)) return null;
  const unit = pick(stateObj, 'attributes', 'unit_of_measurement') || '°C';
  const celsius = /f/i.test(unit) ? (value - 32) * 5 / 9 : unit === 'K' ? value - 273.15 : value;
  if (celsius < -273.15 || celsius > 200) return null;
  return { value, unit, celsius, text: `${value.toFixed(1)} ${unit}` };
}

// ─── Entity resolution ───────────────────────────────────────────────────────
export const CORE_KEYS = [
  'status', 'cpu_usage', 'memory_usage', 'disk_usage', 'cpu_temperature',
  'network_received_speed', 'network_sent_speed', 'uptime', 'load_1m',
  'load_5m', 'load_15m', 'gpu_usage', 'battery', 'services_total',
  'services_failed', 'agent_version',
];

// Expanded metrics that have stable, name-derived entity IDs.
export const DETAIL_KEYS = [
  'memory_total', 'memory_used', 'memory_cache', 'memory_zfs_arc',
  'swap_total', 'swap_used', 'swap_usage', 'disk_total', 'disk_used',
  'disk_free', 'disk_read_speed', 'disk_write_speed', 'cpu_user',
  'cpu_system', 'cpu_iowait',
];

// Translated names slugify differently from the translation keys.
const ENTITY_ID_ALIASES = {
  load_1m: ['load_1m', 'load_1_minute'],
  load_5m: ['load_5m', 'load_5_minutes'],
  load_15m: ['load_15m', 'load_15_minutes'],
  memory_zfs_arc: ['memory_zfs_arc', 'zfs_arc_memory'],
};

function aliases(key) {
  return ENTITY_ID_ALIASES[key] || [key];
}

function splitEntityId(entityId) {
  const id = String(entityId || '');
  const match = id.match(/^(.*?)(_\d+)?$/);
  return { base: match[1], counter: match[2] || '' };
}

export function entityKeyFromId(entityId, keys = CORE_KEYS) {
  const { base } = splitEntityId(entityId);
  for (const key of keys) {
    for (const alias of aliases(key)) {
      if (base.endsWith(`_${alias}`)) return key;
    }
  }
  return null;
}

export function deviceName(hass, deviceId) {
  const device = deviceId ? pick(hass, 'devices', deviceId) : null;
  return device ? (device.name_by_user || device.name || '') : '';
}

// Map every metric of one Beszel device, using the frontend entity registry
// (hass.entities) — no WebSocket calls and no slug conventions for core keys.
export function systemEntitiesForDevice(hass, deviceId) {
  const result = {};
  const fans = [];
  if (!deviceId || !pick(hass, 'entities')) return result;
  for (const entry of Object.values(hass.entities)) {
    if (!entry || entry.device_id !== deviceId) continue;
    if (entry.platform && entry.platform !== INTEGRATION_DOMAIN) continue;
    const id = entry.entity_id;
    if (!id || !id.startsWith('sensor.')) continue;
    // Core sensors carry a translation key; expanded metrics are named, so
    // fall back to their name-derived entity ID.
    const key = CORE_KEYS.includes(entry.translation_key)
      ? entry.translation_key
      : entityKeyFromId(id, DETAIL_KEYS) || (entry.translation_key ? null : entityKeyFromId(id, CORE_KEYS));
    if (key) {
      if (!result[key]) result[key] = id;
    } else if (/_fan_/.test(id)) {
      fans.push(id);
    }
  }
  if (fans.length) result.fans = fans;
  return result;
}

// Fallback for YAML configs when the frontend registry is unavailable:
// derive siblings from any configured core entity ID.
export function systemEntitiesFromSeeds(hass, seeds) {
  const states = pick(hass, 'states') || {};
  const result = {};
  for (const seed of (seeds || []).filter(Boolean)) {
    const key = entityKeyFromId(seed, CORE_KEYS);
    if (!key) continue;
    const { base, counter } = splitEntityId(seed);
    const alias = aliases(key).find(item => base.endsWith(`_${item}`));
    const prefix = base.slice(0, base.length - alias.length - 1);
    for (const target of [...CORE_KEYS, ...DETAIL_KEYS]) {
      if (result[target]) continue;
      for (const name of aliases(target)) {
        const hit = [`${prefix}_${name}${counter}`, `${prefix}_${name}`].find(id => states[id]);
        if (hit) { result[target] = hit; break; }
      }
    }
  }
  return result;
}

// Every Beszel system device, sorted by name.
export function discoverSystems(hass) {
  const ids = new Set();
  for (const entry of Object.values(pick(hass, 'entities') || {})) {
    if (pick(entry, 'platform') === INTEGRATION_DOMAIN && entry.device_id && entry.translation_key === 'status') {
      ids.add(entry.device_id);
    }
  }
  return [...ids]
    .map(id => ({ id, name: deviceName(hass, id) || id, entities: systemEntitiesForDevice(hass, id) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function hubEntityIds(hass) {
  const ids = Object.values(pick(hass, 'entities') || {})
    .filter(entry => pick(entry, 'platform') === INTEGRATION_DOMAIN && entry.translation_key === 'hub_connection')
    .map(entry => entry.entity_id);
  if (ids.length) return ids;
  return Object.keys(pick(hass, 'states') || {}).filter(id => /^binary_sensor\.beszel_hub_connection(_\d+)?$/.test(id));
}

export function hubConnectionDown(hass, ids = hubEntityIds(hass)) {
  const states = ids.map(id => pick(hass, 'states', id, 'state')).filter(state => state === 'on' || state === 'off');
  return states.length > 0 && !states.includes('on');
}

// Friendly name without the device-name prefix ("truenas Memory total" → "Memory total").
export function entityLabel(hass, entityId) {
  const state = pick(hass, 'states', entityId);
  let label = pick(state, 'attributes', 'friendly_name') || '';
  const name = deviceName(hass, pick(hass, 'entities', entityId, 'device_id'));
  if (label && name && label.toLowerCase().startsWith(`${name.toLowerCase()} `)) {
    label = label.slice(name.length + 1);
    label = label.charAt(0).toUpperCase() + label.slice(1);
  }
  if (label) return label;
  const { base } = splitEntityId(entityId);
  return base.replace(/^[^.]*\./, '').replace(/_/g, ' ');
}

// ─── System model ────────────────────────────────────────────────────────────
export function buildSystemModel(hass, entities = {}) {
  const stateOf = key => (entities[key] ? pick(hass, 'states', entities[key]) : undefined);
  const num = key => readingNumber(pick(stateOf(key), 'state'));
  const nonNegative = key => { const n = num(key); return n >= 0 ? n : NaN; };
  const percent = key => { const n = num(key); return n >= 0 && n <= 100 ? n : NaN; };
  const size = key => {
    const state = stateOf(key);
    const n = readingNumber(pick(state, 'state'));
    return n >= 0 ? { value: n, unit: pick(state.attributes, 'unit_of_measurement') || '' } : null;
  };
  const statusState = stateOf('status');
  const status = validReading(pick(statusState, 'state')) ? String(statusState.state).toLowerCase() : '';
  const threads = Number(pick(statusState, 'attributes', 'threads'));
  const fans = (entities.fans || [])
    .map(id => readingNumber(pick(hass, 'states', id, 'state')))
    .filter(n => n >= 0);
  const agent = pick(stateOf('agent_version'), 'state');
  return {
    status,
    statusClass: statusClass(status),
    cpu: percent('cpu_usage'),
    memory: percent('memory_usage'),
    disk: percent('disk_usage'),
    gpu: percent('gpu_usage'),
    battery: percent('battery'),
    loads: ['load_1m', 'load_5m', 'load_15m'].map(nonNegative),
    threads: threads > 0 ? threads : NaN,
    rx: rateBytes(stateOf('network_received_speed')),
    tx: rateBytes(stateOf('network_sent_speed')),
    temperature: temperatureReading(stateOf('cpu_temperature')),
    uptime: uptimeSeconds(stateOf('uptime')),
    servicesTotal: nonNegative('services_total'),
    servicesFailed: nonNegative('services_failed'),
    agent: validReading(agent) ? String(agent) : '',
    memoryUsed: size('memory_used'),
    memoryTotal: size('memory_total'),
    memoryCache: size('memory_cache'),
    diskUsed: size('disk_used'),
    diskTotal: size('disk_total'),
    fan: fans.length ? Math.max(...fans) : NaN,
  };
}

export function networkTotal(model) {
  const parts = [model.rx, model.tx].filter(Number.isFinite);
  return parts.length ? parts.reduce((sum, value) => sum + value, 0) : NaN;
}

export function formatLoads(loads) {
  return (loads || []).some(Number.isFinite)
    ? loads.map(value => (Number.isFinite(value) ? value.toFixed(2) : '–')).join(' ')
    : '';
}

// ─── Beszel-style detail rows (machine card "detailed", table "grid") ────────
export const ROW_ICONS = {
  cpu: 'mdi:cpu-64-bit',
  memory: 'mdi:memory',
  disk: 'mdi:harddisk',
  gpu: 'mdi:expansion-card-variant',
  load: 'mdi:timer-sand',
  network: 'mdi:ethernet',
  temperature: 'mdi:thermometer',
  battery: 'mdi:battery',
  services: 'mdi:console-line',
  uptime: 'mdi:clock-outline',
  agent: 'mdi:wifi',
  extra: 'mdi:gauge',
};

function meterHtml(percent, level) {
  return `<span class="bz-meter"><span class="bz-fill bz-${level}" style="width:${clampPercent(percent)}%"></span></span>`;
}

export function renderDetailRows(model, options = {}) {
  const limits = options.limits || DEFAULT_THRESHOLDS;
  const rows = [];
  const row = (key, label, valueHtml, meter) => {
    if (!valueHtml && !options.showEmpty) return;
    const value = meter && valueHtml
      ? `<span class="bz-value">${valueHtml}</span>${meterHtml(meter.percent, meter.level)}`
      : `<span class="bz-value bz-wide">${valueHtml}</span>`;
    rows.push(`<div class="bz-row" data-row="${escapeHtml(key)}"><ha-icon class="bz-icon" icon="${ROW_ICONS[key] || ROW_ICONS.extra}"></ha-icon><span class="bz-label">${escapeHtml(label)}:</span>${value}</div>`);
  };
  const percentRow = (key, label, value, level) =>
    row(key, label, escapeHtml(formatPercent(value)), { percent: value, level });

  percentRow('cpu', 'CPU', model.cpu, meterLevel(model.cpu, limits));
  percentRow('memory', 'Memory', model.memory, meterLevel(model.memory, limits));
  percentRow('disk', 'Disk', model.disk, meterLevel(model.disk, limits));
  percentRow('gpu', 'GPU', model.gpu, meterLevel(model.gpu, limits));

  const loads = formatLoads(model.loads);
  row('load', 'Load Avg', loads
    ? `<span class="bz-dot bz-${loadLevel(model.loads, model.threads, limits)}"></span>${escapeHtml(loads)}`
    : '');

  const rx = formatRate(model.rx);
  const tx = formatRate(model.tx);
  const split = [rx && `↓ ${rx}`, tx && `↑ ${tx}`].filter(Boolean).join('  ');
  const network = options.splitNetwork
    ? escapeHtml(split)
    : (rx || tx ? `<span title="${escapeHtml(split)}">${escapeHtml(formatRate(networkTotal(model)))}</span>` : '');
  row('network', 'Net', network);

  row('temperature', 'Temp', model.temperature ? escapeHtml(model.temperature.text) : '');
  percentRow('battery', 'Bat', model.battery, batteryLevel(model.battery));

  row('services', 'Services', Number.isFinite(model.servicesTotal)
    ? `<span class="bz-dot bz-${model.servicesFailed > 0 ? 'crit' : 'ok'}"></span>${escapeHtml(formatNumber(model.servicesTotal))}${Number.isFinite(model.servicesFailed) ? ` <span class="bz-muted">(failed: ${escapeHtml(formatNumber(model.servicesFailed))})</span>` : ''}`
    : '');
  row('uptime', 'Uptime', escapeHtml(formatUptimeLong(model.uptime)));
  row('agent', 'Agent', model.agent
    ? `<ha-icon class="bz-agent-icon" icon="mdi:tag-outline"></ha-icon>${escapeHtml(model.agent)}`
    : '');

  for (const extra of options.extras || []) {
    if (!extra.value) continue;
    rows.push(`<div class="bz-row bz-extra"><ha-icon class="bz-icon" icon="${ROW_ICONS.extra}"></ha-icon><span class="bz-label">${escapeHtml(extra.label)}:</span><span class="bz-value bz-wide">${escapeHtml(extra.value)}${extra.unit ? ` <span class="bz-muted">${escapeHtml(extra.unit)}</span>` : ''}</span></div>`);
  }
  return `<div class="bz-rows">${rows.join('')}</div>`;
}

// Theme-aware colour tokens shared by both cards.
export const THEME_CSS = `
  :host {
    --bz-ok: var(--success-color, #22c55e);
    --bz-warn: var(--warning-color, #eab308);
    --bz-crit: var(--error-color, #ef4444);
    --bz-none: var(--disabled-color, #8a8a8a);
    --bz-track: var(--divider-color, rgba(127, 127, 127, .25));
  }
  .bz-ok { background: var(--bz-ok); }
  .bz-warn { background: var(--bz-warn); }
  .bz-crit { background: var(--bz-crit); }
  .bz-none { background: var(--bz-none); }
  .bz-dot { display: inline-block; flex-shrink: 0; width: 7px; height: 7px; border-radius: 50%; margin-right: 7px; vertical-align: middle; }
  .bz-muted { color: var(--secondary-text-color); font-weight: 400; }
`;

export const DETAIL_CSS = `
  .bz-rows { display: flex; flex-direction: column; gap: 9px; container-type: inline-size; }
  .bz-row {
    display: grid;
    grid-template-columns: 18px minmax(60px, 84px) auto minmax(40px, 1fr);
    align-items: center;
    gap: 10px;
    min-height: 20px;
    font-size: 13px;
  }
  .bz-icon { --mdc-icon-size: 16px; color: var(--secondary-text-color); }
  .bz-label { color: var(--secondary-text-color); white-space: nowrap; }
  .bz-value { color: var(--primary-text-color); font-weight: 500; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .bz-wide { grid-column: 3 / -1; white-space: normal; overflow-wrap: anywhere; }
  .bz-meter { display: block; height: 8px; min-width: 40px; border-radius: 4px; overflow: hidden; background: var(--bz-track); }
  .bz-fill { display: block; height: 100%; border-radius: inherit; transition: width .6s ease; }
  .bz-agent-icon { --mdc-icon-size: 14px; color: var(--bz-ok); margin-right: 4px; vertical-align: -2px; }
  @container (max-width: 200px) {
    .bz-row { grid-template-columns: 16px minmax(0, 1fr) auto; }
    .bz-meter { grid-column: 2 / -1; }
    .bz-wide { grid-column: 3 / -1; }
  }
`;

// ─── Navigation ──────────────────────────────────────────────────────────────
export function navigate(path) {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
}

export function openMoreInfo(node, entityId) {
  node.dispatchEvent(new CustomEvent('hass-more-info', {
    detail: { entityId },
    bubbles: true,
    composed: true,
  }));
}

// Open the HA device page for admins; everyone else gets the status more-info.
export function openSystem(node, hass, { deviceId, entityId }, action = 'device') {
  if (action === 'none') return;
  if (action === 'device' && deviceId && pick(hass, 'user', 'is_admin') !== false) {
    navigate(`/config/devices/device/${encodeURIComponent(deviceId)}`);
  } else if (entityId) {
    openMoreInfo(node, entityId);
  }
}
