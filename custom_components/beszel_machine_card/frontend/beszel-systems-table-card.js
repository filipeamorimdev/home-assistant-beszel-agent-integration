/**
 * beszel-systems-table-card.js — bundled with the Home Assistant Beszel Agent Integration.
 *
 * Multi-system overview modelled on Beszel's "All Systems" page: a sortable
 * table (layout: table), Beszel's card grid (layout: grid), or automatic
 * switching by card width (layout: auto, default). Devices and entities come
 * from Home Assistant's frontend registries — no slugs, YAML packages, or
 * WebSocket polling.
 */

import {
  DETAIL_CSS,
  THEME_CSS,
  batteryLevel,
  buildSystemModel,
  clampPercent,
  discoverSystems,
  escapeHtml,
  formatLoads,
  formatNumber,
  formatPercent,
  formatRate,
  formatUptimeLong,
  formatUptimeShort,
  hubConnectionDown,
  hubEntityIds,
  loadLevel,
  meterLevel,
  networkTotal,
  openSystem,
  pick,
  rateBytes,
  readingNumber,
  renderDetailRows,
  thresholds,
} from './beszel-common.js?v=0.1.0';

// Beszel's column order.
const TABLE_COLUMNS = [
  { key: 'cpu', label: 'CPU', icon: 'mdi:cpu-64-bit' },
  { key: 'memory', label: 'Memory', icon: 'mdi:memory' },
  { key: 'disk', label: 'Disk', icon: 'mdi:harddisk' },
  { key: 'gpu', label: 'GPU', icon: 'mdi:expansion-card-variant' },
  { key: 'load', label: 'Load Avg', icon: 'mdi:timer-sand' },
  { key: 'network', label: 'Net', icon: 'mdi:ethernet' },
  { key: 'temperature', label: 'Temp', icon: 'mdi:thermometer' },
  { key: 'battery', label: 'Bat', icon: 'mdi:battery' },
  { key: 'services', label: 'Services', icon: 'mdi:console-line' },
  { key: 'uptime', label: 'Uptime', icon: 'mdi:clock-outline' },
  { key: 'agent', label: 'Agent', icon: 'mdi:wifi' },
];
const ADVANCED_TABLE_COLUMNS = [
  { key: 'memory_total', label: 'RAM total' },
  { key: 'memory_used', label: 'RAM used' },
  { key: 'memory_cache', label: 'RAM cache' },
  { key: 'swap_usage', label: 'Swap' },
  { key: 'disk_free', label: 'Disk free' },
  { key: 'disk_read_speed', label: 'Disk read' },
  { key: 'disk_write_speed', label: 'Disk write' },
  { key: 'cpu_user', label: 'CPU user' },
  { key: 'cpu_system', label: 'CPU system' },
  { key: 'cpu_iowait', label: 'CPU I/O wait' },
  { key: 'fan', label: 'Fan RPM' },
];
const ALL_COLUMNS = [...TABLE_COLUMNS, ...ADVANCED_TABLE_COLUMNS];
const DEFAULT_TABLE_COLUMNS = TABLE_COLUMNS.map(column => column.key);
const PERCENT_EXTRAS = new Set(['swap_usage', 'cpu_user', 'cpu_system', 'cpu_iowait']);
const RATE_EXTRAS = new Set(['disk_read_speed', 'disk_write_speed']);
const TERMINAL_NAMES = {
  cpu: 'cpu', memory: 'mem', disk: 'disk', load: 'load', network: 'net',
  temperature: 'temp', gpu: 'gpu', battery: 'bat', services: 'svc',
  uptime: 'up', agent: 'agent', memory_total: 'ramt', memory_used: 'ramu',
  memory_cache: 'cache', swap_usage: 'swap', disk_free: 'free',
  disk_read_speed: 'drd', disk_write_speed: 'dwr', cpu_user: 'usr',
  cpu_system: 'sys', cpu_iowait: 'iow', fan: 'fan',
};

const DEFAULT_CONFIG = {
  title: 'Beszel systems',
  columns: DEFAULT_TABLE_COLUMNS,
  system_ids: [],
  layout: 'auto',
  show_hub_status: true,
  hide_when_offline: true,
  hide_empty_columns: true,
  split_network: false,
  style: 'default',
};

function percentCell(value, level) {
  const text = formatPercent(value);
  if (!text) return '';
  return `<span class="pct"><span class="pct-val">${escapeHtml(text)}</span><span class="bz-meter"><span class="bz-fill bz-${level}" style="width:${clampPercent(value)}%"></span></span></span>`;
}

function readStorage(key) {
  try { return JSON.parse(window.localStorage.getItem(key) || 'null'); } catch (error) { return null; }
}
function writeStorage(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* storage blocked */ }
}

function statusLevelOf(model) {
  return { up: 'ok', pending: 'warn', down: 'crit', unknown: 'none' }[model.statusClass] || 'none';
}

const TABLE_CSS = `
  :host { display: block; }
  * { box-sizing: border-box; }
  ha-card { overflow: hidden; }
  .content { padding: 14px 16px; font-family: var(--ha-font-family-body, var(--paper-font-common-base_-_font-family, sans-serif)); }
  .title { font-size: 16px; font-weight: 600; margin-bottom: 12px; color: var(--primary-text-color); }
  .warning { padding: 7px 9px; margin-bottom: 9px; border-radius: 6px; color: var(--bz-warn); background: rgba(186, 117, 23, .12); font-size: 12px; }
  .empty { padding: 12px 0; font-size: 12px; color: var(--secondary-text-color); }
  .scroll { overflow-x: auto; border: 1px solid var(--bz-track); border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th {
    padding: 10px 10px; text-align: left; white-space: nowrap; font-weight: 500;
    color: var(--secondary-text-color); background: var(--secondary-background-color, rgba(127, 127, 127, .06));
  }
  th.sortable { cursor: pointer; user-select: none; }
  th.sortable:hover, th.sorted { color: var(--primary-text-color); }
  th ha-icon { --mdc-icon-size: 15px; margin-right: 5px; vertical-align: -2px; }
  th .arrow { margin-left: 4px; font-size: 11px; opacity: .8; }
  td { padding: 12px 10px; border-top: 1px solid var(--bz-track); white-space: nowrap; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
  tr.system-row { cursor: pointer; }
  tr.system-row:hover td { background: var(--secondary-background-color, rgba(127, 127, 127, .06)); }
  td.system { font-weight: 500; white-space: normal; overflow-wrap: anywhere; min-width: 8em; }
  .status-label { margin-left: 7px; color: var(--secondary-text-color); font-size: 10px; text-transform: uppercase; }
  .pct { display: inline-flex; align-items: center; gap: 8px; }
  .pct-val { min-width: 3.6em; }
  .pct .bz-meter { width: 72px; min-width: 72px; }
  .agent-icon { --mdc-icon-size: 14px; color: var(--bz-ok); margin-right: 4px; vertical-align: -2px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .grid-card { border: 1px solid var(--bz-track); border-radius: 10px; min-width: 0; overflow: hidden; }
  .bz-head { display: flex; align-items: center; gap: 4px; padding: 8px 8px 8px 14px; border-bottom: 1px solid var(--bz-track); }
  .bz-name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 14px; font-weight: 600; color: var(--primary-text-color); }
  .bz-menu { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 0; border-radius: 6px; background: none; color: var(--secondary-text-color); cursor: pointer; }
  .bz-menu:hover { background: var(--secondary-background-color, rgba(127, 127, 127, .12)); }
  .bz-menu ha-icon { --mdc-icon-size: 18px; }
  .bz-body { padding: 12px 14px; }
`;

class BeszelSystemsTableCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._systems = [];
    this._width = 0;
    this._sort = null;
  }

  setConfig(config) {
    this._config = { ...DEFAULT_CONFIG, ...(config || {}) };
    this._sort = readStorage(this._sortStorageKey()) || null;
    this._stateSignature = undefined;
    this._render();
  }

  set hass(value) {
    this._hass = value;
    const registryChanged = this._refreshSystems();
    const ids = [...hubEntityIds(value), ...this._systems.flatMap(system => Object.values(system.entities).flat())];
    const signature = JSON.stringify(ids.map(id => pick(value, 'states', id)));
    if (!registryChanged && signature === this._stateSignature) return;
    this._stateSignature = signature;
    this._render();
  }

  connectedCallback() {
    if (typeof ResizeObserver === 'undefined' || this._observer) return;
    this._observer = new ResizeObserver(entries => {
      const width = Math.round(pick(entries[0], 'contentRect', 'width') || 0);
      const wasNarrow = this._isNarrow();
      this._width = width;
      if (wasNarrow !== this._isNarrow()) this._render();
    });
    this._observer.observe(this);
  }

  disconnectedCallback() {
    if (this._observer) this._observer.disconnect();
    this._observer = null;
  }

  getCardSize() {
    return Math.max(2, 1 + this._visibleSystems().length);
  }

  static getConfigElement() {
    return document.createElement('beszel-systems-table-card-editor');
  }

  static getStubConfig() {
    return { ...DEFAULT_CONFIG, columns: [...DEFAULT_TABLE_COLUMNS], system_ids: [] };
  }

  // Rediscover only when HA replaces the entity or device registry objects.
  _refreshSystems() {
    const hass = this._hass;
    if (!pick(hass, 'entities')) return false;
    if (this._registryEntities === hass.entities && this._registryDevices === hass.devices) return false;
    this._registryEntities = hass.entities;
    this._registryDevices = hass.devices;
    this._systems = discoverSystems(hass);
    this._registryLoaded = true;
    return true;
  }

  _isNarrow() {
    const breakpoint = Number(pick(this._config, 'auto_breakpoint')) > 0 ? Number(this._config.auto_breakpoint) : 640;
    return this._width > 0 && this._width < breakpoint;
  }

  _layout() {
    const layout = pick(this._config, 'layout');
    if (layout === 'grid' || layout === 'table') return layout;
    return this._isNarrow() ? 'grid' : 'table';
  }

  _sortStorageKey() {
    return `beszel-systems-table-sort:${pick(this._config, 'title') || ''}`;
  }

  _visibleSystems() {
    const selected = pick(this._config, 'system_ids') || [];
    let systems = (this._systems || []).filter(system => pick(this._hass, 'states', system.entities.status));
    if (selected.length) {
      const wanted = new Set(selected);
      systems = systems.filter(system => wanted.has(system.id));
    }
    if (pick(this._config, 'hide_when_offline') !== false) {
      systems = systems.filter(system => {
        const status = String(pick(this._hass, 'states', system.entities.status, 'state') || '').toLowerCase();
        return status === 'up' || status === 'on' || status === 'paused' || status === 'pending';
      });
    }
    return systems;
  }

  _model(system) {
    return buildSystemModel(this._hass, system.entities);
  }

  _entity(system, key) {
    const id = system.entities[key];
    return id ? pick(this._hass, 'states', id) : null;
  }

  _extraCell(system, model, key, limits) {
    if (key === 'fan') return Number.isFinite(model.fan) ? `${escapeHtml(formatNumber(Math.round(model.fan)))} rpm` : '';
    const state = this._entity(system, key);
    const n = readingNumber(pick(state, 'state'));
    if (!Number.isFinite(n) || n < 0) return '';
    if (PERCENT_EXTRAS.has(key)) return n <= 100 ? percentCell(n, meterLevel(n, limits)) : '';
    if (RATE_EXTRAS.has(key)) return escapeHtml(formatRate(rateBytes(state)));
    const unit = pick(state.attributes, 'unit_of_measurement') || '';
    return escapeHtml(`${/B$/.test(unit) ? n.toFixed(1) : formatNumber(n)}${unit ? ` ${unit}` : ''}`);
  }

  _cell(system, model, column, limits) {
    switch (column) {
      case 'cpu': return percentCell(model.cpu, meterLevel(model.cpu, limits));
      case 'memory': return percentCell(model.memory, meterLevel(model.memory, limits));
      case 'disk': return percentCell(model.disk, meterLevel(model.disk, limits));
      case 'gpu': return percentCell(model.gpu, meterLevel(model.gpu, limits));
      case 'battery': return percentCell(model.battery, batteryLevel(model.battery));
      case 'load': {
        const loads = formatLoads(model.loads);
        return loads ? `<span class="bz-dot bz-${loadLevel(model.loads, model.threads, limits)}"></span>${escapeHtml(loads)}` : '';
      }
      case 'network': {
        const rx = formatRate(model.rx);
        const tx = formatRate(model.tx);
        if (!rx && !tx) return '';
        const split = [rx && `↓ ${rx}`, tx && `↑ ${tx}`].filter(Boolean).join('  ');
        return this._config.split_network === true
          ? escapeHtml(split)
          : `<span title="${escapeHtml(split)}">${escapeHtml(formatRate(networkTotal(model)))}</span>`;
      }
      case 'temperature': return model.temperature ? escapeHtml(model.temperature.text) : '';
      case 'services':
        if (!Number.isFinite(model.servicesTotal)) return '';
        return `<span class="bz-dot bz-${model.servicesFailed > 0 ? 'crit' : 'ok'}"></span>${escapeHtml(formatNumber(model.servicesTotal))}`
          + (Number.isFinite(model.servicesFailed) ? ` <span class="bz-muted">(failed: ${escapeHtml(formatNumber(model.servicesFailed))})</span>` : '');
      case 'uptime': return escapeHtml(formatUptimeLong(model.uptime));
      case 'agent': return model.agent ? `<ha-icon class="agent-icon" icon="mdi:tag-outline"></ha-icon>${escapeHtml(model.agent)}` : '';
      default: return this._extraCell(system, model, column, limits);
    }
  }

  _sortValue(system, model, key) {
    switch (key) {
      case 'name': return system.name.toLowerCase();
      case 'cpu': return model.cpu;
      case 'memory': return model.memory;
      case 'disk': return model.disk;
      case 'gpu': return model.gpu;
      case 'battery': return model.battery;
      case 'load': return model.loads[0];
      case 'network': return networkTotal(model);
      case 'temperature': return model.temperature ? model.temperature.celsius : NaN;
      case 'services': return Number.isFinite(model.servicesFailed) ? model.servicesFailed * 1e6 + (model.servicesTotal || 0) : model.servicesTotal;
      case 'uptime': return model.uptime;
      case 'agent': return model.agent;
      case 'fan': return model.fan;
      default: return readingNumber(pick(this._entity(system, key), 'state'));
    }
  }

  _sortedRows(rows) {
    const sort = this._sort;
    if (!pick(sort, 'key')) return rows;
    const direction = sort.dir === 'desc' ? -1 : 1;
    const missing = value => value === '' || (typeof value === 'number' && !Number.isFinite(value));
    return [...rows].sort((left, right) => {
      const a = this._sortValue(left.system, left.model, sort.key);
      const b = this._sortValue(right.system, right.model, sort.key);
      if (missing(a) || missing(b)) return missing(a) === missing(b) ? 0 : missing(a) ? 1 : -1;
      if (typeof a === 'string' || typeof b === 'string') return String(a).localeCompare(String(b)) * direction;
      return (a - b) * direction;
    });
  }

  _toggleSort(key) {
    const current = this._sort;
    // Numbers start high-to-low; names start A–Z. A third click clears.
    const first = key === 'name' ? 'asc' : 'desc';
    const second = first === 'asc' ? 'desc' : 'asc';
    if (!current || current.key !== key) this._sort = { key, dir: first };
    else if (current.dir === first) this._sort = { key, dir: second };
    else this._sort = null;
    writeStorage(this._sortStorageKey(), this._sort);
    this._render();
  }

  _columns() {
    const wanted = new Set(this._config.columns || DEFAULT_TABLE_COLUMNS);
    return ALL_COLUMNS.filter(column => wanted.has(column.key));
  }

  _render() {
    if (!this.shadowRoot || !this._config || !this._hass) return;
    this._refreshSystems();
    if (this._config.style === 'terminal') {
      this._renderTerminal();
      return;
    }
    const c = this._config;
    const limits = thresholds(c);
    const systems = this._visibleSystems();
    const hubDown = c.show_hub_status !== false && hubConnectionDown(this._hass);
    const hideOffline = c.hide_when_offline !== false;
    const rows = this._sortedRows(systems.map(system => ({ system, model: this._model(system) })));

    let body;
    if (!rows.length) {
      body = !this._registryLoaded
        ? '<div class="empty">Discovering Beszel systems…</div>'
        : (this._systems || []).length
          ? '<div class="empty">All matched systems are offline.</div>'
          : '<div class="empty">No Beszel system devices were found.</div>';
    } else if (this._layout() === 'grid') {
      body = `<div class="grid">${rows.map(({ system, model }) => `
        <div class="grid-card">
          <div class="bz-head"><span class="bz-dot bz-${statusLevelOf(model)}"></span><span class="bz-name">${escapeHtml(system.name)}</span><button class="bz-menu" type="button" data-device="${escapeHtml(system.id)}" title="Open device" aria-label="Open ${escapeHtml(system.name)}"><ha-icon icon="mdi:dots-horizontal"></ha-icon></button></div>
          <div class="bz-body">${renderDetailRows(model, { limits, showEmpty: c.show_empty_rows === true, splitNetwork: c.split_network === true })}</div>
        </div>`).join('')}</div>`;
    } else {
      let columns = this._columns();
      const cells = rows.map(({ system, model }) =>
        Object.fromEntries(columns.map(column => [column.key, this._cell(system, model, column.key, limits)])));
      if (c.hide_empty_columns !== false) {
        columns = columns.filter(column => cells.some(row => row[column.key]));
      }
      const header = (key, label, icon) => {
        const sorted = pick(this._sort, 'key') === key;
        const arrow = sorted ? (this._sort.dir === 'desc' ? '↓' : '↑') : '';
        return `<th class="sortable${sorted ? ' sorted' : ''}" data-sort="${key}">${icon ? `<ha-icon icon="${icon}"></ha-icon>` : ''}${escapeHtml(label)}${arrow ? `<span class="arrow">${arrow}</span>` : ''}</th>`;
      };
      const tableRows = rows.map(({ system, model }, index) => {
        const statusLabel = hideOffline || !model.status ? '' : `<span class="status-label">${escapeHtml(model.status)}</span>`;
        const tds = columns.map(column => `<td>${cells[index][column.key]}</td>`).join('');
        return `<tr class="system-row" data-device="${escapeHtml(system.id)}"><td class="system"><span class="bz-dot bz-${statusLevelOf(model)}"></span>${escapeHtml(system.name)}${statusLabel}</td>${tds}</tr>`;
      }).join('');
      body = `<div class="scroll"><table><thead><tr>${header('name', 'System', 'mdi:server')}${columns.map(column => header(column.key, column.label, column.icon)).join('')}</tr></thead><tbody>${tableRows}</tbody></table></div>`;
    }

    this.shadowRoot.innerHTML = `
      <style>${THEME_CSS}${DETAIL_CSS}${TABLE_CSS}</style>
      <ha-card>
        <div class="content">
          ${c.title ? `<div class="title">${escapeHtml(c.title)}</div>` : ''}
          ${hubDown ? '<div class="warning">Beszel Hub is unreachable. Displayed values may be stale.</div>' : ''}
          ${body}
        </div>
      </ha-card>`;
    this._bindEvents(systems);
  }

  _bindEvents(systems) {
    const root = this.shadowRoot;
    if (!root.querySelectorAll) return;
    const open = deviceId => {
      const system = systems.find(item => item.id === deviceId);
      if (system) openSystem(this, this._hass, { deviceId, entityId: system.entities.status }, this._config.row_action || 'device');
    };
    root.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => this._toggleSort(th.dataset.sort)));
    root.querySelectorAll('tr[data-device], .bz-menu[data-device]').forEach(node => node.addEventListener('click', () => open(node.dataset.device)));
  }

  _terminalValue(system, model, column) {
    // Plain text only — no HTML tags, spans, or breaks (old WebViews).
    const pct = value => (Number.isFinite(value) ? `${value.toFixed(1)}%` : '-');
    switch (column) {
      case 'cpu': return pct(model.cpu);
      case 'memory': return pct(model.memory);
      case 'disk': return pct(model.disk);
      case 'gpu': return pct(model.gpu);
      case 'battery': return pct(model.battery);
      case 'temperature': {
        const temp = model.temperature;
        return temp ? `${temp.value.toFixed(1)}${temp.unit.replace('°', '')}` : '-';
      }
      case 'uptime': return formatUptimeShort(model.uptime) || '-';
      case 'agent': return model.agent || '-';
      case 'load': return model.loads.map(value => (Number.isFinite(value) ? value.toFixed(2) : '-')).join('/');
      case 'network': {
        const rx = formatRate(model.rx);
        const tx = formatRate(model.tx);
        if (!rx && !tx) return '-';
        return `${rx ? `v${rx}` : ''}${rx && tx ? ' ' : ''}${tx ? `^${tx}` : ''}`;
      }
      case 'services':
        return Number.isFinite(model.servicesTotal) && Number.isFinite(model.servicesFailed)
          ? `${model.servicesFailed}/${model.servicesTotal}`
          : '-';
      default: {
        const html = this._extraCell(system, model, column, thresholds(this._config));
        return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() || '-';
      }
    }
  }

  _renderTerminal() {
    // Minimal layout for older WebViews: one <pre>, monospace text, no nested
    // tables/flex/grid/CSS variables.
    try {
      const columns = this._columns();
      const systems = this._visibleSystems();
      const hubDown = this._config.show_hub_status !== false && hubConnectionDown(this._hass);
      const lines = [];
      if (this._config.title) lines.push(`# ${String(this._config.title)}`);
      if (hubDown) lines.push('! hub unreachable');
      if (!this._registryLoaded) {
        lines.push('loading...');
      } else if (!systems.length) {
        lines.push((this._systems || []).length ? 'all offline' : 'no systems');
      } else {
        for (const system of systems) {
          const model = this._model(system);
          const mark = model.statusClass === 'up' ? '*' : model.statusClass === 'pending' ? '.' : '!';
          const parts = [`${mark} ${system.name}`];
          for (const column of columns) {
            parts.push(`${TERMINAL_NAMES[column.key] || column.key}=${this._terminalValue(system, model, column.key)}`);
          }
          lines.push(parts.join('  '));
        }
      }
      this.shadowRoot.innerHTML =
        '<style>'
        + '.term{display:block;background:#0b0f0c;color:#33ff66;border:1px solid #1f3d28;'
        + 'padding:8px;margin:0;font-family:monospace;font-size:12px;line-height:1.35;'
        + 'white-space:pre;overflow:auto;}'
        + '</style>'
        + `<pre class="term">${escapeHtml(lines.join('\n'))}</pre>`;
    } catch (error) {
      console.debug('beszel-systems-table-card: terminal render failed', error);
      this.shadowRoot.innerHTML =
        '<pre class="term" style="background:#0b0f0c;color:#ff6666;padding:8px;font-family:monospace;">'
        + 'terminal render failed'
        + '</pre>';
    }
  }
}

class BeszelSystemsTableCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._systems = [];
    this._advancedColumnsOpen = false;
  }

  setConfig(config) {
    const previous = this._config || {};
    this._config = { ...DEFAULT_CONFIG, ...(config || {}) };
    if (!this.shadowRoot.querySelector('.editor')) {
      this._render();
      return;
    }
    // Preserve the Advanced columns disclosure when only column selection changes.
    const keys = new Set([...Object.keys(previous), ...Object.keys(this._config)]);
    for (const key of keys) {
      if (key === 'columns') continue;
      if (JSON.stringify(previous[key]) !== JSON.stringify(this._config[key])) {
        this._render();
        return;
      }
    }
    this._syncColumnCheckboxes();
  }

  set hass(value) {
    this._hass = value;
    const registry = pick(value, 'entities');
    if (registry && registry !== this._registry) {
      this._registry = registry;
      this._systems = discoverSystems(value);
      this._render();
    } else if (!this.shadowRoot.querySelector('.editor')) {
      this._render();
    }
  }

  get hass() { return this._hass; }

  _emit(patch) {
    this._config = { ...this._config, ...patch };
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    }));
  }

  _toggleSystem(id, checked) {
    const all = this._systems.map(system => system.id);
    const selected = new Set(pick(this._config.system_ids, 'length') ? this._config.system_ids : all);
    if (checked) selected.add(id); else selected.delete(id);
    const next = all.filter(systemId => selected.has(systemId));
    this._emit({ system_ids: next.length === all.length ? [] : next });
  }

  _toggleColumn(key, checked) {
    const selected = new Set(this._config.columns || DEFAULT_TABLE_COLUMNS);
    if (checked) selected.add(key); else selected.delete(key);
    this._emit({ columns: ALL_COLUMNS.map(column => column.key).filter(item => selected.has(item)) });
    this._syncColumnCheckboxes();
  }

  _syncColumnCheckboxes() {
    const selectedColumns = new Set(this._config.columns || DEFAULT_TABLE_COLUMNS);
    for (const checkbox of this.shadowRoot.querySelectorAll('[data-column]')) {
      checkbox.checked = selectedColumns.has(checkbox.dataset.column);
    }
  }

  _render() {
    if (!this.shadowRoot || !this._config || !this._hass) return;
    const openDetails = this.shadowRoot.querySelector('details.advanced-columns');
    if (openDetails) this._advancedColumnsOpen = openDetails.open;
    // A rebuild (e.g. the entity registry refreshing) must not steal focus
    // from the Title field mid-typing, so remember it and restore it below.
    const active = this.shadowRoot.activeElement;
    const focusState = active && active.id === 'title'
      ? { id: active.id, start: active.selectionStart, end: active.selectionEnd }
      : null;
    const selectedSystems = new Set(
      pick(this._config.system_ids, 'length')
        ? this._config.system_ids
        : this._systems.map(system => system.id),
    );
    const selectedColumns = new Set(this._config.columns || DEFAULT_TABLE_COLUMNS);
    const checks = columns => columns.map(column => `<ha-formfield label="${escapeHtml(column.label)}"><ha-checkbox data-column="${column.key}"></ha-checkbox></ha-formfield>`).join('');
    this.shadowRoot.innerHTML = `
      <style>
        .editor { display:flex; flex-direction:column; gap:8px; padding:8px 4px; }
        .section { margin-top:8px; color:var(--secondary-text-color); font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.07em; }
        input[type=text] { box-sizing:border-box; width:100%; min-height:40px; padding:0 10px; border:1px solid var(--divider-color); border-radius:4px; background:transparent; color:var(--primary-text-color); font:inherit; }
        input[type=text]:focus { outline:none; border-color:var(--primary-color); }
        .checks { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:3px 8px; }
        .empty, .hint { color:var(--secondary-text-color); font-size:11px; }
        .field { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--primary-text-color); }
        select { min-height:40px; padding:0 10px; border:1px solid var(--divider-color); border-radius:4px; background:transparent; color:var(--primary-text-color); font:inherit; }
      </style>
      <div class="editor">
        <div class="section">Display</div>
        <label class="field">Title
          <input type="text" id="title" autocomplete="off">
        </label>
        <label class="field">Layout
          <select id="layout">
            <option value="auto">Automatic (table; grid on narrow cards)</option>
            <option value="table">Table</option>
            <option value="grid">Grid (Beszel cards)</option>
          </select>
        </label>
        <ha-formfield label="Show Hub connection warning"><ha-checkbox id="hub-status"></ha-checkbox></ha-formfield>
        <ha-formfield label="Hide offline systems"><ha-checkbox id="hide-offline"></ha-checkbox></ha-formfield>
        <ha-formfield label="Hide columns no system reports"><ha-checkbox id="hide-empty-columns"></ha-checkbox></ha-formfield>
        <ha-formfield label="Split network into ↓ / ↑"><ha-checkbox id="split-network"></ha-checkbox></ha-formfield>
        <ha-formfield label="Terminal style (plain monospace layout)"><ha-checkbox id="terminal-style"></ha-checkbox></ha-formfield>
        <div class="section">Systems</div>
        <div class="checks" id="systems">${this._systems.length ? this._systems.map(system => `<ha-formfield label="${escapeHtml(system.name)}"><ha-checkbox data-system-id="${escapeHtml(system.id)}"></ha-checkbox></ha-formfield>`).join('') : '<span class="empty">No Beszel systems found</span>'}</div>
        <div class="section">Columns</div>
        <div class="checks" id="columns">${checks(TABLE_COLUMNS)}</div>
        <details class="advanced-columns"${this._advancedColumnsOpen ? ' open' : ''}><summary>Advanced columns</summary><div class="checks">${checks(ADVANCED_TABLE_COLUMNS)}</div></details>
        <div class="hint">Click a column header on the card to sort. Meter colours follow warning_threshold / critical_threshold (Beszel defaults 65 / 90).</div>
      </div>`;

    const title = this.shadowRoot.getElementById('title');
    title.value = this._config.title || '';
    title.addEventListener('input', event => this._emit({ title: event.target.value }));
    if (focusState) {
      title.focus();
      try { title.setSelectionRange(focusState.start, focusState.end); } catch (_) { /* ignore */ }
    }
    const layout = this.shadowRoot.getElementById('layout');
    layout.value = ['table', 'grid'].includes(this._config.layout) ? this._config.layout : 'auto';
    layout.addEventListener('change', () => this._emit({ layout: layout.value }));
    // Options that default to on are stored as explicit false when unchecked.
    const bind = (id, key, defaultOn) => {
      const box = this.shadowRoot.getElementById(id);
      box.checked = defaultOn ? this._config[key] !== false : this._config[key] === true;
      box.addEventListener('change', () => this._emit({ [key]: box.checked }));
    };
    bind('hub-status', 'show_hub_status', true);
    bind('hide-offline', 'hide_when_offline', true);
    bind('hide-empty-columns', 'hide_empty_columns', true);
    bind('split-network', 'split_network', false);
    const terminalStyle = this.shadowRoot.getElementById('terminal-style');
    terminalStyle.checked = this._config.style === 'terminal';
    terminalStyle.addEventListener('change', () => {
      this._emit({ style: terminalStyle.checked ? 'terminal' : 'default' });
    });
    const advanced = this.shadowRoot.querySelector('details.advanced-columns');
    if (advanced) {
      advanced.addEventListener('toggle', () => { this._advancedColumnsOpen = advanced.open; });
    }
    for (const checkbox of this.shadowRoot.querySelectorAll('[data-system-id]')) {
      const id = checkbox.dataset.systemId;
      checkbox.checked = selectedSystems.has(id);
      checkbox.addEventListener('change', () => this._toggleSystem(id, checkbox.checked));
    }
    for (const checkbox of this.shadowRoot.querySelectorAll('[data-column]')) {
      const key = checkbox.dataset.column;
      checkbox.checked = selectedColumns.has(key);
      checkbox.addEventListener('change', () => this._toggleColumn(key, checkbox.checked));
    }
  }
}

if (!customElements.get('beszel-systems-table-card')) {
  customElements.define('beszel-systems-table-card', BeszelSystemsTableCard);
}
if (!customElements.get('beszel-systems-table-card-editor')) {
  customElements.define('beszel-systems-table-card-editor', BeszelSystemsTableCardEditor);
}
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === 'beszel-systems-table-card')) {
  window.customCards.push({
    type: 'beszel-systems-table-card',
    name: 'Beszel Agent Systems Table',
    description: 'Multi-system overview (table or Beszel-style grid) from the Home Assistant Beszel Agent Integration.',
    preview: false,
  });
}

console.info(
  '%c BESZEL-AGENT-SYSTEMS-TABLE %c loaded ',
  'background:#1D9E75;color:#fff;padding:2px 6px;border-radius:4px 0 0 4px;font-weight:600',
  'background:#333;color:#fff;padding:2px 6px;border-radius:0 4px 4px 0',
);
