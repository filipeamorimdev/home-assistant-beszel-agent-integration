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

// Home Assistant replaces a state object whenever the entity changes, so
// comparing references tells whether anything a card watches was updated.
export function sameItems(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

// ─── Card language ───────────────────────────────────────────────────────────
// Each card picks its own language (`language: pt`), so dashboards in different
// languages can sit side by side. Unset or unknown → English. The text a card
// draws itself is translated, and so are the names of the integration's own
// metrics (translateMetricName); names typed by the user are shown as they are.
export const LANGUAGES = ['en', 'pt', 'es', 'fr', 'de'];
export const LANGUAGE_NAMES = { en: 'English', pt: 'Português', es: 'Español', fr: 'Français', de: 'Deutsch' };

const STRINGS = {
  en: {
    cpu: 'CPU', memory: 'Memory', ram: 'RAM', disk: 'Disk', gpu: 'GPU', load: 'Load Avg',
    network: 'Net', temperature: 'Temp', battery: 'Bat', services: 'Services',
    uptime: 'Uptime', agent: 'Agent', system: 'System',
    failed: 'failed', day: 'day', days: 'days', cache: 'cache', yes: 'Yes', no: 'No',
    status_up: 'up', status_down: 'down', status_paused: 'paused', status_pending: 'pending',
    open_device: 'Open device',
    hub_unreachable: 'Beszel Hub is unreachable. Displayed values may be stale.',
    offline_note: 'System offline — hidden outside edit mode',
    discovering: 'Discovering Beszel systems…',
    no_systems: 'No Beszel system devices were found.',
    no_alerts: 'No systems with alerts (card hidden outside edit mode).',
    all_offline: 'All matched systems are offline.',
    memory_total: 'RAM total', memory_used: 'RAM used', memory_cache: 'RAM cache',
    memory_zfs_arc: 'ZFS ARC', swap_total: 'Swap total', swap_used: 'Swap used',
    swap_usage: 'Swap', disk_total: 'Disk total', disk_used: 'Disk used',
    disk_free: 'Disk free', disk_read_speed: 'Disk read', disk_write_speed: 'Disk write',
    cpu_user: 'CPU user', cpu_system: 'CPU system', cpu_iowait: 'CPU I/O wait', fan: 'Fan RPM',
  },
  pt: {
    memory: 'Memória', disk: 'Disco', load: 'Carga média', network: 'Rede',
    services: 'Serviços', uptime: 'Tempo ativo', agent: 'Agente', system: 'Sistema',
    failed: 'com falha', day: 'dia', days: 'dias', yes: 'Sim', no: 'Não',
    status_up: 'ativo', status_down: 'inativo', status_paused: 'em pausa', status_pending: 'pendente',
    open_device: 'Abrir dispositivo',
    hub_unreachable: 'O Beszel Hub está inacessível. Os valores apresentados podem estar desatualizados.',
    offline_note: 'Sistema offline — oculto fora do modo de edição',
    discovering: 'A procurar sistemas Beszel…',
    no_systems: 'Não foram encontrados dispositivos de sistemas Beszel.',
    no_alerts: 'Nenhum sistema com alertas (cartão oculto fora do modo de edição).',
    all_offline: 'Todos os sistemas correspondentes estão offline.',
    memory_used: 'RAM usada', memory_cache: 'Cache da RAM', swap_used: 'Swap usada',
    disk_total: 'Disco total', disk_used: 'Disco usado', disk_free: 'Disco livre',
    disk_read_speed: 'Leitura do disco', disk_write_speed: 'Escrita do disco',
    cpu_user: 'CPU utilizador', cpu_system: 'CPU sistema', cpu_iowait: 'CPU espera E/S',
    fan: 'Ventoinha RPM',
  },
  es: {
    memory: 'Memoria', disk: 'Disco', load: 'Carga media', network: 'Red',
    services: 'Servicios', uptime: 'Tiempo activo', agent: 'Agente', system: 'Sistema',
    failed: 'con fallo', day: 'día', days: 'días', cache: 'caché', yes: 'Sí', no: 'No',
    status_up: 'activo', status_down: 'inactivo', status_paused: 'en pausa', status_pending: 'pendiente',
    open_device: 'Abrir dispositivo',
    hub_unreachable: 'No se puede acceder al Beszel Hub. Los valores mostrados pueden estar desactualizados.',
    offline_note: 'Sistema sin conexión — oculto fuera del modo de edición',
    discovering: 'Buscando sistemas Beszel…',
    no_systems: 'No se encontraron dispositivos de sistemas Beszel.',
    no_alerts: 'Ningún sistema con alertas (tarjeta oculta fuera del modo de edición).',
    all_offline: 'Todos los sistemas coincidentes están sin conexión.',
    memory_used: 'RAM usada', memory_cache: 'Caché de RAM', swap_used: 'Swap usada',
    disk_total: 'Disco total', disk_used: 'Disco usado', disk_free: 'Disco libre',
    disk_read_speed: 'Lectura de disco', disk_write_speed: 'Escritura de disco',
    cpu_user: 'CPU usuario', cpu_system: 'CPU sistema', cpu_iowait: 'CPU espera E/S',
    fan: 'Ventilador RPM',
  },
  fr: {
    memory: 'Mémoire', disk: 'Disque', load: 'Charge moy.', network: 'Réseau',
    uptime: 'Disponibilité', system: 'Système',
    failed: 'en échec', day: 'jour', days: 'jours', yes: 'Oui', no: 'Non',
    status_up: 'en ligne', status_down: 'hors ligne', status_paused: 'en pause', status_pending: 'en attente',
    open_device: 'Ouvrir l’appareil',
    hub_unreachable: 'Le Beszel Hub est injoignable. Les valeurs affichées peuvent être obsolètes.',
    offline_note: 'Système hors ligne — masqué hors du mode édition',
    discovering: 'Recherche des systèmes Beszel…',
    no_systems: 'Aucun appareil système Beszel trouvé.',
    no_alerts: 'Aucun système en alerte (carte masquée hors du mode édition).',
    all_offline: 'Tous les systèmes correspondants sont hors ligne.',
    memory_total: 'RAM totale', memory_used: 'RAM utilisée', memory_cache: 'Cache RAM',
    swap_used: 'Swap utilisé', disk_total: 'Disque total', disk_used: 'Disque utilisé',
    disk_free: 'Disque libre', disk_read_speed: 'Lecture disque', disk_write_speed: 'Écriture disque',
    cpu_user: 'CPU utilisateur', cpu_system: 'CPU système', cpu_iowait: 'CPU attente E/S',
    fan: 'Ventilateur tr/min',
  },
  de: {
    memory: 'Speicher', disk: 'Festplatte', load: 'Last', network: 'Netz', battery: 'Akku',
    services: 'Dienste', uptime: 'Laufzeit',
    failed: 'fehlgeschlagen', day: 'Tag', days: 'Tage', cache: 'Cache', yes: 'Ja', no: 'Nein',
    status_up: 'online', status_down: 'offline', status_paused: 'pausiert', status_pending: 'ausstehend',
    open_device: 'Gerät öffnen',
    hub_unreachable: 'Der Beszel Hub ist nicht erreichbar. Die angezeigten Werte können veraltet sein.',
    offline_note: 'System offline — außerhalb des Bearbeitungsmodus ausgeblendet',
    discovering: 'Beszel-Systeme werden gesucht…',
    no_systems: 'Keine Beszel-Systemgeräte gefunden.',
    no_alerts: 'Keine Systeme mit Warnungen (Karte außerhalb des Bearbeitungsmodus ausgeblendet).',
    all_offline: 'Alle passenden Systeme sind offline.',
    memory_total: 'RAM gesamt', memory_used: 'RAM belegt', memory_cache: 'RAM-Cache',
    swap_total: 'Swap gesamt', swap_used: 'Swap belegt', disk_total: 'Festplatte gesamt',
    disk_used: 'Festplatte belegt', disk_free: 'Festplatte frei',
    disk_read_speed: 'Festplatte Lesen', disk_write_speed: 'Festplatte Schreiben',
    cpu_user: 'CPU Benutzer', cpu_system: 'CPU System', cpu_iowait: 'CPU I/O-Wartezeit',
    fan: 'Lüfter U/min',
  },
};

export function cardLanguage(config) {
  const language = String(pick(config, 'language') || '').toLowerCase().slice(0, 2);
  return LANGUAGES.includes(language) ? language : 'en';
}

// Text for `key` in `language`; English fills any gap. Unknown keys return
// `fallback` (the key itself when none is given).
export function translate(language, key, fallback) {
  const own = pick(STRINGS, language, key);
  if (typeof own === 'string') return own;
  const english = STRINGS.en[key];
  if (typeof english === 'string') return english;
  return fallback === undefined ? key : fallback;
}

// "up" / "paused" as Beszel reports it, in the card's language.
export function statusText(language, status) {
  return status ? translate(language, `status_${status}`, status) : '';
}

// ─── Metric names ────────────────────────────────────────────────────────────
// Expanded and collection metrics (per core, drive, pool, container, monitor…)
// carry the English name the integration gave them, built as
// "<subject> <name> <reading>" (metrics.py). A translated card rebuilds that
// name from these words; the middle part (sda, tank, nginx…) is the user's own
// and stays as it is. A name that does not fit — one the user renamed — is
// shown unchanged.

// Whole names that map to a label the cards already have.
const METRIC_KEYS = {
  'Memory total': 'memory_total', 'Memory used': 'memory_used', 'Memory cache': 'memory_cache',
  'ZFS ARC memory': 'memory_zfs_arc', 'Swap total': 'swap_total', 'Swap used': 'swap_used',
  'Swap usage': 'swap_usage', 'Disk total': 'disk_total', 'Disk used': 'disk_used',
  'Disk free': 'disk_free', 'Disk read speed': 'disk_read_speed', 'Disk write speed': 'disk_write_speed',
  'CPU user': 'cpu_user', 'CPU system': 'cpu_system', 'CPU iowait': 'cpu_iowait',
};

// English, then pt, es, fr, de (the order of LANGUAGES). '' keeps the English.
const METRIC_WORDS = {};
[
  // Whole names.
  ['Hostname', 'Nome do anfitrião', 'Nombre de host', 'Nom d’hôte', ''],
  ['Operating system', 'Sistema operativo', 'Sistema operativo', 'Système d’exploitation', 'Betriebssystem'],
  ['CPU model', 'Modelo da CPU', 'Modelo de CPU', 'Modèle de CPU', 'CPU-Modell'],
  ['Architecture', 'Arquitetura', 'Arquitectura', '', 'Architektur'],
  ['Cores', 'Núcleos', 'Núcleos', 'Cœurs', 'Kerne'],
  ['CPU sockets', 'Sockets da CPU', 'Sockets de CPU', 'Sockets CPU', 'CPU-Sockel'],
  ['Agent connection', 'Ligação do agente', 'Conexión del agente', 'Connexion de l’agent', 'Agent-Verbindung'],
  ['Package updates', 'Atualizações de pacotes', 'Actualizaciones de paquetes', 'Mises à jour de paquets', 'Paketaktualisierungen'],
  ['Security updates', 'Atualizações de segurança', 'Actualizaciones de seguridad', 'Mises à jour de sécurité', 'Sicherheitsaktualisierungen'],
  ['Drives failing SMART', 'Unidades com falha SMART', 'Unidades con fallo SMART', 'Disques en échec SMART', 'Laufwerke mit SMART-Fehler'],
  ['Containers running', 'Contentores em execução', 'Contenedores en ejecución', 'Conteneurs en cours d’exécution', 'Laufende Container'],
  ['Containers unhealthy', 'Contentores com problemas', 'Contenedores con problemas', 'Conteneurs défaillants', 'Fehlerhafte Container'],
  ['Container updates', 'Atualizações de contentores', 'Actualizaciones de contenedores', 'Mises à jour de conteneurs', 'Container-Updates'],
  ['Active alerts', 'Alertas ativos', 'Alertas activas', 'Alertes actives', 'Aktive Warnungen'],
  ['Memory', 'Memória', 'Memoria', 'Mémoire', 'Speicher'],
  ['Status', 'Estado', 'Estado', 'État', ''],
  // Subjects.
  ['ZFS dataset', 'Dataset ZFS', 'Dataset ZFS', 'Dataset ZFS', 'ZFS-Dataset'],
  ['ZFS pool', 'Pool ZFS', 'Pool ZFS', 'Pool ZFS', 'ZFS-Pool'],
  ['Filesystem', 'Sistema de ficheiros', 'Sistema de archivos', 'Système de fichiers', 'Dateisystem'],
  ['Drive', 'Unidade', 'Unidad', 'Disque', 'Laufwerk'],
  ['Container', 'Contentor', 'Contenedor', 'Conteneur', ''],
  ['Service', 'Serviço', 'Servicio', '', 'Dienst'],
  ['Monitor', '', '', 'Moniteur', ''],
  ['Temperature', 'Temperatura', 'Temperatura', 'Température', 'Temperatur'],
  ['Fan', 'Ventoinha', 'Ventilador', 'Ventilateur', 'Lüfter'],
  ['Battery', 'Bateria', 'Batería', 'Batterie', 'Akku'],
  ['CPU core', 'Núcleo da CPU', 'Núcleo de CPU', 'Cœur CPU', 'CPU-Kern'],
  ['Disk', 'Disco', 'Disco', 'Disque', 'Festplatte'],
  // Readings.
  ['total', '', '', '', 'gesamt'],
  ['used', 'usado', 'usado', 'utilisé', 'belegt'],
  ['free', 'livre', 'libre', 'libre', 'frei'],
  ['available', 'disponível', 'disponible', 'disponible', 'verfügbar'],
  ['usage', 'utilização', 'uso', 'utilisation', 'Auslastung'],
  ['utilization', 'utilização', 'utilización', 'utilisation', 'Auslastung'],
  ['read', 'leitura', 'lectura', 'lecture', 'Lesen'],
  ['write', 'escrita', 'escritura', 'écriture', 'Schreiben'],
  ['read total', 'total lido', 'total leído', 'total lu', 'gelesen gesamt'],
  ['write total', 'total escrito', 'total escrito', 'total écrit', 'geschrieben gesamt'],
  ['read time', 'tempo de leitura', 'tiempo de lectura', 'temps de lecture', 'Lesezeit'],
  ['write time', 'tempo de escrita', 'tiempo de escritura', 'temps d’écriture', 'Schreibzeit'],
  ['read latency', 'latência de leitura', 'latencia de lectura', 'latence de lecture', 'Leselatenz'],
  ['write latency', 'latência de escrita', 'latencia de escritura', 'latence d’écriture', 'Schreiblatenz'],
  ['weighted time', 'tempo ponderado', 'tiempo ponderado', 'temps pondéré', 'gewichtete Zeit'],
  ['idle', 'inativo', 'inactivo', 'inactif', 'Leerlauf'],
  ['steal', '', '', '', ''], ['irq', '', '', '', ''], ['softirq', '', '', '', ''], ['nice', '', '', '', ''],
  ['sent speed', 'velocidade de envio', 'velocidad de envío', 'débit envoyé', 'Sendegeschwindigkeit'],
  ['received speed', 'velocidade de receção', 'velocidad de recepción', 'débit reçu', 'Empfangsgeschwindigkeit'],
  ['sent total', 'total enviado', 'total enviado', 'total envoyé', 'gesendet gesamt'],
  ['received total', 'total recebido', 'total recibido', 'total reçu', 'empfangen gesamt'],
  ['signal', 'sinal', 'señal', '', 'Signal'],
  ['SSID', '', '', '', ''],
  ['memory used', 'memória usada', 'memoria usada', 'mémoire utilisée', 'Speicher belegt'],
  ['memory total', 'memória total', 'memoria total', 'mémoire totale', 'Speicher gesamt'],
  ['power', 'potência', 'potencia', 'puissance', 'Leistung'],
  ['package power', 'potência do pacote', 'potencia del paquete', 'puissance du package', 'Package-Leistung'],
  ['engine', 'motor', 'motor', 'moteur', 'Engine'],
  ['health', 'saúde', 'salud', 'santé', 'Zustand'],
  ['SMART health', 'estado SMART', 'estado SMART', 'état SMART', 'SMART-Zustand'],
  ['temperature', 'temperatura', 'temperatura', 'température', 'Temperatur'],
  ['power-on hours', 'horas ligado', 'horas encendido', 'heures de fonctionnement', 'Betriebsstunden'],
  ['power cycles', 'ciclos de energia', 'ciclos de encendido', 'cycles d’alimentation', 'Einschaltzyklen'],
  ['capacity', 'capacidade', 'capacidad', 'capacité', 'Kapazität'],
  ['wear', 'desgaste', 'desgaste', 'usure', 'Verschleiß'],
  ['available spare', 'reserva disponível', 'reserva disponible', 'réserve disponible', 'verfügbare Reserve'],
  ['reallocated sectors', 'setores realocados', 'sectores reasignados', 'secteurs réalloués', 'neu zugewiesene Sektoren'],
  ['pending sectors', 'setores pendentes', 'sectores pendientes', 'secteurs en attente', 'ausstehende Sektoren'],
  ['uncorrectable sectors', 'setores incorrigíveis', 'sectores incorregibles', 'secteurs incorrigibles', 'nicht korrigierbare Sektoren'],
  ['media errors', 'erros de suporte', 'errores de medio', 'erreurs de média', 'Medienfehler'],
  ['CRC errors', 'erros CRC', 'errores CRC', 'erreurs CRC', 'CRC-Fehler'],
  ['model', 'modelo', 'modelo', 'modèle', 'Modell'],
  ['serial number', 'número de série', 'número de serie', 'numéro de série', 'Seriennummer'],
  ['firmware', '', '', '', 'Firmware'],
  ['type', 'tipo', 'tipo', '', 'Typ'],
  ['scrub errors', 'erros de scrub', 'errores de scrub', 'erreurs de scrub', 'Scrub-Fehler'],
  ['device errors', 'erros de dispositivo', 'errores de dispositivo', 'erreurs de périphérique', 'Gerätefehler'],
  ['unhealthy devices', 'dispositivos com problemas', 'dispositivos con problemas', 'périphériques défaillants', 'fehlerhafte Geräte'],
  ['scrub state', 'estado do scrub', 'estado del scrub', 'état du scrub', 'Scrub-Status'],
  ['scrub progress', 'progresso do scrub', 'progreso del scrub', 'progression du scrub', 'Scrub-Fortschritt'],
  ['status message', 'mensagem de estado', 'mensaje de estado', 'message d’état', 'Statusmeldung'],
  ['state', 'estado', 'estado', 'état', 'Status'],
  ['sub-state', 'subestado', 'subestado', 'sous-état', 'Unterstatus'],
  ['errors', 'erros', 'errores', 'erreurs', 'Fehler'],
  ['memory', 'memória', 'memoria', 'mémoire', 'Speicher'],
  ['network', 'rede', 'red', 'réseau', 'Netzwerk'],
  ['image', 'imagem', 'imagen', '', 'Image'],
  ['update', 'atualização', 'actualización', 'mise à jour', 'Update'],
  ['response time', 'tempo de resposta', 'tiempo de respuesta', 'temps de réponse', 'Antwortzeit'],
  ['average response (1 h)', 'resposta média (1 h)', 'respuesta media (1 h)', 'réponse moyenne (1 h)', 'durchschnittliche Antwort (1 h)'],
  ['minimum response (1 h)', 'resposta mínima (1 h)', 'respuesta mínima (1 h)', 'réponse minimale (1 h)', 'minimale Antwort (1 h)'],
  ['maximum response (1 h)', 'resposta máxima (1 h)', 'respuesta máxima (1 h)', 'réponse maximale (1 h)', 'maximale Antwort (1 h)'],
  ['packet loss (1 h)', 'perda de pacotes (1 h)', 'pérdida de paquetes (1 h)', 'perte de paquets (1 h)', 'Paketverlust (1 h)'],
  ['certificate expiry', 'validade do certificado', 'caducidad del certificado', 'expiration du certificat', 'Zertifikatsablauf'],
  ['alert', 'alerta', 'alerta', 'alerte', 'Warnung'],
].forEach(row => { METRIC_WORDS[row[0]] = row; });

// Longer subjects first ("CPU core" before "CPU").
const METRIC_SUBJECTS = [
  'ZFS dataset', 'ZFS pool', 'Filesystem', 'Drive', 'Container', 'Service', 'Monitor',
  'CPU core', 'Temperature', 'Fan', 'Battery', 'Wi-Fi', 'GPU', 'Disk', 'CPU',
];
// "<subject> <name>" with no reading after it.
const METRIC_BARE_SUBJECTS = ['CPU core', 'Temperature', 'Fan', 'Battery'];
// Readings that follow a bare name, with no subject ("eth0 sent speed").
const METRIC_LOOSE_READINGS = ['sent speed', 'received speed', 'sent total', 'received total'];
const METRIC_WHOLE_NAMES = [
  'Hostname', 'Operating system', 'CPU model', 'Architecture', 'Cores', 'CPU sockets',
  'Agent connection', 'Package updates', 'Security updates', 'Drives failing SMART',
  'Containers running', 'Containers unhealthy', 'Container updates', 'Active alerts',
  'Memory', 'Status',
];
// Longest first, so "read total" wins over "total".
const METRIC_READINGS = Object.keys(METRIC_WORDS)
  .filter(word => !METRIC_SUBJECTS.includes(word) && !METRIC_WHOLE_NAMES.includes(word))
  .sort((left, right) => right.length - left.length)
  .concat(['CPU']); // "Container nginx CPU": a subject elsewhere, a reading here

export function translateMetricName(language, name) {
  const text = String(name == null ? '' : name);
  const index = LANGUAGES.indexOf(language);
  if (index < 1 || !text) return text;
  const word = english => pick(METRIC_WORDS, english, index) || english;
  if (Object.prototype.hasOwnProperty.call(METRIC_KEYS, text)) return translate(language, METRIC_KEYS[text]);
  if (METRIC_WHOLE_NAMES.includes(text)) return word(text);
  // "<Beszel alert name> alert": Disk, Temperature… are words here too.
  if (text.slice(-6) === ' alert') return `${word(text.slice(0, -6))} – ${word('alert')}`;
  const subject = METRIC_SUBJECTS.find(item => text.indexOf(`${item} `) === 0);
  const rest = subject ? text.slice(subject.length + 1) : text;
  if (subject && METRIC_BARE_SUBJECTS.includes(subject)) return `${word(subject)} ${rest}`;
  const reading = METRIC_READINGS.find(item => rest === item || rest.slice(-item.length - 1) === ` ${item}`);
  if (!reading || (!subject && !METRIC_LOOSE_READINGS.includes(reading))) return text;
  const middle = rest.slice(0, Math.max(0, rest.length - reading.length - 1));
  const head = [subject ? word(subject) : '', middle].filter(Boolean).join(' ');
  return head ? `${head} – ${word(reading)}` : word(reading);
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

// Decimals for a reading: the display precision set in the sensor's settings
// (hass.entities[id].display_precision) wins over the card's own rounding.
export function digitsFor(precision, fallback) {
  return Number.isInteger(precision) && precision >= 0 ? Math.min(precision, 6) : fallback;
}

// Beszel style: 16.1 / 0.49 / 1.78
export function formatPercentValue(value, precision) {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(digitsFor(precision, Math.abs(value) >= 10 ? 1 : 2));
}

export function formatPercent(value, precision) {
  const text = formatPercentValue(value, precision);
  return text ? `${text}%` : '';
}

export function formatNumber(value) {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(Math.abs(value) >= 10 ? 1 : 2);
}

export function formatSize(reading) {
  if (!reading || !Number.isFinite(reading.value)) return '';
  return `${sizeValue(reading)}${reading.unit ? ` ${reading.unit}` : ''}`;
}

function sizeValue(reading) {
  return reading.value.toFixed(digitsFor(reading.precision, 1));
}

// "8.1 / 15.6 GiB" when both sides share a unit.
export function formatUsedTotal(used, total) {
  if (!used || !total) return used ? formatSize(used) : '';
  if (used.unit !== total.unit) return `${formatSize(used)} / ${formatSize(total)}`;
  return `${sizeValue(used)} / ${sizeValue(total)}${total.unit ? ` ${total.unit}` : ''}`;
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

// `precision` is the entity's display precision, when one is set.
export function formatRate(bytesPerSecond, precision) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return '';
  const units = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s', 'TiB/s'];
  let value = bytesPerSecond;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = digitsFor(precision, index === 0 || value >= 100 ? 0 : 2);
  return `${value.toFixed(digits)} ${units[index]}`;
}

// A unit picked in the entity's settings is kept as chosen. Only the
// integration's own B/s and B are auto-scaled the way Beszel shows them
// (the frontend registry does not say whether the unit was picked).
function chosenValue(value, precision) {
  return value.toFixed(digitsFor(precision, 2));
}

function rateUnit(stateObj) {
  return String(pick(stateObj, 'attributes', 'unit_of_measurement') || 'B/s');
}

function nativeRate(stateObj) {
  return rateUnit(stateObj).toLowerCase() === 'b/s';
}

// Data-rate entity as text: "129 KiB/s" for native B/s, "0.16 MB/s" when the
// user selected MB/s. `precision` is the entity's display precision, if any.
export function formatRateState(stateObj, precision) {
  const bytes = rateBytes(stateObj);
  if (!Number.isFinite(bytes)) return '';
  if (nativeRate(stateObj)) return formatRate(bytes, precision);
  return `${chosenValue(readingNumber(stateObj.state), precision)} ${rateUnit(stateObj)}`;
}

// Sum of two data-rate entities, in their unit when both share a chosen one.
export function formatRateTotal(first, second, precision) {
  const states = [first, second].filter(state => Number.isFinite(rateBytes(state)));
  if (!states.length) return '';
  const unit = rateUnit(states[0]);
  if (!nativeRate(states[0]) && states.every(state => rateUnit(state) === unit)) {
    const sum = states.reduce((total, state) => total + readingNumber(state.state), 0);
    return `${chosenValue(sum, precision)} ${unit}`;
  }
  return formatRate(states.reduce((total, state) => total + rateBytes(state), 0), precision);
}

export function formatBytes(bytes, precision) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(digitsFor(precision, index === 0 || value >= 100 ? 0 : 2))} ${units[index]}`;
}

// Value and unit of any numeric entity for extra rows / columns.
export function entityReading(stateObj, precision) {
  const n = Number(pick(stateObj, 'state'));
  if (!validReading(pick(stateObj, 'state')) || !Number.isFinite(n)) return null;
  const unit = String(pick(stateObj, 'attributes', 'unit_of_measurement') || '');
  const scaled = unit === 'B/s' ? formatRate(n, precision) : unit === 'B' ? formatBytes(n, precision) : '';
  if (scaled) {
    const parts = scaled.split(' ');
    return { value: parts[0], unit: parts[1] };
  }
  if (digitsFor(precision, -1) >= 0) return { value: chosenValue(n, precision), unit };
  return { value: /B(\/s)?$/.test(unit) ? n.toFixed(unit.indexOf('/s') > 0 ? 2 : 1) : formatNumber(n), unit };
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
export function formatUptimeLong(seconds, language) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${days} ${translate(language, days === 1 ? 'day' : 'days')}`;
  return formatUptimeShort(seconds);
}

// Temperature in the entity's own unit; thresholds use Celsius.
export function temperatureReading(stateObj, precision) {
  const value = readingNumber(pick(stateObj, 'state'));
  if (!Number.isFinite(value)) return null;
  const unit = pick(stateObj, 'attributes', 'unit_of_measurement') || '°C';
  const celsius = /f/i.test(unit) ? (value - 32) * 5 / 9 : unit === 'K' ? value - 273.15 : value;
  if (celsius < -273.15 || celsius > 200) return null;
  const number = value.toFixed(digitsFor(precision, 1));
  return { value, number, unit, celsius, text: `${number} ${unit}` };
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
  const precision = key => pick(hass, 'entities', entities[key], 'display_precision');
  const nonNegative = key => { const n = num(key); return n >= 0 ? n : NaN; };
  const percent = key => { const n = num(key); return n >= 0 && n <= 100 ? n : NaN; };
  const size = key => {
    const state = stateOf(key);
    const n = readingNumber(pick(state, 'state'));
    return n >= 0 ? { value: n, unit: pick(state.attributes, 'unit_of_measurement') || '', precision: precision(key) } : null;
  };
  const rxState = stateOf('network_received_speed');
  const txState = stateOf('network_sent_speed');
  const netPrecision = [precision('network_received_speed'), precision('network_sent_speed')]
    .filter(Number.isInteger).sort().pop();
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
    rx: rateBytes(rxState),
    tx: rateBytes(txState),
    rxText: formatRateState(rxState, precision('network_received_speed')),
    txText: formatRateState(txState, precision('network_sent_speed')),
    netText: formatRateTotal(rxState, txState, netPrecision),
    temperature: temperatureReading(stateOf('cpu_temperature'), precision('cpu_temperature')),
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
    // Display precision per reading, undefined when the sensor has none.
    digits: {
      cpu: precision('cpu_usage'),
      memory: precision('memory_usage'),
      disk: precision('disk_usage'),
      gpu: precision('gpu_usage'),
      battery: precision('battery'),
      loads: ['load_1m', 'load_5m', 'load_15m'].map(precision),
    },
  };
}

export function networkTotal(model) {
  const parts = [model.rx, model.tx].filter(Number.isFinite);
  return parts.length ? parts.reduce((sum, value) => sum + value, 0) : NaN;
}

export function formatLoads(loads, digits = [], separator = ' ', missing = '–') {
  return (loads || []).some(Number.isFinite)
    ? loads.map((value, index) => (Number.isFinite(value) ? value.toFixed(digitsFor(digits[index], 2)) : missing)).join(separator)
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

function labelHtml(label) {
  const text = escapeHtml(label);
  return `<span class="bz-label" title="${text}">${text}:</span>`;
}

export function renderDetailRows(model, options = {}) {
  const limits = options.limits || DEFAULT_THRESHOLDS;
  const t = key => translate(options.language, key);
  const rows = [];
  const row = (key, valueHtml, meter, label = t(key)) => {
    if (!valueHtml && !options.showEmpty) return;
    // Meter rows stack the value above its bar in one cell, so the label
    // lines up with the pair instead of a value squeezed beside a bar.
    // `hideBars` leaves the value alone, like any other row.
    const value = meter && valueHtml && !options.hideBars
      ?`<span class="bz-cell"><span class="bz-value">${valueHtml}</span>${meterHtml(meter.percent, meter.level)}</span>`
      : `<span class="bz-value bz-wide">${valueHtml}</span>`;
    rows.push(`<div class="bz-row" data-row="${escapeHtml(key)}"><ha-icon class="bz-icon" icon="${ROW_ICONS[key] || ROW_ICONS.extra}"></ha-icon>${labelHtml(label)}${value}</div>`);
  };
  const digits = model.digits || {};
  const percentRow = (key, value, level) =>
    row(key, escapeHtml(formatPercent(value, digits[key])), { percent: value, level });

  percentRow('cpu', model.cpu, meterLevel(model.cpu, limits));
  percentRow('memory', model.memory, meterLevel(model.memory, limits));
  percentRow('disk', model.disk, meterLevel(model.disk, limits));
  percentRow('gpu', model.gpu, meterLevel(model.gpu, limits));

  const loads = formatLoads(model.loads, digits.loads);
  row('load', loads
    ? `<span class="bz-dot bz-${loadLevel(model.loads, model.threads, limits)}"></span>${escapeHtml(loads)}`
    : '');

  const rx = model.rxText;
  const tx = model.txText;
  const split = [rx && `↓ ${rx}`, tx && `↑ ${tx}`].filter(Boolean).join('  ');
  // Split network: ↓ and ↑ each on their own line, never broken mid-value.
  const network = options.splitNetwork
    ? [rx && `↓ ${rx}`, tx && `↑ ${tx}`].filter(Boolean).map(part => `<span class="bz-line">${escapeHtml(part)}</span>`).join('')
    : (rx || tx ? `<span title="${escapeHtml(split)}">${escapeHtml(model.netText)}</span>` : '');
  row('network', network);

  row('temperature', model.temperature ? escapeHtml(model.temperature.text) : '');
  percentRow('battery', model.battery, batteryLevel(model.battery));

  row('services', Number.isFinite(model.servicesTotal)
    ? `<span class="bz-dot bz-${model.servicesFailed > 0 ? 'crit' : 'ok'}"></span>${escapeHtml(formatNumber(model.servicesTotal))}${Number.isFinite(model.servicesFailed) ? ` <span class="bz-muted">(${escapeHtml(t('failed'))}: ${escapeHtml(formatNumber(model.servicesFailed))})</span>` : ''}`
    : '');
  row('uptime', escapeHtml(formatUptimeLong(model.uptime, options.language)));
  row('agent', model.agent
    ? `<ha-icon class="bz-agent-icon" icon="mdi:tag-outline"></ha-icon>${escapeHtml(model.agent)}`
    : '');

  for (const extra of options.extras || []) {
    if (!extra.value && !options.showEmpty) continue;
    rows.push(`<div class="bz-row bz-extra"><ha-icon class="bz-icon" icon="${ROW_ICONS.extra}"></ha-icon>${labelHtml(extra.label)}<span class="bz-value bz-wide">${escapeHtml(extra.value)}${extra.value && extra.unit ? ` <span class="bz-muted">${escapeHtml(extra.unit)}</span>` : ''}</span></div>`);
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
    grid-template-columns: 18px minmax(96px, 136px) minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    min-height: 20px;
    font-size: 13px;
  }
  .bz-icon { --mdc-icon-size: 16px; color: var(--secondary-text-color); }
  .bz-label { min-width: 0; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bz-value { color: var(--primary-text-color); font-weight: 500; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .bz-wide { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
  .bz-line { display: block; white-space: nowrap; }
  .bz-cell { display: block; min-width: 0; }
  .bz-cell .bz-value { display: block; line-height: 16px; }
  .bz-meter { display: block; height: 8px; min-width: 40px; margin-top: 4px; border-radius: 4px; overflow: hidden; background: var(--bz-track); }
  .bz-fill { display: block; height: 100%; border-radius: inherit; transition: width .6s ease; }
  .bz-agent-icon { --mdc-icon-size: 14px; color: var(--bz-ok); margin-right: 4px; vertical-align: -2px; }
  /* Narrow cards: label on its own line, value (and bar) below it, indented
     past the icon so it lines up with the label. */
  @container (max-width: 350px) {
    .bz-row { grid-template-columns: 16px minmax(0, 1fr); row-gap: 3px; }
    .bz-label { white-space: normal; overflow-wrap: anywhere; }
    .bz-wide, .bz-cell { grid-column: 2 / -1; }
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
