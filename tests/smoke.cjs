// Smoke tests for the bundled Lovelace cards. The cards are ES modules that
// import beszel-common.js; each card is bundled with it into one script and
// run in an isolated VM context with minimal DOM stubs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'custom_components', 'beszel_machine_card');
const frontend = path.join(root, 'frontend');
const read = name => fs.readFileSync(path.join(frontend, name), 'utf8');
const commonSource = read('beszel-common.js');
const source = read('beszel-machine-card.js');
const tableSource = read('beszel-systems-table-card.js');

for (const [name, text] of [['common', commonSource], ['machine', source], ['table', tableSource]]) {
  assert.doesNotMatch(text, /https?:\/\//, `${name} must not load code from a CDN`);
}

// The shared-module import carries the card version for cache busting; it
// must move together with CARD_VERSION and the manifest version.
const cardVersion = fs.readFileSync(path.join(root, 'const.py'), 'utf8').match(/CARD_VERSION = "([^"]+)"/)[1];
const manifestVersion = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
assert.equal(manifestVersion, cardVersion);
for (const text of [source, tableSource]) {
  assert.match(text, new RegExp(`from '\\./beszel-common\\.js\\?v=${cardVersion.replace(/\./g, '\\.')}'`));
}

function bundle(cardSource, exportsLine) {
  const common = commonSource.replace(/^export /gm, '');
  const card = cardSource.replace(/^import \{[\s\S]*?\} from '[^']+';\n/m, '');
  return `${common}\n${card}\n${exportsLine}`;
}

class HTMLElementStub {
  attachShadow() {
    this.shadowRoot = {
      innerHTML: '',
      getElementById: () => ({ addEventListener: () => {}, appendChild: () => {} }),
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    return this.shadowRoot;
  }
  dispatchEvent() {}
}

function makeContext() {
  const context = {
    console: { ...console, info: () => {}, debug: () => {} },
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    Date,
    document: { createElement: () => ({ dataset: {}, addEventListener: () => {} }) },
    HTMLElement: HTMLElementStub,
    window: { history: { pushState() {} }, dispatchEvent() {}, localStorage: { getItem: () => null, setItem() {} } },
    customElements: { define: () => {}, get: () => undefined },
  };
  context.globalThis = context;
  vm.createContext(context);
  // Firefox 68 (last Firefox for Android 4.x) lacks these built-ins; render
  // without them. padEnd is removed too for even older WebViews.
  vm.runInContext([
    'String.prototype.replaceAll = undefined; String.prototype.padEnd = undefined;',
    'Array.prototype.at = undefined; String.prototype.at = undefined;',
    'Array.prototype.findLast = undefined; Array.prototype.findLastIndex = undefined;',
    'Array.prototype.toSorted = undefined; Object.hasOwn = undefined;',
    'Promise.allSettled = undefined; Promise.any = undefined;',
    'globalThis.structuredClone = undefined; globalThis.queueMicrotask = undefined;',
  ].join('\n'), context);
  return context;
}

const machine = makeContext();
vm.runInContext(bundle(source, 'globalThis.CardUnderTest = BeszelMachineCard; globalThis.EditorUnderTest = BeszelMachineCardEditor; globalThis.common = { formatRate, formatPercent, formatUptimeLong, temperatureReading, systemEntitiesFromSeeds, systemEntitiesForDevice, advancedSensorGroup, entityLabel, batteryLevel, rateBytes };'), machine, { filename: 'machine-card.bundle.js' });
const table = makeContext();
vm.runInContext(bundle(tableSource, 'globalThis.TableCardUnderTest = BeszelSystemsTableCard; globalThis.TableEditorUnderTest = BeszelSystemsTableCardEditor;'), table, { filename: 'table-card.bundle.js' });

// ─── Shared formatting ───────────────────────────────────────────────────────
const c = machine.common;
assert.equal(c.formatRate(1358 * 1024), '1.33 MiB/s');
assert.equal(c.formatRate(0), '0 B/s');
assert.equal(c.formatRate(NaN), '');
assert.equal(c.formatPercent(16.12), '16.1%');
assert.equal(c.formatPercent(0.49), '0.49%');
assert.equal(c.formatPercent(0), '0.00%');
assert.equal(c.formatUptimeLong(7 * 86400 + 3600), '7 days');
assert.equal(c.formatUptimeLong(86400), '1 day');
assert.equal(c.formatUptimeLong(3700), '1h 1m');
assert.equal(c.rateBytes({ state: '8', attributes: { unit_of_measurement: 'kbit/s' } }), 1000);
const fahrenheit = c.temperatureReading({ state: '150.8', attributes: { unit_of_measurement: '°F' } });
assert.equal(fahrenheit.text, '150.8 °F');
assert.ok(Math.abs(fahrenheit.celsius - 66) < 0.01, 'thresholds use Celsius even when HA shows °F');
assert.equal(c.temperatureReading({ state: '999', attributes: {} }), null);
assert.equal(c.batteryLevel(95), 'ok', 'a full battery is healthy');
assert.equal(c.batteryLevel(10), 'crit');
for (const invalid of [null, undefined, '', ' ', 'unknown', 'unavailable', 'NaN', 'Infinity', true]) {
  assert.ok(Number.isNaN(c.rateBytes({ state: invalid, attributes: {} })));
  assert.equal(c.temperatureReading({ state: invalid, attributes: {} }), null);
}

// Translated names slugify differently from keys ("Load (1 minute)").
const seeded = c.systemEntitiesFromSeeds({ states: {
  'sensor.nas_cpu_usage': {}, 'sensor.nas_load_1_minute': {}, 'sensor.nas_load_15_minutes': {},
  'sensor.nas_memory_total': {}, 'sensor.nas_zfs_arc_memory': {},
} }, ['sensor.nas_cpu_usage']);
assert.equal(seeded.load_1m, 'sensor.nas_load_1_minute');
assert.equal(seeded.load_15m, 'sensor.nas_load_15_minutes');
assert.equal(seeded.memory_total, 'sensor.nas_memory_total');
assert.equal(seeded.memory_zfs_arc, 'sensor.nas_zfs_arc_memory');

// Editor groups use registry unique IDs, not name-derived entity IDs.
const registry = new Map([
  ['sensor.nas_temperature_coretemp', { unique_id: 'abc123_t_636f726574656d70' }],
  ['sensor.nas_hostname', { unique_id: 'abc123_system_hostname' }],
  ['sensor.nas_eth0_sent_speed', { unique_id: 'abc123_network_65746830_sent_speed' }],
  ['sensor.nas_cpu_usage', { unique_id: 'abc123_cpu_usage' }],
]);
assert.equal(c.advancedSensorGroup('sensor.nas_temperature_coretemp', registry)?.key, 'cooling');
assert.equal(c.advancedSensorGroup('sensor.nas_hostname', registry)?.key, 'about');
assert.equal(c.advancedSensorGroup('sensor.nas_eth0_sent_speed', registry)?.key, 'network');
assert.equal(c.advancedSensorGroup('sensor.nas_cpu_usage', registry), null);
console.log('Shared helper tests passed.');

// ─── Machine card ────────────────────────────────────────────────────────────
function machineHass() {
  const states = {};
  const entities = {};
  const add = (key, state, attributes = {}, translationKey = key) => {
    const id = `sensor.truenas_${key}`;
    states[id] = { entity_id: id, state: String(state), attributes };
    entities[id] = { entity_id: id, device_id: 'dev1', platform: 'beszel_machine_card', translation_key: translationKey };
  };
  add('status', 'up', { threads: 4 });
  add('cpu_usage', '16.12', { unit_of_measurement: '%' });
  add('memory_usage', '51.5', { unit_of_measurement: '%' });
  add('disk_usage', '1.78', { unit_of_measurement: '%' });
  add('cpu_temperature', '61.5', { unit_of_measurement: '°C' });
  add('network_received_speed', String(741 * 1024), { unit_of_measurement: 'B/s' });
  add('network_sent_speed', String(617 * 1024), { unit_of_measurement: 'B/s' });
  add('uptime', String(7 * 86400 + 6 * 3600), { unit_of_measurement: 's', device_class: 'duration' });
  // Real entity IDs from the translated names "Load (1 minute)" etc.
  states['sensor.truenas_load_1_minute'] = { state: '1.01', attributes: {} };
  states['sensor.truenas_load_5_minutes'] = { state: '0.92', attributes: {} };
  states['sensor.truenas_load_15_minutes'] = { state: '1.15', attributes: {} };
  for (const [id, key] of [['sensor.truenas_load_1_minute', 'load_1m'], ['sensor.truenas_load_5_minutes', 'load_5m'], ['sensor.truenas_load_15_minutes', 'load_15m']]) {
    entities[id] = { entity_id: id, device_id: 'dev1', platform: 'beszel_machine_card', translation_key: key };
  }
  add('agent_version', '0.20.0');
  add('memory_used', '8.08', { unit_of_measurement: 'GiB', friendly_name: 'truenas Memory used' }, null);
  add('memory_total', '15.56', { unit_of_measurement: 'GiB', friendly_name: 'truenas Memory total' }, null);
  add('memory_cache', '1', { unit_of_measurement: 'GiB', friendly_name: 'truenas Memory cache' }, null);
  add('swap_usage', '0', { unit_of_measurement: '%', friendly_name: 'truenas Swap <usage>' }, null);
  return {
    states,
    entities,
    devices: { dev1: { id: 'dev1', name: 'truenas' } },
    user: { is_admin: true },
  };
}

const card = new machine.CardUnderTest();
card.setConfig({ device_id: 'dev1' });
card.hass = machineHass();
let html = card.shadowRoot.innerHTML;
// Compact tiles (the default) keep the truenas look with merged memory sizes.
assert.match(html, /class="metrics"/);
assert.match(html, />truenas</);
assert.match(html, /↑ 7d 6h/);
assert.match(html, /class="metric-val">16\.1<\/span>/);
assert.match(html, /8\.1 \/ 15\.6 GiB · cache 1\.0 GiB/);
assert.doesNotMatch(html, /Memory total|truenas Memory/, 'merged sizes are not repeated as tiles');
assert.match(html, /↓ 741 KiB\/s/);
assert.match(html, /61\.5 °C/);
assert.equal((html.match(/class="bar-wrap"/g) || []).length, 3);
// Extras: device-name prefix stripped, untrusted names escaped, zeros kept.
card.setConfig({ device_id: 'dev1', extra_entities: ['sensor.truenas_swap_usage'] });
html = card.shadowRoot.innerHTML;
assert.match(html, /Swap &lt;usage&gt;/);
assert.doesNotMatch(html, /truenas Swap/);
assert.match(html, /class="metric-val">0<\/span>/);

// Detailed layout follows Beszel's list.
card.setConfig({ device_id: 'dev1', layout: 'detailed', title: '<img src=x onerror=alert(1)>' });
html = card.shadowRoot.innerHTML;
assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
assert.doesNotMatch(html, /<img src=x/);
assert.match(html, /class="bz-rows"/);
assert.match(html, /CPU:<\/span><span class="bz-value">16\.1%/);
assert.match(html, /Load Avg:<\/span><span class="bz-value bz-wide"><span class="bz-dot bz-ok"><\/span>1\.01 0\.92 1\.15/);
assert.match(html, /Net:<\/span><span class="bz-value bz-wide"><span title="↓ 741 KiB\/s  ↑ 617 KiB\/s">1\.33 MiB\/s/);
assert.match(html, /Uptime:<\/span><span class="bz-value bz-wide">7 days/);
assert.doesNotMatch(html, /GPU:|Bat:|Services:/, 'empty rows are hidden by default');
assert.match(html, /class="bz-menu"/);
card.setConfig({ device_id: 'dev1', layout: 'detailed', show_empty_rows: true, split_network: true });
html = card.shadowRoot.innerHTML;
assert.match(html, /GPU:<\/span><span class="bz-value bz-wide"><\/span>/);
assert.match(html, /↓ 741 KiB\/s  ↑ 617 KiB\/s/);
assert.doesNotMatch(html, /NaN|—%|>unknown<|>unavailable</);

// Legacy configs: view: compact was the icon list → detailed; view: full → tiles.
card.setConfig({ device_id: 'dev1', view: 'compact' });
assert.match(card.shadowRoot.innerHTML, /class="bz-rows"/);
card.setConfig({ device_id: 'dev1', view: 'full' });
assert.match(card.shadowRoot.innerHTML, /class="metrics"/);

// YAML config with explicit entity IDs and no registry still finds siblings.
const legacyHass = machineHass();
delete legacyHass.entities;
card.setConfig({ entity_cpu: 'sensor.truenas_cpu_usage', layout: 'detailed' });
card.hass = legacyHass;
assert.match(card.shadowRoot.innerHTML, /1\.01 0\.92 1\.15/);

// Offline machines hide stale readings.
const offline = machineHass();
offline.states['sensor.truenas_status'].state = 'down';
card.setConfig({ device_id: 'dev1', hide_when_offline: true });
card.hass = offline;
assert.match(card.shadowRoot.innerHTML, /System offline/);
assert.doesNotMatch(card.shadowRoot.innerHTML, /16\.1/);

// Missing readings stay blank; real zeros stay zero.
const blank = machineHass();
for (const state of Object.values(blank.states)) if (state !== blank.states['sensor.truenas_status']) state.state = 'unknown';
blank.states['sensor.truenas_cpu_usage'].state = '0';
card.setConfig({ device_id: 'dev1' });
card.hass = blank;
html = card.shadowRoot.innerHTML;
assert.match(html, /class="metric-val">0\.00<\/span>/);
assert.match(html, /class="metric-val"><\/span><span class="metric-unit"><\/span>/);
assert.doesNotMatch(html, /NaN|—%|>unknown<|↑ <\/div>/);

// °F sensors keep their unit.
const imperial = machineHass();
imperial.states['sensor.truenas_cpu_temperature'] = { state: '142.7', attributes: { unit_of_measurement: '°F' } };
card.hass = imperial;
assert.match(card.shadowRoot.innerHTML, /142\.7 °F/);
assert.doesNotMatch(card.shadowRoot.innerHTML, /°C/);

// Unrelated state changes do not redraw.
const redrawHass = machineHass();
card.hass = redrawHass;
let redraws = 0;
const renderBefore = card._render.bind(card);
card._render = () => { redraws += 1; renderBefore(); };
card.hass = { ...redrawHass, states: { ...redrawHass.states, 'sensor.unrelated': { state: '1' } } };
assert.equal(redraws, 0, 'unrelated updates should not redraw the card');
card.hass = { ...redrawHass, states: { ...redrawHass.states, 'sensor.truenas_cpu_usage': { state: '12', attributes: {} } } };
assert.equal(redraws, 1, 'relevant updates must redraw the card');
card._render = renderBefore;

// Terminal style stays a plain monospace table.
card.setConfig({ device_id: 'dev1', style: 'terminal', hide_when_offline: true });
card.hass = machineHass();
html = card.shadowRoot.innerHTML;
assert.match(html, /class="term"/);
assert.match(html, /Courier New/);
assert.match(html, /\[#+\.+\]/);
assert.match(html, /61\.5C<\/td><\/tr><\/table>/);
assert.doesNotMatch(html, /display:\s*flex|grid-template|var\(--|color-mix|clamp\(|@container|cqi|:is\(|:where\(/);
card.hass = offline;
assert.match(card.shadowRoot.innerHTML, /system offline/);
console.log('Beszel Agent Machine Card smoke tests passed.');

// ─── Machine card editor ─────────────────────────────────────────────────────
const editor = new machine.EditorUnderTest();
editor._config = { device_id: 'server-device' };
editor._entitiesByDevice = new Map([['server-device', [
  'sensor.server_status', 'sensor.server_cpu_usage', 'sensor.server_memory_usage',
  'sensor.server_disk_usage', 'sensor.server_cpu_temperature',
  'sensor.server_network_received_speed', 'sensor.server_network_sent_speed',
  'sensor.server_uptime', 'sensor.server_load_1_minute',
]]]);
// Auto-fill matches registry unique IDs, so translated entity IDs still map.
editor._entityRegistry = new Map([['sensor.server_load_1_minute', { unique_id: 'abc_load_1m' }]]);
let emitted;
editor._emit = patch => { emitted = patch; };
editor._autoFill();
assert.deepEqual(Object.keys(emitted).sort(), [
  'entity_cpu', 'entity_disk', 'entity_load_1', 'entity_mem', 'entity_net_rx',
  'entity_net_tx', 'entity_status', 'entity_temp', 'entity_uptime',
]);
assert.equal(emitted.entity_load_1, 'sensor.server_load_1_minute');

// Model persistent controls and HA's config echo. A device selection must
// update the pickers and the published config on the first click.
for (const echoConfig of [false, true]) {
  const switching = new machine.EditorUnderTest();
  switching._hass = { states: {} };
  switching._devices = [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }];
  switching._entityRegistry = new Map();
  switching._entitiesByDevice = new Map([
    ['first', ['sensor.first_status', 'sensor.first_cpu_usage', 'sensor.first_cpu_temperature']],
    ['second', ['sensor.second_status', 'sensor.second_cpu_usage', 'sensor.second_custom']],
  ]);
  const controls = new Map();
  const node = () => ({ value: '', innerHTML: '', checked: false, disabled: false, querySelectorAll: () => [], addEventListener() {} });
  for (const id of ['device', 'autofill', 'advanced-sensors', 'advanced-summary', 'layout', 'show-empty-rows', 'split-network']) controls.set(id, node());
  const pickers = new Map();
  const pickerHost = {
    textContent: '',
    set innerHTML(markup) {
      this.html = markup;
      pickers.clear();
      for (const match of markup.matchAll(/<ha-entity-picker [^>]*data-key="([^"]+)"/g)) {
        pickers.set(match[1], { dataset: { key: match[1] }, value: '', addEventListener() {} });
      }
    },
    querySelectorAll: () => [...pickers.values()],
  };
  controls.set('entity-pickers', pickerHost);
  switching.shadowRoot = {
    getElementById: id => controls.get(id),
    querySelector: selector => pickers.get(selector.match(/data-key="([^"]+)"/)?.[1]),
    querySelectorAll: selector => (/ha-entity-picker/.test(selector) ? [...pickers.values()] : []),
  };
  const configs = [];
  switching.dispatchEvent = event => {
    configs.push(event.detail.config);
    if (echoConfig) switching.setConfig(event.detail.config);
  };
  switching._deviceChanged({ target: { value: 'first' } });
  assert.equal(configs.length, 1, 'publish one complete config per device selection');
  assert.equal(configs[0].entity_cpu, 'sensor.first_cpu_usage');
  assert.equal(pickers.get('entity_cpu').value, 'sensor.first_cpu_usage');
  assert.equal(controls.get('autofill').disabled, false);

  switching._config.extra_entities = ['sensor.first_cpu_temperature'];
  switching._config.extra_pinned = ['sensor.first_cpu_temperature'];
  switching._deviceChanged({ target: { value: 'second' } });
  assert.equal(configs.length, 2);
  assert.equal(configs[1].entity_cpu, 'sensor.second_cpu_usage');
  assert.equal(pickers.get('entity_cpu').value, 'sensor.second_cpu_usage');
  assert.equal(pickers.get('entity_temp').value, '', 'missing sensors must not retain the previous device');
  assert.deepEqual(pickers.get('entity_cpu').includeEntities, ['sensor.second_cpu_usage']);
  assert.equal(configs[1].extra_entities.length, 0);
  assert.equal(configs[1].extra_pinned.length, 0);

  switching._entityChanged({ target: { dataset: { key: 'entity_cpu' } }, detail: { value: 'sensor.second_custom' } });
  switching._entityChanged({ target: { dataset: { key: 'entity_status' } }, detail: { value: '' } });
  switching._autoFill();
  assert.equal(pickers.get('entity_status').value, 'sensor.second_status', 'manual auto-fill refreshes empty controls');
  assert.equal(pickers.get('entity_cpu').value, 'sensor.second_custom', 'manual auto-fill preserves explicit mappings');

  switching._deviceChanged({ target: { value: '' } });
  assert.equal(switching._config.entity_cpu, '');
  assert.equal(controls.get('autofill').disabled, true);
  assert.equal(pickers.get('entity_cpu').disabled, true);
}
assert.match(source, /Additional Beszel metrics/);
assert.match(source, /advanced-preset/);
assert.match(source, /Storage health/);
assert.match(source, /_openAdvancedGroups/);
assert.match(source, /_onlyAdvancedConfigChanged/);
assert.match(source, /data-group=/);
assert.match(source, /id="layout"/);
assert.match(source, /Detailed list \(Beszel style\)/);
assert.match(source, /Terminal style/);
assert.match(source, /Beszel Agent Machine Card/);
assert.doesNotMatch(source, /<mwc-button/);
assert.doesNotMatch(source, /beszel-card|preferLiveEntity|Beszel Card \(legacy\)/);
console.log('Machine card editor tests passed.');

// ─── Systems table ───────────────────────────────────────────────────────────
function tableHass() {
  const states = { 'binary_sensor.beszel_hub_connection': { state: 'on', attributes: {} } };
  const entities = {
    'binary_sensor.beszel_hub_connection': { entity_id: 'binary_sensor.beszel_hub_connection', device_id: 'hub', platform: 'beszel_machine_card', translation_key: 'hub_connection' },
  };
  const devices = { hub: { id: 'hub', name: 'Beszel Hub' } };
  const add = (device, slug, key, state, attributes = {}, translationKey = key) => {
    const id = `sensor.${slug}_${key}`;
    states[id] = { entity_id: id, state: String(state), attributes };
    entities[id] = { entity_id: id, device_id: device, platform: 'beszel_machine_card', translation_key: translationKey };
  };
  devices.srv = { id: 'srv', name: '<script>alert(1)</script>' };
  add('srv', 'srv', 'status', 'up', { threads: 2 });
  add('srv', 'srv', 'cpu_usage', '22.2', { unit_of_measurement: '%' });
  add('srv', 'srv', 'memory_usage', '95', { unit_of_measurement: '%' });
  add('srv', 'srv', 'gpu_usage', '44.4', { unit_of_measurement: '%' });
  add('srv', 'srv', 'battery', '91', { unit_of_measurement: '%' });
  add('srv', 'srv', 'network_received_speed', '1048576', { unit_of_measurement: 'B/s' });
  add('srv', 'srv', 'network_sent_speed', '1024', { unit_of_measurement: 'B/s' });
  add('srv', 'srv', 'load_1m', '3.1');
  add('srv', 'srv', 'services_total', '12');
  add('srv', 'srv', 'services_failed', '1');
  add('srv', 'srv', 'agent_version', '0.19.0');
  add('srv', 'srv', 'fan_cpu_fan', '1200', { unit_of_measurement: 'rpm' }, null);
  devices.nas = { id: 'nas', name: 'nas' };
  add('nas', 'nas', 'status', 'up');
  add('nas', 'nas', 'cpu_usage', '0', { unit_of_measurement: '%' });
  add('nas', 'nas', 'memory_usage', 'unknown', { unit_of_measurement: '%' });
  add('nas', 'nas', 'uptime', '90061', { unit_of_measurement: 's', device_class: 'duration' });
  return { states, entities, devices, user: { is_admin: true } };
}

const tableCard = new table.TableCardUnderTest();
tableCard.setConfig({ title: '<img src=x onerror=alert(1)>', layout: 'table', columns: [...'cpu memory disk gpu load network temperature battery services uptime agent fan'.split(' ')] });
let hass = tableHass();
tableCard.hass = hass;
let tableHtml = tableCard.shadowRoot.innerHTML;
assert.match(tableHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
assert.match(tableHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(tableHtml, /<script>alert|<img src=x/);
// Beszel column order; columns nobody reports are hidden.
const headers = [...tableHtml.matchAll(/data-sort="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(headers, ['name', 'cpu', 'memory', 'gpu', 'load', 'network', 'battery', 'services', 'uptime', 'agent', 'fan']);
assert.match(tableHtml, /22\.2%<\/span><span class="bz-meter"><span class="bz-fill bz-ok"/);
assert.match(tableHtml, /95\.0%<\/span><span class="bz-meter"><span class="bz-fill bz-crit"/);
assert.match(tableHtml, /91\.0%<\/span><span class="bz-meter"><span class="bz-fill bz-ok"/, 'full battery is green');
assert.match(tableHtml, /0\.00%/, 'real zero kept');
assert.match(tableHtml, /bz-dot bz-crit"><\/span>3\.10 – –/, 'load above threads is critical');
assert.match(tableHtml, /title="↓ 1\.00 MiB\/s  ↑ 1\.00 KiB\/s">1\.00 MiB\/s/);
assert.match(tableHtml, /12 <span class="bz-muted">\(failed: 1\)/);
assert.match(tableHtml, /1 day/);
assert.match(tableHtml, /0\.19\.0/);
assert.match(tableHtml, /1200 rpm/);
assert.match(tableHtml, /data-device="srv"/);
assert.doesNotMatch(tableHtml, /NaN|—%|>unknown<|>unavailable</);

// Sorting: numbers high-to-low first; missing values last.
const names = () => [...tableCard.shadowRoot.innerHTML.matchAll(/<td class="system">.*?<\/span>(.*?)<\/td>/g)].map(match => match[1]);
tableCard._toggleSort('cpu');
assert.deepEqual(names(), ['&lt;script&gt;alert(1)&lt;/script&gt;', 'nas']);
tableCard._toggleSort('cpu');
assert.deepEqual(names(), ['nas', '&lt;script&gt;alert(1)&lt;/script&gt;']);
tableCard._toggleSort('memory');
assert.equal(names()[1], 'nas', 'missing readings sort last');
tableCard._toggleSort('memory');
tableCard._toggleSort('memory');
assert.equal(tableCard._sort, null, 'third click clears the sort');

tableCard.setConfig({ ...tableCard._config, hide_empty_columns: false });
tableCard.hass = hass;
assert.match(tableCard.shadowRoot.innerHTML, /data-sort="disk"/);

// Offline systems are omitted unless requested.
hass = tableHass();
hass.states['sensor.srv_status'].state = 'down';
tableCard.hass = hass;
assert.doesNotMatch(tableCard.shadowRoot.innerHTML, /&lt;script&gt;/);
tableCard.setConfig({ ...tableCard._config, hide_when_offline: false });
tableCard.hass = hass;
assert.match(tableCard.shadowRoot.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;<span class="status-label">down/);
hass.states['sensor.nas_status'].state = 'down';
tableCard.setConfig({ ...tableCard._config, hide_when_offline: true });
tableCard.hass = hass;
assert.match(tableCard.shadowRoot.innerHTML, /All matched systems are offline/);

// Hub warning.
hass = tableHass();
hass.states['binary_sensor.beszel_hub_connection'].state = 'off';
tableCard.hass = hass;
assert.match(tableCard.shadowRoot.innerHTML, /Beszel Hub is unreachable/);

// Grid layout renders Beszel's per-system cards; auto switches when narrow.
tableCard.setConfig({ title: 'Grid', layout: 'grid' });
tableCard.hass = tableHass();
tableHtml = tableCard.shadowRoot.innerHTML;
assert.match(tableHtml, /class="grid-card"/);
assert.match(tableHtml, /Services:<\/span><span class="bz-value bz-wide"><span class="bz-dot bz-crit">/);
assert.doesNotMatch(tableHtml, /<table/);
tableCard.setConfig({ title: 'Auto', layout: 'auto' });
tableCard._width = 900;
tableCard._render();
assert.match(tableCard.shadowRoot.innerHTML, /<table/);
tableCard._width = 400;
tableCard._render();
assert.match(tableCard.shadowRoot.innerHTML, /class="grid-card"/);

// Unrelated state changes do not redraw the table.
hass = tableHass();
tableCard.hass = hass;
let tableRedraws = 0;
const tableRender = tableCard._render.bind(tableCard);
tableCard._render = () => { tableRedraws += 1; tableRender(); };
tableCard.hass = { ...hass, states: { ...hass.states, 'sensor.unrelated': { state: '1' } } };
assert.equal(tableRedraws, 0);
tableCard.hass = { ...hass, states: { ...hass.states, 'sensor.srv_cpu_usage': { state: '50', attributes: {} } } };
assert.equal(tableRedraws, 1);
tableCard._render = tableRender;

// Terminal style: one <pre>, no tables/flex/grid/CSS variables.
tableCard.setConfig({ title: 'T', style: 'terminal', columns: ['cpu', 'memory', 'uptime'] });
tableCard.hass = tableHass();
tableHtml = tableCard.shadowRoot.innerHTML;
assert.match(tableHtml, /<pre class="term"/);
assert.match(tableHtml, /\* nas  cpu=0\.0%  mem=-  up=1d 1h/);
assert.doesNotMatch(tableHtml, /<table|display:\s*flex|grid-template|var\(--|:host|color-mix|clamp\(|@container/);

assert.match(tableSource, /Advanced columns/);
assert.match(tableSource, /memory_total/);
assert.match(tableSource, /_advancedColumnsOpen/);
assert.match(tableSource, /_syncColumnCheckboxes/);
assert.match(tableSource, /Hide offline systems/);
assert.match(tableSource, /Terminal style/);
assert.match(tableSource, /Beszel Agent Systems Table/);
assert.doesNotMatch(tableSource, /callWS|beszel-overview-card|Beszel Overview \(legacy\)/);
console.log('Beszel Agent Systems Table smoke tests passed.');
