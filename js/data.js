/* =====================================================================
 * Datenhaltung – Gerätefuhrpark Pathologisches Institut
 * Prototyp: Speicherung im localStorage des Browsers.
 * Für den Team-Einsatz über mehrere Rechner wird ein Backend benötigt
 * (siehe README) – die Datenstruktur hier ist dafür bereits vorbereitet.
 *
 * © Dietz-Engineering · Alle Rechte vorbehalten
 * Designed by Dietz-Engineering · Initiiert von Christoph Lüttgens
 * ===================================================================== */

const STORAGE_KEY = 'geraetefuhrpark_v1';
const SESSION_KEY = 'geraetefuhrpark_user';

/** Ab so vielen Tagen vor Fälligkeit gilt eine Wartung als "bald fällig" (gelb). */
const WARTUNG_VORLAUF_TAGE = 30;
/** Ab so vielen Tagen Defektdauer erscheint eine Benachrichtigung. */
const DEFEKT_ALARM_TAGE = 7;

/* ---------- Datums-Helfer ---------- */

function heute() { return new Date(); }

function isoDatum(d) { return d.toISOString().slice(0, 10); }

function tageVor(n) { const d = heute(); d.setDate(d.getDate() - n); return isoDatum(d); }

function monateVor(n) { const d = heute(); d.setMonth(d.getMonth() - n); return isoDatum(d); }

/** ISO-Datum (JJJJ-MM-TT) -> TT.MM.JJJJ */
function formatDatum(iso) {
  if (!iso) return '–';
  const [j, m, t] = iso.split('-');
  return `${t}.${m}.${j}`;
}

/** Zeitstempel -> TT.MM.JJJJ HH:MM */
function formatZeit(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Differenz in ganzen Tagen zwischen zwei Zeitpunkten (b - a). */
function tageDiff(a, b) {
  return Math.floor((new Date(b) - new Date(a)) / 86400000);
}

/** n Monate zu einem ISO-Datum addieren. */
function addMonate(iso, n) {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + n);
  return isoDatum(d);
}

/* ---------- Geräte-Logik ---------- */

/** Nächste Wartungsfälligkeit eines Geräts (ISO-Datum) oder null. */
function naechsteWartung(g) {
  if (!g.lastMaintenance || !g.maintenanceInterval) return null;
  return addMonate(g.lastMaintenance, g.maintenanceInterval);
}

/** Tage bis zur nächsten Wartung (negativ = überfällig) oder null. */
function wartungTageVerbleibend(g) {
  const nw = naechsteWartung(g);
  if (!nw) return null;
  return tageDiff(isoDatum(heute()), nw);
}

/**
 * Effektiver Anzeige-Status (Ampel):
 * 'defekt' (rot) | 'ausser_betrieb' (grau) | 'wartung' (gelb) | 'ok' (grün)
 */
function effektiverStatus(g) {
  if (g.status === 'defekt') return 'defekt';
  if (g.status === 'ausser_betrieb') return 'ausser_betrieb';
  const t = wartungTageVerbleibend(g);
  if (t !== null && t <= WARTUNG_VORLAUF_TAGE) return 'wartung';
  return 'ok';
}

/** Dauer des aktuellen Defekts in Tagen oder null. */
function defektTage(g) {
  if (g.status !== 'defekt' || !g.defectSince) return null;
  return tageDiff(g.defectSince, Date.now());
}

/**
 * Alle Defekt-Ereignisse eines Geräts, inkl. eines evtl. offenen Defekts.
 * -> [{ start, end|null, dauerTage }]
 */
function defektEreignisse(g) {
  const events = (g.defectHistory || []).map((e) => ({
    start: e.start, end: e.end, dauerTage: Math.max(0, tageDiff(e.start, e.end)),
  }));
  if (g.status === 'defekt' && g.defectSince) {
    events.push({ start: g.defectSince, end: null, dauerTage: Math.max(0, tageDiff(g.defectSince, Date.now())) });
  }
  return events;
}

/* ---------- Speicher ---------- */

/** Später ergänzte Felder in bereits gespeicherten Datenbeständen nachrüsten. */
const NEUE_FELDER = ['room', 'team', 'salesName', 'salesPhone', 'salesEmail', 'networkAddress'];

function migriereDaten(daten) {
  const seed = new Map(erzeugeDemoDaten().map((g) => [g.id, g]));
  for (const g of daten.devices) {
    const s = seed.get(g.id);
    for (const feld of NEUE_FELDER) {
      if (g[feld] === undefined) g[feld] = s ? (s[feld] ?? '') : '';
    }
    if (!g.custom) g.custom = {};
  }
  // Eigene (vom Admin definierte) Felder
  if (!daten.customFields) daten.customFields = [];
  if (!daten.nextFieldId) daten.nextFieldId = 1;
}

function ladeDaten() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const daten = JSON.parse(raw);
      migriereDaten(daten);
      return daten;
    }
  } catch (e) { /* beschädigte Daten -> neu initialisieren */ }
  const daten = { devices: erzeugeDemoDaten(), nextId: 100, customFields: [], nextFieldId: 1 };
  migriereDaten(daten);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(daten));
  return daten;
}

function speichereDaten(daten) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(daten));
  if (cloudAktiv()) cloudSpeichern(daten).catch((e) => console.warn('Cloud-Sync:', e.message));
}

/* ---------- Cloud-Synchronisation (optional, Supabase) ---------- */

/** true, sobald in js/config.js Supabase-Zugangsdaten eingetragen sind. */
function cloudAktiv() {
  return typeof SUPABASE_URL !== 'undefined' && !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

function cloudHeaders() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };
}

/** updated_at des zuletzt bekannten Cloud-Stands (Erkennung fremder Änderungen). */
let cloudStand = null;

/** Gemeinsamen Datenbestand aus der Cloud holen -> { daten, updated_at } oder null. */
async function cloudLaden() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/fuhrpark_state?id=eq.1&select=daten,updated_at`, {
    headers: cloudHeaders(),
  });
  if (!res.ok) throw new Error(`Cloud-Abruf fehlgeschlagen (HTTP ${res.status})`);
  return (await res.json())[0] || null;
}

/** Kompletten Datenbestand in die Cloud schreiben (upsert, last-write-wins). */
async function cloudSpeichern(d) {
  const stand = new Date().toISOString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/fuhrpark_state`, {
    method: 'POST',
    headers: { ...cloudHeaders(), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id: 1, daten: d, updated_at: stand }),
  });
  if (!res.ok) throw new Error(`Cloud-Speichern fehlgeschlagen (HTTP ${res.status})`);
  cloudStand = stand;
}

/* ---------- Demo-Daten ---------- */

function sysLog(tsIso, text) {
  return { ts: new Date(tsIso + 'T09:00:00').getTime(), author: 'System', type: 'system', text };
}

function erzeugeDemoDaten() {
  // Pro Lieferant: technischer Service (Hotline) und Vertrieb/Außendienst getrennt
  const leica = {
    distributor: 'Leica Biosystems Service', distContact: 'Hr. Weber', distPhone: '+49 6441 123-456', distEmail: 'service@leica-demo.de',
    salesName: 'Fr. Sommer', salesPhone: '+49 171 555-201', salesEmail: 'vertrieb@leica-demo.de',
  };
  const sakura = {
    distributor: 'Sakura Finetek Germany', distContact: 'Fr. Krüger', distPhone: '+49 6023 987-654', distEmail: 'support@sakura-demo.de',
    salesName: 'Hr. Brenner', salesPhone: '+49 160 555-322', salesEmail: 'sales@sakura-demo.de',
  };
  const roche = {
    distributor: 'Roche Diagnostics Service', distContact: 'Hr. Yilmaz', distPhone: '+49 621 555-100', distEmail: 'ticket@roche-demo.de',
    salesName: 'Fr. Dietrich', salesPhone: '+49 172 555-410', salesEmail: 'vertrieb@roche-demo.de',
  };
  const thermo = {
    distributor: 'Thermo Fisher Service', distContact: 'Fr. Lorenz', distPhone: '+49 800 246-800', distEmail: 'service.de@thermo-demo.de',
    salesName: 'Hr. Kaminski', salesPhone: '+49 151 555-118', salesEmail: 'sales.de@thermo-demo.de',
  };
  const zeiss = {
    distributor: 'Zeiss Mikroskopie Service', distContact: 'Hr. Brandt', distPhone: '+49 7364 20-0', distEmail: 'mikroskopie@zeiss-demo.de',
    salesName: 'Fr. Neuhaus', salesPhone: '+49 170 555-733', salesEmail: 'vertrieb@zeiss-demo.de',
  };
  const labnord = {
    distributor: 'Labortechnik Nord GmbH', distContact: 'Fr. Petersen', distPhone: '+49 40 3344-556', distEmail: 'info@labnord-demo.de',
    salesName: 'Hr. Petersen', salesPhone: '+49 40 3344-557', salesEmail: 'vertrieb@labnord-demo.de',
  };

  return [
    {
      id: 1, name: 'Rotationsmikrotom 1', category: 'Mikrotom', manufacturer: 'Leica',
      model: 'RM2255', serial: 'LM-88341', inventoryNo: 'PATH-0001',
      location: 'Hauptstandort Klinikum', department: 'Histologie',
      room: 'EG 012', team: 'Team Zuschnitt & Schnitt', ...leica,
      purchaseDate: monateVor(50), warrantyEnd: monateVor(26),
      maintenanceInterval: 12, lastMaintenance: monateVor(8),
      status: 'ok', defectSince: null,
      defectHistory: [{ start: monateVor(14), end: tageVor(Math.round(14 * 30.4) - 2) }],
      log: [sysLog(monateVor(8), 'Wartung durchgeführt.')],
    },
    {
      id: 2, name: 'Färbeautomat H&E', category: 'Färbeautomat', manufacturer: 'Sakura',
      model: 'Tissue-Tek Prisma Plus', serial: 'SK-20419', inventoryNo: 'PATH-0002',
      networkAddress: '10.12.4.21',
      location: 'Hauptstandort Klinikum', department: 'Histologie',
      room: 'EG 014', team: 'Team Färbung', ...sakura,
      purchaseDate: monateVor(30), warrantyEnd: monateVor(6),
      maintenanceInterval: 6, lastMaintenance: tageVor(170),
      status: 'ok', defectSince: null,
      defectHistory: [],
      log: [sysLog(tageVor(170), 'Wartung durchgeführt.')],
    },
    {
      id: 3, name: 'Eindeckautomat 1', category: 'Eindeckautomat', manufacturer: 'Leica',
      model: 'CV5030', serial: 'LM-51102', inventoryNo: 'PATH-0003',
      networkAddress: '10.12.4.22',
      location: 'Hauptstandort Klinikum', department: 'Histologie',
      room: 'EG 014', team: 'Team Färbung', ...leica,
      purchaseDate: monateVor(64), warrantyEnd: monateVor(40),
      maintenanceInterval: 12, lastMaintenance: monateVor(5),
      status: 'defekt', defectSince: tageVor(3),
      defectHistory: [
        { start: monateVor(10), end: tageVor(Math.round(10 * 30.4) - 4) },
        { start: monateVor(4), end: tageVor(Math.round(4 * 30.4) - 6) },
      ],
      log: [
        sysLog(tageVor(3), 'Status geändert: Funktionsfähig → Defekt. Grund: Eindeckmedium wird nicht mehr dosiert.'),
        { ts: new Date().setHours(new Date().getHours() - 20), author: 'M. Schneider', type: 'user', text: 'Techniker kontaktiert, kommt innerhalb 24 h.' },
      ],
    },
    {
      id: 4, name: 'Einbettautomat', category: 'Gewebeeinbettautomat', manufacturer: 'Leica',
      model: 'ASP300 S', serial: 'LM-33871', inventoryNo: 'PATH-0004',
      location: 'Hauptstandort Klinikum', department: 'Histologie',
      room: 'EG 010', team: 'Team Einbettung', ...leica,
      purchaseDate: monateVor(20), warrantyEnd: addMonate(monateVor(20), 24),
      maintenanceInterval: 12, lastMaintenance: monateVor(4),
      status: 'ok', defectSince: null, defectHistory: [], log: [],
    },
    {
      id: 5, name: 'Immunfärbeautomat', category: 'Immunfärbeautomat', manufacturer: 'Roche (Ventana)',
      model: 'BenchMark ULTRA', serial: 'VN-77210', inventoryNo: 'PATH-0005',
      networkAddress: '10.12.4.30',
      location: 'Hauptstandort Klinikum', department: 'Immunhistochemie',
      room: 'OG1 105', team: 'Team IHC', ...roche,
      purchaseDate: monateVor(44), warrantyEnd: monateVor(20),
      maintenanceInterval: 6, lastMaintenance: monateVor(7),
      status: 'ok', defectSince: null,
      defectHistory: [{ start: monateVor(9), end: tageVor(Math.round(9 * 30.4) - 5) }],
      log: [sysLog(monateVor(7), 'Wartung durchgeführt.')],
    },
    {
      id: 6, name: 'Kryostat Schnellschnitt', category: 'Kryostat', manufacturer: 'Leica',
      model: 'CM1950', serial: 'LM-90455', inventoryNo: 'PATH-0006',
      location: 'Hauptstandort Klinikum', department: 'Schnellschnitt-Labor',
      room: 'EG 003 (OP-Nähe)', team: 'Team Schnellschnitt', ...leica,
      purchaseDate: monateVor(38), warrantyEnd: monateVor(14),
      maintenanceInterval: 12, lastMaintenance: monateVor(9),
      status: 'ok', defectSince: null,
      defectHistory: [{ start: monateVor(6), end: tageVor(Math.round(6 * 30.4) - 1) }],
      log: [],
    },
    {
      id: 7, name: 'Laborkühlschrank Archiv', category: 'Laborkühlschrank', manufacturer: 'Liebherr',
      model: 'LKUv 1613', serial: 'LB-40021', inventoryNo: 'PATH-0007',
      location: 'Hauptstandort Klinikum', department: 'Probenarchiv',
      room: 'UG 021', team: 'Team Archiv', ...labnord,
      purchaseDate: monateVor(70), warrantyEnd: monateVor(46),
      maintenanceInterval: 12, lastMaintenance: monateVor(2),
      status: 'ok', defectSince: null, defectHistory: [], log: [],
    },
    {
      id: 8, name: 'Mikroskop Befundung 1', category: 'Mikroskop', manufacturer: 'Zeiss',
      model: 'Axio Lab.A1', serial: 'ZS-11209', inventoryNo: 'PATH-0008',
      location: 'Hauptstandort Klinikum', department: 'Zytologie',
      room: 'OG1 110', team: 'Team Befundung', ...zeiss,
      purchaseDate: monateVor(55), warrantyEnd: monateVor(31),
      maintenanceInterval: 24, lastMaintenance: monateVor(13),
      status: 'ok', defectSince: null, defectHistory: [], log: [],
    },
    {
      id: 9, name: 'Zytozentrifuge', category: 'Zentrifuge', manufacturer: 'Thermo Fisher',
      model: 'Cytospin 4', serial: 'TF-60833', inventoryNo: 'PATH-0009',
      location: 'Hauptstandort Klinikum', department: 'Zytologie',
      room: 'OG1 112', team: 'Team Zytologie', ...thermo,
      purchaseDate: monateVor(48), warrantyEnd: monateVor(24),
      maintenanceInterval: 12, lastMaintenance: monateVor(6),
      status: 'defekt', defectSince: tageVor(12),
      defectHistory: [{ start: monateVor(16), end: tageVor(Math.round(16 * 30.4) - 9) }],
      log: [
        sysLog(tageVor(12), 'Status geändert: Funktionsfähig → Defekt. Grund: Rotor blockiert, Fehlercode E12.'),
        { ts: new Date(tageVor(10) + 'T11:30:00').getTime(), author: 'K. Hoffmann', type: 'user', text: 'Service-Ticket bei Thermo Fisher eröffnet (Nr. 48812).' },
        { ts: new Date(tageVor(5) + 'T08:15:00').getTime(), author: 'K. Hoffmann', type: 'user', text: 'Ersatzteil ist bestellt, Lieferzeit laut Hotline ca. 1 Woche.' },
      ],
    },
    {
      id: 10, name: 'Thermocycler PCR 1', category: 'Thermocycler', manufacturer: 'Thermo Fisher',
      model: 'ProFlex 96', serial: 'TF-91002', inventoryNo: 'PATH-0101',
      networkAddress: '10.20.1.15',
      location: 'Standort Nord', department: 'Molekularpathologie',
      room: 'Nord 2.01', team: 'Team Molekularpathologie', ...thermo,
      purchaseDate: monateVor(26), warrantyEnd: monateVor(2),
      maintenanceInterval: 12, lastMaintenance: monateVor(3),
      status: 'ok', defectSince: null, defectHistory: [], log: [],
    },
    {
      id: 11, name: 'Färbeautomat Sonderfärbung', category: 'Färbeautomat', manufacturer: 'Thermo Fisher',
      model: 'Gemini AS', serial: 'TF-33450', inventoryNo: 'PATH-0102',
      networkAddress: '10.20.1.16',
      location: 'Standort Nord', department: 'Histologie',
      room: 'Nord 1.05', team: 'Team Färbung Nord', ...thermo,
      purchaseDate: monateVor(58), warrantyEnd: monateVor(34),
      maintenanceInterval: 6, lastMaintenance: monateVor(1),
      status: 'ok', defectSince: null,
      defectHistory: [
        { start: monateVor(11), end: tageVor(Math.round(11 * 30.4) - 8) },
        { start: monateVor(7), end: tageVor(Math.round(7 * 30.4) - 12) },
        { start: monateVor(2), end: tageVor(Math.round(2 * 30.4) - 10) },
      ],
      log: [
        { ts: new Date(monateVor(2) + 'T10:00:00').getTime(), author: 'S. Albrecht', type: 'user', text: 'Schon der dritte Ausfall dieses Jahr – bitte in der Statistik im Blick behalten.' },
      ],
    },
    {
      id: 12, name: 'Ausgießstation', category: 'Paraffinausgießstation', manufacturer: 'Leica',
      model: 'EG1150 H', serial: 'LM-27764', inventoryNo: 'PATH-0103',
      location: 'Standort Nord', department: 'Histologie',
      room: 'Nord 1.03', team: 'Team Einbettung Nord', ...leica,
      purchaseDate: monateVor(34), warrantyEnd: monateVor(10),
      maintenanceInterval: 12, lastMaintenance: monateVor(11),
      status: 'ok', defectSince: null, defectHistory: [], log: [],
    },
    {
      id: 13, name: 'Mikroskop Befundung Nord', category: 'Mikroskop', manufacturer: 'Zeiss',
      model: 'Primostar 3', serial: 'ZS-55420', inventoryNo: 'PATH-0104',
      location: 'Standort Nord', department: 'Zytologie',
      room: 'Nord 2.04', team: 'Team Befundung Nord', ...zeiss,
      purchaseDate: monateVor(15), warrantyEnd: addMonate(monateVor(15), 24),
      maintenanceInterval: 24, lastMaintenance: monateVor(15),
      status: 'ausser_betrieb', defectSince: null, defectHistory: [],
      log: [sysLog(monateVor(1), 'Status geändert: Funktionsfähig → Außer Betrieb. Grund: Arbeitsplatz derzeit nicht besetzt.')],
    },
  ];
}
