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
vm.runInContext(bundle(source, 'globalThis.CardUnderTest = BeszelMachineCard; globalThis.EditorUnderTest = BeszelMachineCardEditor; globalThis.common = { formatRate, formatLoads, formatUsedTotal, renderDetailRows, formatRateState, formatRateTotal, formatBytes, entityReading, buildSystemModel, formatPercent, formatUptimeLong, temperatureReading, systemEntitiesFromSeeds, systemEntitiesForDevice, advancedSensorGroup, entityLabel, batteryLevel, rateBytes, cardLanguage, translate, translateMetricName, statusText, LANGUAGES, LANGUAGE_NAMES };'), machine, { filename: 'machine-card.bundle.js' });
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
// A unit picked in the entity's settings is shown as picked; the
// integration's own B/s and B are scaled the way Beszel shows them.
const rate = (state, unit) => ({ state: String(state), attributes: { unit_of_measurement: unit } });
assert.equal(c.formatRateState(rate(132096, 'B/s')), '129 KiB/s');
assert.equal(c.formatRateState(rate(0.16, 'MB/s')), '0.16 MB/s');
assert.equal(c.formatRateState(rate(0.1649, 'MB/s'), 3), '0.165 MB/s', 'display precision is honoured');
assert.equal(c.formatRateState(rate(0, 'Mbit/s')), '0.00 Mbit/s', 'real zero kept');
assert.equal(c.formatRateState(rate('unknown', 'MB/s')), '');
assert.equal(c.formatRateTotal(rate(0.16, 'MB/s'), rate(0.11, 'MB/s')), '0.27 MB/s');
assert.equal(c.formatRateTotal(rate(1, 'MB/s'), rate(1000, 'kB/s')), '1.91 MiB/s', 'mixed units fall back to Beszel scaling');
assert.equal(c.formatRateTotal(rate(1024, 'B/s'), rate('unavailable', 'B/s')), '1.00 KiB/s');
assert.equal(c.formatRateTotal(undefined, undefined), '');
assert.equal(c.formatBytes(2861497669), '2.66 GiB');
assert.deepEqual({ ...c.entityReading(rate(105693, 'B/s')) }, { value: '103', unit: 'KiB/s' });
assert.deepEqual({ ...c.entityReading(rate(88633316, 'B')) }, { value: '84.53', unit: 'MiB' });
assert.deepEqual({ ...c.entityReading(rate(0.1, 'MB/s')) }, { value: '0.10', unit: 'MB/s' });
assert.deepEqual({ ...c.entityReading(rate(88633316, 'B'), 0) }, { value: '85', unit: 'MiB' }, 'precision applies to scaled bytes');
assert.equal(c.formatRateState(rate(1593835, 'B/s'), 1), '1.5 MiB/s', 'precision applies to scaled B/s');
assert.deepEqual({ ...c.entityReading(rate(1.5, 'GiB')) }, { value: '1.5', unit: 'GiB' });
assert.deepEqual({ ...c.entityReading(rate(1.5, 'GiB'), 2) }, { value: '1.50', unit: 'GiB' });
assert.deepEqual({ ...c.entityReading(rate(2373, 'rpm')) }, { value: '2373', unit: 'rpm' });
assert.equal(c.entityReading(rate('unknown', 'B')), null);
{
  const states = { 'sensor.a_rx': rate(0.16, 'MB/s'), 'sensor.a_tx': rate(0.11, 'MB/s') };
  const model = c.buildSystemModel({ states }, { network_received_speed: 'sensor.a_rx', network_sent_speed: 'sensor.a_tx' });
  assert.equal(model.rxText, '0.16 MB/s');
  assert.equal(model.txText, '0.11 MB/s');
  assert.equal(model.netText, '0.27 MB/s');
  assert.equal(model.rx, 160000, 'sorting still uses bytes');
}
// Display precision from the sensor's settings applies to every reading.
assert.equal(c.temperatureReading(rate(64.3, '°C'), 0).text, '64 °C');
assert.equal(c.temperatureReading(rate(64.3, '°C')).text, '64.3 °C');
assert.equal(c.formatPercent(16.12, 0), '16%');
assert.equal(c.formatPercent(0, 3), '0.000%', 'real zero kept');
{
  const ids = { cpu_usage: 'sensor.p_cpu', cpu_temperature: 'sensor.p_temp', load_1m: 'sensor.p_l1', load_5m: 'sensor.p_l5', memory_used: 'sensor.p_mu', memory_total: 'sensor.p_mt' };
  const hass = {
    states: {
      'sensor.p_cpu': rate(28.34, '%'), 'sensor.p_temp': rate(64.3, '°C'), 'sensor.p_l1': rate(0.84, ''),
      'sensor.p_l5': rate(0.73, ''), 'sensor.p_mu': rate(1.5, 'GiB'), 'sensor.p_mt': rate(3.9, 'GiB'),
    },
    entities: {
      'sensor.p_cpu': { display_precision: 0 }, 'sensor.p_temp': { display_precision: 0 },
      'sensor.p_l1': { display_precision: 1 }, 'sensor.p_mu': { display_precision: 2 },
    },
  };
  const model = c.buildSystemModel(hass, ids);
  assert.equal(model.temperature.text, '64 °C');
  assert.equal(c.formatLoads(model.loads, model.digits.loads), '0.8 0.73 –');
  assert.equal(c.formatUsedTotal(model.memoryUsed, model.memoryTotal), '1.50 / 3.9 GiB');
  const rows = c.renderDetailRows(model, {});
  assert.match(rows, />28%</, 'detail rows use the display precision');
  assert.match(rows, />64 °C</);
}
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
// Expanded Beszel collections land in their own editor groups.
const h = value => Buffer.from(value).toString('hex');
for (const [uniqueKey, group] of [
  [`smart_${h('d1')}_health`, 'drives'],
  ['smart_failed', 'drives'],
  [`zp_${h('tank')}_device_errors`, 'pools'],
  [`zp_${h('tank')}_ds_${h('tank/media')}_used`, 'pools'],
  [`z_${h('tank')}_health`, 'storage'],
  [`efs_${h('media')}_read_total`, 'storage'],
  [`container_${h('web')}_cpu`, 'containers'],
  ['containers_running', 'containers'],
  [`service_${h('nginx.service')}_sub_state`, 'containers'],
  [`monitor_${h('m1')}_response_avg_1h`, 'monitors'],
  [`wifi_${h('wlan0')}_signal`, 'network'],
  [`alert_${h('CPU')}`, 'alerts'],
  ['package_updates', 'alerts'],
  ['cpu_softirq', 'processor'],
  ['system_sockets', 'about'],
]) {
  const id = `sensor.x_${uniqueKey}`;
  const reg = new Map([[id, { unique_id: `abc123_${uniqueKey}` }]]);
  assert.equal(c.advancedSensorGroup(id, reg)?.key, group, uniqueKey);
}
// Card language: per card, English for unset or unknown, English fills gaps.
assert.equal(c.cardLanguage({}), 'en');
assert.equal(c.cardLanguage({ language: 'pt' }), 'pt');
assert.equal(c.cardLanguage({ language: 'pt-BR' }), 'pt');
assert.equal(c.cardLanguage({ language: 'xx' }), 'en');
assert.equal(c.translate('pt', 'memory'), 'Memória');
assert.equal(c.translate('pt', 'cpu'), 'CPU', 'missing keys fall back to English');
assert.equal(c.translate('pt', 'nope', 'raw'), 'raw');
assert.equal(c.statusText('de', 'paused'), 'pausiert');
assert.equal(c.statusText('de', 'odd'), 'odd', 'unknown statuses are shown as reported');
assert.equal(c.formatUptimeLong(86400, 'fr'), '1 jour');
assert.equal(c.formatUptimeLong(3 * 86400), '3 days');
for (const language of c.LANGUAGES) assert.ok(c.LANGUAGE_NAMES[language], language);
// Names of expanded and collection metrics are rebuilt in the card language;
// the user's own part (sda, nginx…) and renamed entities stay as they are.
for (const [name, pt, de] of [
  ['CPU core 3', 'Núcleo da CPU 3', 'CPU-Kern 3'],
  ['Drive sda temperature', 'Unidade sda – temperatura', 'Laufwerk sda – Temperatur'],
  ['ZFS pool tank mirror-0 state', 'Pool ZFS tank mirror-0 – estado', 'ZFS-Pool tank mirror-0 – Status'],
  ['Filesystem /mnt/x read total', 'Sistema de ficheiros /mnt/x – total lido', 'Dateisystem /mnt/x – gelesen gesamt'],
  ['Container nginx CPU', 'Contentor nginx – CPU', 'Container nginx – CPU'],
  ['Service sshd.service sub-state', 'Serviço sshd.service – subestado', 'Dienst sshd.service – Unterstatus'],
  ['Monitor HTTP example.com packet loss (1 h)', 'Monitor HTTP example.com – perda de pacotes (1 h)', 'Monitor HTTP example.com – Paketverlust (1 h)'],
  ['Eth0 sent speed', 'Eth0 – velocidade de envio', 'Eth0 – Sendegeschwindigkeit'],
  ['Disk full alert', 'Disk full – alerta', 'Disk full – Warnung'],
  ['Temperature alert', 'Temperatura – alerta', 'Temperatur – Warnung'],
  ['Memory alert', 'Memória – alerta', 'Speicher – Warnung'],
  ['Fan cpu_fan', 'Ventoinha cpu_fan', 'Lüfter cpu_fan'],
  ['Disk read latency', 'Disco – latência de leitura', 'Festplatte – Leselatenz'],
  ['Containers running', 'Contentores em execução', 'Laufende Container'],
  ['Memory total', 'RAM total', 'RAM gesamt'],
  ['My renamed thing', 'My renamed thing', 'My renamed thing'],
  ['Swap <usage>', 'Swap <usage>', 'Swap <usage>'],
]) {
  assert.equal(c.translateMetricName('pt', name), pt);
  assert.equal(c.translateMetricName('de', name), de);
  assert.equal(c.translateMetricName('en', name), name, 'English cards keep the entity name');
}
// Every name metrics.py can build has words here: no English reading is left
// on a translated card. Keep this list in step with metrics.py.
const metricsSource = fs.readFileSync(path.join(root, 'metrics.py'), 'utf8');
for (const [, reading] of metricsSource.matchAll(/f"\{label\} (?:\{(?:title|vname)\} )?([A-Za-z][^"{}]*)"/g)) {
  const translated = c.translateMetricName('pt', `Drive x ${reading}`);
  assert.notEqual(translated, `Drive x ${reading}`, `metrics.py reading "${reading}" has no translation rule`);
}
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

// Editor-saved cards show only what was selected: blank slots stay blank and
// expanded sizes (used/total/cache) appear only when picked as extras.
const editorSlots = {
  entity_status: 'sensor.truenas_status', entity_cpu: 'sensor.truenas_cpu_usage',
  entity_mem: 'sensor.truenas_memory_usage', entity_disk: 'sensor.truenas_disk_usage',
  entity_temp: '', entity_net_rx: '', entity_net_tx: '', entity_uptime: '',
  entity_load_1: '', entity_load_5: '', entity_load_15: '',
};
card.setConfig({ device_id: 'dev1', ...editorSlots });
html = card.shadowRoot.innerHTML;
assert.doesNotMatch(html, /cache|GiB/, 'unselected memory sizes must not appear');
assert.doesNotMatch(html, /61\.5|741 KiB|7d 6h/, 'blank slots must not be auto-discovered');
card.setConfig({ device_id: 'dev1', ...editorSlots, entity_cpu: '', entity_disk: '' });
html = card.shadowRoot.innerHTML;
assert.doesNotMatch(html, />CPU<|>Disk</, 'unselected sensors get no tile');
assert.match(html, />RAM</);
card.setConfig({ device_id: 'dev1', ...editorSlots, entity_cpu: '', entity_mem: '', entity_disk: '' });
assert.doesNotMatch(card.shadowRoot.innerHTML, /class="metrics"/, 'no empty tile grid');
card.setConfig({ device_id: 'dev1', ...editorSlots, entity_cpu: '', style: 'terminal' });
html = card.shadowRoot.innerHTML;
assert.doesNotMatch(html, />cpu |>net |>temp /, 'terminal skips unselected rows');
assert.match(html, />mem  </);
card.setConfig({ device_id: 'dev1', ...editorSlots, layout: 'detailed' });
assert.doesNotMatch(card.shadowRoot.innerHTML, /Load Avg:/);
card.setConfig({ device_id: 'dev1', ...editorSlots, extra_entities: ['sensor.truenas_memory_cache'] });
html = card.shadowRoot.innerHTML;
assert.match(html, /cache 1\.0 GiB/);
assert.doesNotMatch(html, /8\.1 \/ 15\.6/);
assert.doesNotMatch(html, /Memory cache/, 'selected cache merges into the RAM tile');

// Network: Beszel's combined total by default, ↓ / ↑ when split, in every layout.
card.setConfig({ device_id: 'dev1' });
html = card.shadowRoot.innerHTML;
assert.match(html, /title="↓ 741 KiB\/s  ↑ 617 KiB\/s">⇅ 1\.33 MiB\/s/, 'compact shows the combined total');
card.setConfig({ device_id: 'dev1', split_network: true });
html = card.shadowRoot.innerHTML;
assert.match(html, /<span>↓ 741 KiB\/s<\/span><span>↑ 617 KiB\/s<\/span>/, 'compact split');
assert.doesNotMatch(html, /⇅/);
card.setConfig({ device_id: 'dev1', style: 'terminal' });
html = card.shadowRoot.innerHTML;
assert.match(html, />net  <\/td><td class="b">[^<]*<\/td><td class="v">1\.33 MiB\/s</, 'terminal combined total');
card.setConfig({ device_id: 'dev1', style: 'terminal', split_network: true });
html = card.shadowRoot.innerHTML;
assert.match(html, />rx   <\/td><td class="b">[^<]*<\/td><td class="v">741 KiB\/s</);
assert.match(html, />tx   <\/td><td class="b">[^<]*<\/td><td class="v">617 KiB\/s</);

// hide_bars drops the usage bars and keeps the values, in every layout.
card.setConfig({ device_id: 'dev1', hide_bars: true });
html = card.shadowRoot.innerHTML;
assert.doesNotMatch(html, /class="bar-wrap"|class="bar-fill/, 'compact tiles lose their bars');
assert.match(html, /class="metric-val">16\.1<\/span><span class="metric-unit">%<\/span>/, 'compact keeps the value');
assert.match(html, /8\.1 \/ 15\.6 GiB · cache 1\.0 GiB/, 'compact keeps the merged sizes');
card.setConfig({ device_id: 'dev1', layout: 'detailed', hide_bars: true });
html = card.shadowRoot.innerHTML;
assert.doesNotMatch(html, /class="bz-meter"|class="bz-fill/, 'detailed rows lose their bars');
assert.match(html, /CPU:<\/span><span class="bz-value bz-wide">16\.1%<\/span>/, 'detailed keeps the value');
assert.match(html, /Load Avg:<\/span><span class="bz-value bz-wide"><span class="bz-dot bz-ok">/, 'other rows are untouched');
card.setConfig({ device_id: 'dev1', style: 'terminal', hide_bars: true });
html = card.shadowRoot.innerHTML;
assert.doesNotMatch(html, /class="b"|\[[#.]+\]/, 'terminal loses the bar column');
assert.match(html, />cpu  <\/td><td class="v">16\.1%</);
assert.match(html, />net  <\/td><td class="v">1\.33 MiB\/s</);
assert.match(source, /id="hide-bars"><span>Hide the usage bars \(values only\)<\/span>/);

// show_empty_rows keeps sensors without a value (blank, never zero) in every layout.
card.setConfig({ device_id: 'dev1', ...editorSlots, entity_cpu: '', show_empty_rows: true });
html = card.shadowRoot.innerHTML;
assert.match(html, /<div class="metric-label">CPU<\/div><span class="metric-val"><\/span><span class="metric-unit"><\/span>/, 'compact keeps an empty CPU tile');
assert.match(html, />GPU</);
card.setConfig({ device_id: 'dev1', ...editorSlots, entity_cpu: '', style: 'terminal', show_empty_rows: true });
html = card.shadowRoot.innerHTML;
assert.match(html, />cpu  <\/td><td class="b">\[\.+\]<\/td><td class="v"><\/td>/, 'terminal keeps an empty cpu row');
assert.match(html, />temp <\/td><td class="b"> +<\/td><td class="v"><\/td>/);
card.setConfig({ device_id: 'dev1', extra_entities: ['sensor.missing_metric'], layout: 'detailed', show_empty_rows: true });
assert.match(card.shadowRoot.innerHTML, /class="bz-row bz-extra"/, 'detailed keeps an empty extra');
card.setConfig({ device_id: 'dev1', extra_entities: ['sensor.missing_metric'], layout: 'detailed' });
assert.doesNotMatch(card.shadowRoot.innerHTML, /class="bz-row bz-extra"/, 'empty extras hide by default');
assert.match(source, /Show sensors without a value/);
assert.doesNotMatch(source, /Detailed list: keep empty rows|Detailed list: split network/);

// Detailed layout follows Beszel's list.
card.setConfig({ device_id: 'dev1', layout: 'detailed', title: '<img src=x onerror=alert(1)>' });
html = card.shadowRoot.innerHTML;
assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
assert.doesNotMatch(html, /<img src=x/);
assert.match(html, /class="bz-rows"/);
assert.match(html, /CPU:<\/span><span class="bz-cell"><span class="bz-value">16\.1%<\/span><span class="bz-meter">/);
assert.match(html, /Load Avg:<\/span><span class="bz-value bz-wide"><span class="bz-dot bz-ok"><\/span>1\.01 0\.92 1\.15/);
assert.match(html, /Net:<\/span><span class="bz-value bz-wide"><span title="↓ 741 KiB\/s  ↑ 617 KiB\/s">1\.33 MiB\/s/);
assert.match(html, /Uptime:<\/span><span class="bz-value bz-wide">7 days/);
assert.doesNotMatch(html, /GPU:|Bat:|Services:/, 'empty rows are hidden by default');
assert.match(html, /class="bz-menu"/);
card.setConfig({ device_id: 'dev1', layout: 'detailed', show_empty_rows: true, split_network: true });
html = card.shadowRoot.innerHTML;
assert.match(html, /GPU:<\/span><span class="bz-value bz-wide"><\/span>/);
assert.match(html, /<span class="bz-line">↓ 741 KiB\/s<\/span><span class="bz-line">↑ 617 KiB\/s<\/span>/, 'split network puts ↓ and ↑ on separate lines');
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

// hide_when_offline hides the whole card, like HA's conditional card.
const offline = machineHass();
offline.states['sensor.truenas_status'].state = 'down';
const visibility = [];
card.dispatchEvent = event => { if (event.type === 'card-visibility-changed') visibility.push(event.detail.value); };
card.setConfig({ device_id: 'dev1' });
card.hass = offline;
assert.notEqual(card.hidden, true, 'offline cards stay visible unless hide_when_offline is set');
assert.match(card.shadowRoot.innerHTML, />down</);
card.setConfig({ device_id: 'dev1', hide_when_offline: true });
assert.equal(card.hidden, true);
assert.equal(card.shadowRoot.innerHTML, '', 'no name, status or placeholder is left behind');
assert.deepEqual(visibility, [false]);
card.hass = { ...offline, states: { ...offline.states, 'sensor.truenas_cpu_usage': { state: '1', attributes: {} } } };
assert.deepEqual(visibility, [false], 'staying offline does not re-announce');
// Edit mode keeps the card selectable.
card.preview = true;
assert.equal(card.hidden, false);
assert.match(card.shadowRoot.innerHTML, /System offline/);
assert.doesNotMatch(card.shadowRoot.innerHTML, /16\.1/);
card.editMode = false;
assert.equal(card.hidden, true);
assert.equal(card.shadowRoot.innerHTML, '');
// Coming back online shows it again.
card.hass = machineHass();
assert.equal(card.hidden, false);
assert.match(card.shadowRoot.innerHTML, /16\.1/);
assert.deepEqual(visibility, [false, true, false, true]);
// Paused/pending systems and unavailable status sensors are not offline.
for (const state of ['paused', 'pending', 'unavailable']) {
  const other = machineHass();
  other.states['sensor.truenas_status'].state = state;
  card.hass = other;
  assert.equal(card.hidden, false, `${state} keeps the card visible`);
}

// Missing readings stay blank; real zeros stay zero.
const blank = machineHass();
for (const state of Object.values(blank.states)) if (state !== blank.states['sensor.truenas_status']) state.state = 'unknown';
blank.states['sensor.truenas_cpu_usage'].state = '0';
card.setConfig({ device_id: 'dev1' });
card.hass = blank;
html = card.shadowRoot.innerHTML;
assert.match(html, /class="metric-val">0\.00<\/span>/);
assert.doesNotMatch(html, /class="metric-val"><\/span>/, 'tiles without a reading are not shown');
assert.equal((html.match(/class="bar-wrap"/g) || []).length, 1, 'only the CPU tile has a reading');
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
card.hass = { ...redrawHass, entities: { ...redrawHass.entities } };
assert.equal(redraws, 2, 'a registry change (display precision) must redraw the card');
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
assert.equal(card.hidden, true, 'terminal style hides offline cards too');
assert.equal(card.shadowRoot.innerHTML, '');
card.preview = true;
assert.match(card.shadowRoot.innerHTML, /system offline/);
assert.match(source, /Hide the card while the system is offline/);
// Language is a card option: two cards on the same data, two languages.
const english = new machine.CardUnderTest();
english.setConfig({ device_id: 'dev1', layout: 'detailed', extra_entities: ['sensor.truenas_memory_total'] });
english.hass = machineHass();
const portuguese = new machine.CardUnderTest();
portuguese.setConfig({ device_id: 'dev1', layout: 'detailed', language: 'pt', extra_entities: ['sensor.truenas_memory_total'] });
portuguese.hass = machineHass();
assert.match(english.shadowRoot.innerHTML, />Memory:</);
assert.match(english.shadowRoot.innerHTML, />Memory total:</, 'English cards keep the entity name');
assert.match(english.shadowRoot.innerHTML, /7 days/);
assert.match(portuguese.shadowRoot.innerHTML, />Memória:</);
assert.match(portuguese.shadowRoot.innerHTML, />Carga média:</);
assert.match(portuguese.shadowRoot.innerHTML, /7 dias/);
assert.match(portuguese.shadowRoot.innerHTML, />RAM total:</, 'known extras use the card language');
assert.match(portuguese.shadowRoot.innerHTML, /title="Abrir dispositivo"/);
const perCore = machineHass();
perCore.states['sensor.truenas_cpu_core_0'] = { state: '12', attributes: { unit_of_measurement: '%', friendly_name: 'truenas CPU core 0' } };
perCore.states['sensor.truenas_drive_sda_temperature'] = { state: '35', attributes: { unit_of_measurement: '°C', friendly_name: 'truenas Drive <sda> temperature' } };
for (const id of ['sensor.truenas_cpu_core_0', 'sensor.truenas_drive_sda_temperature']) {
  perCore.entities[id] = { entity_id: id, device_id: 'dev1', platform: 'beszel_machine_card' };
}
portuguese.setConfig({ device_id: 'dev1', layout: 'detailed', language: 'pt', extra_entities: ['sensor.truenas_cpu_core_0', 'sensor.truenas_drive_sda_temperature'] });
portuguese.hass = perCore;
assert.match(portuguese.shadowRoot.innerHTML, />Núcleo da CPU 0:</, 'per-core extras follow the card language');
assert.match(portuguese.shadowRoot.innerHTML, />Unidade &lt;sda&gt; – temperatura:</, 'translated names stay escaped');
assert.doesNotMatch(portuguese.shadowRoot.innerHTML, />Memory:<|7 days/);
portuguese.setConfig({ device_id: 'dev1', language: 'pt' });
assert.match(portuguese.shadowRoot.innerHTML, /bz-ok"><\/span>ativo</, 'status follows the card language');
assert.match(portuguese.shadowRoot.innerHTML, />Disco</);
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
  for (const id of ['device', 'autofill', 'advanced-sensors', 'advanced-summary', 'layout', 'show-empty-rows', 'split-network', 'hide-bars']) controls.set(id, node());
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

  // Terminal style is a Layout dropdown choice, not a separate checkbox.
  switching._config = { ...switching._config, layout: 'detailed', style: 'terminal' };
  switching._syncEditorFromConfig();
  assert.equal(controls.get('layout').value, 'terminal');
  switching._config = { ...switching._config, style: undefined };
  switching._syncEditorFromConfig();
  assert.equal(controls.get('layout').value, 'detailed');

  // The hide-bars checkbox follows the config.
  assert.equal(controls.get('hide-bars').checked, false);
  switching._config = { ...switching._config, hide_bars: true };
  switching._syncEditorFromConfig();
  assert.equal(controls.get('hide-bars').checked, true);
}
assert.match(source, /Additional Beszel metrics/);
assert.match(source, /advanced-preset/);
assert.match(source, /Storage health/);
assert.match(source, /_openAdvancedGroups/);
assert.match(source, /_onlyAdvancedConfigChanged/);
assert.match(source, /data-group=/);
assert.match(source, /id="layout"/);
assert.match(source, /Detailed list \(Beszel style\)/);
assert.match(source, /<option value="terminal">Terminal/);
assert.doesNotMatch(source, /id="terminal-style"/);
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

// only_alerts keeps systems with an amber/red indicator and drops the rest.
hass = tableHass();
tableCard.setConfig({ title: 'Alerts', layout: 'table', only_alerts: true, hide_when_offline: false });
tableCard.hass = hass;
tableHtml = tableCard.shadowRoot.innerHTML;
assert.match(tableHtml, /data-device="srv"/, 'srv has critical memory and a failed service');
assert.doesNotMatch(tableHtml, /data-device="nas"/, 'all-green nas is hidden');
assert.equal(tableCard.getCardSize(), 2);
// Home Assistant replaces a state object when it changes; the cards rely on it.
hass = { ...hass, states: { ...hass.states, 'sensor.srv_status': { ...hass.states['sensor.srv_status'], state: 'down' } } };
tableCard.hass = hass;
assert.doesNotMatch(tableCard.shadowRoot.innerHTML, /data-device="srv"/, 'offline systems are hidden even with hide_when_offline off');
assert.equal(tableCard.hidden, true, 'no alerts hides the whole card');
assert.equal(tableCard.shadowRoot.innerHTML, '', 'no "no alerts" message is left behind');
assert.equal(tableCard.getCardSize(), 0);
// Each indicator counts on its own: status pending, temperature, battery, load, GPU.
for (const [label, mutate] of [
  ['pending status', h => { h.states['sensor.nas_status'].state = 'pending'; }],
  ['hot cpu', h => { h.states['sensor.nas_cpu_temperature'] = { state: '70', attributes: { unit_of_measurement: '°C' } }; h.entities['sensor.nas_cpu_temperature'] = { entity_id: 'sensor.nas_cpu_temperature', device_id: 'nas', platform: 'beszel_machine_card', translation_key: 'cpu_temperature' }; }],
  ['low battery', h => { h.states['sensor.nas_battery'] = { state: '20', attributes: { unit_of_measurement: '%' } }; h.entities['sensor.nas_battery'] = { entity_id: 'sensor.nas_battery', device_id: 'nas', platform: 'beszel_machine_card', translation_key: 'battery' }; }],
  ['cpu at warning threshold', h => { h.states['sensor.nas_cpu_usage'].state = '65'; }],
]) {
  hass = tableHass();
  hass.states['sensor.srv_memory_usage'].state = '10';
  hass.states['sensor.srv_services_failed'].state = '0';
  hass.states['sensor.srv_load_1m'].state = '0.5';
  mutate(hass);
  tableCard.setConfig({ title: 'Alerts', layout: 'table', only_alerts: true });
  tableCard.hass = hass;
  tableHtml = tableCard.shadowRoot.innerHTML;
  assert.match(tableHtml, /data-device="nas"/, `${label} is an alert`);
  assert.doesNotMatch(tableHtml, /data-device="srv"/, `${label}: calm srv is hidden`);
}
// Custom thresholds apply to the filter too.
hass = tableHass();
hass.states['sensor.srv_memory_usage'].state = '50';
hass.states['sensor.srv_services_failed'].state = '0';
hass.states['sensor.srv_load_1m'].state = '0.5';
tableCard.setConfig({ title: 'Alerts', layout: 'table', only_alerts: true, warning_threshold: 40, critical_threshold: 80 });
tableCard.hass = hass;
assert.match(tableCard.shadowRoot.innerHTML, /data-device="srv"/, 'lower warning threshold surfaces srv');
// Terminal style shares the filter and its empty state.
hass = tableHass();
hass.states['sensor.srv_memory_usage'].state = '10';
hass.states['sensor.srv_services_failed'].state = '0';
hass.states['sensor.srv_load_1m'].state = '0.5';
tableCard.setConfig({ title: 'T', style: 'terminal', only_alerts: true, columns: ['cpu'] });
tableCard.hass = hass;
assert.equal(tableCard.hidden, true, 'terminal style hides with no alerts too');
assert.equal(tableCard.shadowRoot.innerHTML, '');
tableCard.preview = true;
assert.match(tableCard.shadowRoot.innerHTML, /no alerts \(hidden outside edit mode\)/);
tableCard.preview = false;
assert.match(tableSource, /Show only systems with alerts/);

// Hiding follows HA's conditional-card contract and stays editable.
const alertCard = new table.TableCardUnderTest();
const tableVisibility = [];
alertCard.dispatchEvent = event => { if (event.type === 'card-visibility-changed') tableVisibility.push(event.detail.value); };
const calmHass = () => {
  const h = tableHass();
  h.states['sensor.srv_memory_usage'].state = '10';
  h.states['sensor.srv_services_failed'].state = '0';
  h.states['sensor.srv_load_1m'].state = '0.5';
  return h;
};
alertCard.setConfig({ title: 'Alerts', layout: 'table', only_alerts: true });
assert.notEqual(alertCard.hidden, true, 'not hidden before hass arrives');
alertCard.hass = calmHass();
assert.equal(alertCard.hidden, true);
assert.deepEqual(tableVisibility, [false]);
alertCard.hass = { ...calmHass(), states: { ...calmHass().states, 'sensor.nas_cpu_usage': { state: '1', attributes: {} } } };
assert.deepEqual(tableVisibility, [false], 'staying calm does not re-announce');
alertCard.editMode = true;
assert.equal(alertCard.hidden, false, 'edit mode keeps the card selectable');
assert.match(alertCard.shadowRoot.innerHTML, /No systems with alerts \(card hidden outside edit mode\)/);
alertCard.preview = false;
assert.equal(alertCard.hidden, true);
// An alert appears: the card comes back with just that system.
const hot = calmHass();
hot.states['sensor.nas_cpu_usage'].state = '95';
alertCard.hass = hot;
assert.equal(alertCard.hidden, false);
assert.match(alertCard.shadowRoot.innerHTML, /data-device="nas"/);
assert.doesNotMatch(alertCard.shadowRoot.innerHTML, /data-device="srv"/);
assert.deepEqual(tableVisibility, [false, true, false, true]);
// Grid layout shares the filter.
alertCard.setConfig({ title: 'Alerts', layout: 'grid', only_alerts: true });
assert.match(alertCard.shadowRoot.innerHTML, /class="grid-card"[\s\S]*>nas</);
alertCard.hass = calmHass();
assert.equal(alertCard.hidden, true);
// A Hub outage is itself worth seeing: the card stays with the warning.
const hubOff = calmHass();
hubOff.states['binary_sensor.beszel_hub_connection'].state = 'off';
alertCard.hass = hubOff;
assert.equal(alertCard.hidden, false);
assert.match(alertCard.shadowRoot.innerHTML, /Beszel Hub is unreachable/);
// No Beszel devices at all is a setup problem, not "no alerts".
alertCard.hass = { states: {}, entities: {}, devices: {}, user: { is_admin: true } };
assert.equal(alertCard.hidden, false);
assert.match(alertCard.shadowRoot.innerHTML, /No Beszel system devices were found/);
// Turning the option off brings back the all-systems view.
alertCard.setConfig({ title: 'All', layout: 'table' });
alertCard.hass = calmHass();
assert.equal(alertCard.hidden, false);
assert.match(alertCard.shadowRoot.innerHTML, /data-device="srv"[\s\S]*data-device="nas"|data-device="nas"[\s\S]*data-device="srv"/);
// Selected systems narrow the alert filter.
alertCard.setConfig({ title: 'Alerts', layout: 'table', only_alerts: true, system_ids: ['srv'] });
alertCard.hass = hot;
assert.equal(alertCard.hidden, true, 'nas alert is outside the selection');
tableCard.setConfig({ title: 'Table', layout: 'table' });

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
// hide_bars keeps the percentages without their bars, in grid and table.
assert.match(tableHtml, /CPU:<\/span><span class="bz-cell"><span class="bz-value">22\.2%<\/span><span class="bz-meter">/);
tableCard.setConfig({ title: 'Grid', layout: 'grid', hide_bars: true });
tableHtml = tableCard.shadowRoot.innerHTML;
assert.doesNotMatch(tableHtml, /class="bz-meter"|class="bz-fill/, 'grid cards lose their bars');
assert.match(tableHtml, /CPU:<\/span><span class="bz-value bz-wide">22\.2%<\/span>/, 'grid keeps the value');
tableCard.setConfig({ title: 'Table', layout: 'table', hide_bars: true, columns: ['cpu', 'memory', 'battery'] });
tableHtml = tableCard.shadowRoot.innerHTML;
assert.doesNotMatch(tableHtml, /class="bz-meter"|class="bz-fill|class="pct"/, 'table cells lose their bars');
assert.match(tableHtml, /<td>22\.2%<\/td><td>95\.0%<\/td><td>91\.0%<\/td>/, 'table keeps the values');
assert.match(tableHtml, /<td>0\.00%<\/td>/, 'real zero kept');
assert.doesNotMatch(tableHtml, /NaN|—%|>unknown<|>unavailable</);
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
// ─── Systems table editor ────────────────────────────────────────────────────
function editorRoot() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { id, value: '', checked: false, disabled: false, dataset: {}, listeners: {}, addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }, focus() {}, setSelectionRange() {} });
    return nodes.get(id);
  };
  const root = {
    nodes,
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(value) {
      this._html = value;
      nodes.clear();
      for (const [, attr, val] of value.matchAll(/data-(system-id|column)="([^"]+)"/g)) {
        const box = node(`${attr}:${val}`);
        box.dataset[attr === 'column' ? 'column' : 'systemId'] = val;
      }
    },
    getElementById: id => node(id),
    querySelector: selector => {
      if (selector === '.editor') return root._html.includes('class="editor"') ? {} : null;
      const match = selector.match(/^\[data-(system-id|column)="([^"]+)"\]$/);
      return match ? nodes.get(`${match[1]}:${match[2]}`) || null : null;
    },
    querySelectorAll: selector => {
      const prefix = selector === '[data-system-id]' ? 'system-id:' : selector === '[data-column]' ? 'column:' : null;
      return prefix ? [...nodes.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value) : [];
    },
  };
  return root;
}
const tableEditor = new table.TableEditorUnderTest();
tableEditor.shadowRoot = editorRoot();
const editorEvents = [];
tableEditor.dispatchEvent = event => editorEvents.push(event.detail.config);
tableEditor.setConfig({ title: 'Homelab' });
tableEditor.hass = tableHass();
const ed = tableEditor.shadowRoot;
const editorHtml = ed.innerHTML;
// Every setup option is present.
for (const id of ['title', 'layout', 'hub-status', 'hide-offline', 'only-alerts', 'hide-empty-columns', 'split-network', 'hide-bars', 'systems', 'columns']) {
  assert.match(editorHtml, new RegExp(`id="${id}"`), `editor has #${id}`);
}
assert.match(editorHtml, /Show only systems with alerts \(hide the card when none\)/);
assert.match(editorHtml, /data-system-id="srv"/);
assert.match(editorHtml, /data-system-id="nas"/);
assert.doesNotMatch(editorHtml, /<script>alert/, 'system names are escaped in the editor');
// HA no longer ships ha-formfield, whose label attribute then renders nothing.
// Checkbox labels must be real text next to a native input.
for (const [name, src] of [['machine card', source], ['systems table', tableSource]]) {
  assert.doesNotMatch(src, /<ha-formfield|<ha-checkbox/, `${name} editor does not rely on ha-formfield/ha-checkbox`);
}
const tableChecks = editorHtml.match(/<input type="checkbox"[^>]*>/g) || [];
assert.ok(tableChecks.length >= 8, 'table editor renders native checkboxes');
assert.equal((editorHtml.match(/<label class="check"><input type="checkbox"[^>]*><span>[^<]+<\/span><\/label>/g) || []).length, tableChecks.length, 'every table editor checkbox has visible label text');
assert.equal(ed.getElementById('title').value, 'Homelab');
assert.equal(ed.getElementById('layout').value, 'auto');
assert.equal(ed.getElementById('language').value, 'en', 'language defaults to English');
assert.match(editorHtml, /<option value="pt">Português<\/option>/);
assert.equal(ed.getElementById('hub-status').checked, true);
assert.equal(ed.getElementById('hide-offline').checked, true);
assert.equal(ed.getElementById('only-alerts').checked, false, 'only_alerts defaults off');
assert.equal(ed.getElementById('hide-offline').disabled, false);
assert.equal(ed.getElementById('hide-empty-columns').checked, true);
assert.equal(ed.getElementById('split-network').checked, false);
assert.equal(ed.getElementById('hide-bars').checked, false, 'hide_bars defaults off');
assert.match(editorHtml, /id="hide-bars"><span>Hide the usage bars \(values only\)<\/span>/);
assert.doesNotMatch(editorHtml, /id="terminal-style"/, 'terminal style is a Layout choice, not a checkbox');
assert.match(editorHtml, /<option value="terminal">Terminal/);
// Picking Terminal sets style: terminal; picking another layout clears it.
const layoutSelect = ed.getElementById('layout');
layoutSelect.value = 'terminal';
layoutSelect.listeners.change.forEach(fn => fn());
assert.equal(editorEvents.at(-1).style, 'terminal');
layoutSelect.value = 'grid';
layoutSelect.listeners.change.forEach(fn => fn());
assert.equal(editorEvents.at(-1).layout, 'grid');
assert.equal('style' in editorEvents.at(-1), false);
assert.equal(ed.querySelector('[data-column="cpu"]').checked, true);
assert.equal(ed.querySelector('[data-column="memory_total"]').checked, false);
// Toggling only_alerts emits it and disables the redundant offline toggle.
const onlyAlerts = ed.getElementById('only-alerts');
onlyAlerts.checked = true;
onlyAlerts.listeners.change.forEach(fn => fn());
assert.equal(editorEvents.at(-1).only_alerts, true);
tableEditor.setConfig(editorEvents.at(-1));
assert.equal(ed.getElementById('only-alerts').checked, true);
assert.equal(ed.getElementById('hide-offline').disabled, true);
// Default-on options are stored as explicit false.
const hideOffline = ed.getElementById('hide-offline');
hideOffline.checked = false;
hideOffline.listeners.change.forEach(fn => fn());
assert.equal(editorEvents.at(-1).hide_when_offline, false);
// Ticking hide-bars emits hide_bars.
const hideBars = ed.getElementById('hide-bars');
hideBars.checked = true;
hideBars.listeners.change.forEach(fn => fn());
assert.equal(editorEvents.at(-1).hide_bars, true);
// Unchecking systems narrows system_ids; the last one cannot be unchecked.
tableEditor.setConfig({ title: 'Homelab' });
const srvBox = ed.querySelector('[data-system-id="srv"]');
srvBox.checked = false;
srvBox.listeners.change.forEach(fn => fn());
assert.deepEqual([...editorEvents.at(-1).system_ids], ['nas']);
tableEditor.setConfig(editorEvents.at(-1));
const eventCount = editorEvents.length;
const nasBox = ed.querySelector('[data-system-id="nas"]');
nasBox.checked = false;
nasBox.listeners.change.forEach(fn => fn());
assert.equal(editorEvents.length, eventCount, 'unchecking the last system emits nothing');
assert.equal(nasBox.checked, true, 'the last system stays checked');
console.log('Systems table editor tests passed.');

// Language is a card option: headers, cells and messages follow it.
const germanTable = new table.TableCardUnderTest();
germanTable.setConfig({ layout: 'table', language: 'de', hide_when_offline: false, columns: ['cpu', 'memory', 'services', 'uptime', 'fan'] });
germanTable.hass = tableHass();
const germanHtml = germanTable.shadowRoot.innerHTML;
assert.match(germanHtml, /<\/ha-icon>Speicher</);
assert.match(germanHtml, /<\/ha-icon>Dienste</);
assert.match(germanHtml, />Lüfter U\/min</);
assert.match(germanHtml, /\(fehlgeschlagen: 1\)/);
assert.match(germanHtml, /1 Tag</);
assert.match(germanHtml, /class="status-label">online</);
assert.doesNotMatch(germanHtml, />Memory<|>Services<|failed:|1 day/);
germanTable.setConfig({ layout: 'grid', language: 'de' });
assert.match(germanTable.shadowRoot.innerHTML, />Speicher:</, 'grid rows are translated too');
const languageSelect = ed.getElementById('language');
languageSelect.value = 'fr';
languageSelect.listeners.change.forEach(fn => fn());
assert.equal(editorEvents.at(-1).language, 'fr');

assert.doesNotMatch(tableSource, /callWS|beszel-overview-card|Beszel Overview \(legacy\)/);
console.log('Beszel Agent Systems Table smoke tests passed.');
