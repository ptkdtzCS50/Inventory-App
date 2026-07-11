/* =====================================================================
 * Gerätefuhrpark – MCP-Server (Claude-Integration)
 *
 * Verbindet die Claude-App (claude.ai / Desktop / Mobile) mit dem
 * Gerätefuhrpark über das Model Context Protocol (Streamable HTTP).
 * Der Anwender fügt die Server-URL in Claude unter
 * Einstellungen → Connectors → "Add custom connector" hinzu und
 * arbeitet dann mit seinem normalen Claude-Konto – ohne API-Tokens.
 *
 * Läuft in zwei Umgebungen mit demselben Code:
 *   - Cloudflare Worker:  `npx wrangler deploy` (siehe wrangler.toml)
 *   - Eigener Server:     `node server.mjs` (Port 8788)
 *
 * Datenzugriff: gemeinsamer Datenbestand in Supabase (fuhrpark_state).
 * Ohne konfiguriertes Supabase läuft der Server im DEMO-Modus mit
 * Beispieldaten (nicht persistent) – zum Ausprobieren des Connectors.
 * Ist die Datenverschlüsselung der App aktiv, entschlüsselt der Server
 * mit MASTER_PASSWORT (Umgebungsvariable) – gleiche Ableitung wie die App.
 *
 * © Dietz-Engineering · Alle Rechte vorbehalten
 * Designed by Dietz-Engineering · Initiiert von Christoph Lüttgens
 * ===================================================================== */

const KRYPTO_SALT = 'geraetefuhrpark-dietz-engineering-v1';
const KRYPTO_ITERATIONEN = 210000;
const AUTOR = 'Claude (KI-Assistent)';

/* ---------------- Demo-Datenbestand (Fallback ohne Supabase) ---------------- */

let demoBestand = null;
function demoDaten() {
  if (demoBestand) return demoBestand;
  const heute = new Date();
  const vorMonaten = (n) => { const d = new Date(heute); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); };
  demoBestand = {
    devices: [
      { id: 1, name: 'Rotationsmikrotom 1', category: 'Mikrotom', manufacturer: 'Leica', model: 'RM2255', serial: 'LM-88341', inventoryNo: 'PATH-0001', location: 'Hauptstandort Klinikum', department: 'Histologie', room: 'EG 012', team: 'Team Zuschnitt', distributor: 'Leica Biosystems Service', distPhone: '+49 6441 123-456', distEmail: 'service@leica-demo.de', purchaseDate: vorMonaten(50), status: 'ok', defectSince: null, defectHistory: [], pruefungen: [{ art: 'Wartung', intervall: 12, letzte: vorMonaten(8) }], dokumente: [], belegungen: [], log: [], custom: {} },
      { id: 2, name: 'Färbeautomat H&E', category: 'Färbeautomat', manufacturer: 'Sakura', model: 'Tissue-Tek Prisma Plus', serial: 'SK-20419', inventoryNo: 'PATH-0002', location: 'Hauptstandort Klinikum', department: 'Histologie', room: 'EG 014', team: 'Team Färbung', distributor: 'Sakura Finetek Germany', distPhone: '+49 6023 987-654', distEmail: 'support@sakura-demo.de', purchaseDate: vorMonaten(30), status: 'ok', defectSince: null, defectHistory: [], pruefungen: [{ art: 'Wartung', intervall: 6, letzte: vorMonaten(5) }, { art: 'STK', intervall: 24, letzte: vorMonaten(20) }], dokumente: [], belegungen: [], log: [], custom: {} },
      { id: 3, name: 'Zytozentrifuge', category: 'Zentrifuge', manufacturer: 'Thermo Fisher', model: 'Cytospin 4', serial: '', inventoryNo: 'PATH-0009', location: 'Hauptstandort Klinikum', department: 'Zytologie', room: '', team: 'Team Zytologie', distributor: 'Thermo Fisher Service', distPhone: '+49 800 246-800', distEmail: 'service.de@thermo-demo.de', purchaseDate: null, status: 'defekt', defectSince: vorMonaten(0), defectHistory: [], pruefungen: [], dokumente: [], belegungen: [], log: [], custom: {} },
    ],
    nextId: 100, customFields: [], nextFieldId: 1,
  };
  return demoBestand;
}

/* ---------------- Verschlüsselung (kompatibel zur App) ---------------- */

async function leiteSchluesselAb(passwort) {
  const basis = await crypto.subtle.importKey('raw', new TextEncoder().encode(passwort), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode(KRYPTO_SALT), iterations: KRYPTO_ITERATIONEN, hash: 'SHA-256' },
    basis, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function entschluessle(paket, key) {
  const b = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const klartext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(paket.iv) }, key, b(paket.chiffre));
  return JSON.parse(new TextDecoder().decode(klartext));
}

async function verschluessle(obj, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chiffre = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 'enc1', iv: btoa(String.fromCharCode(...iv)), chiffre: btoa(String.fromCharCode(...new Uint8Array(chiffre))) };
}

/* ---------------- Datenzugriff (Supabase oder Demo) ---------------- */

function supabaseKonfiguriert(env) {
  return !!(env.SUPABASE_URL && env.SUPABASE_KEY);
}

async function datenLaden(env) {
  if (!supabaseKonfiguriert(env)) return { daten: demoDaten(), demo: true, verschluesselt: false };
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/fuhrpark_state?id=eq.1&select=daten,updated_at`, {
    headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase-Abruf fehlgeschlagen (HTTP ${res.status})`);
  const zeile = (await res.json())[0];
  if (!zeile) throw new Error('Noch kein Datenbestand in Supabase – bitte die App einmal mit Cloud-Sync starten.');
  let daten = zeile.daten;
  let verschluesselt = false;
  if (daten && daten.v === 'enc1') {
    if (!env.MASTER_PASSWORT) throw new Error('Datenbestand ist verschlüsselt – MASTER_PASSWORT als Umgebungsvariable setzen.');
    daten = await entschluessle(daten, await leiteSchluesselAb(env.MASTER_PASSWORT));
    verschluesselt = true;
  }
  return { daten, demo: false, verschluesselt };
}

async function datenSpeichern(env, daten, verschluesselt) {
  if (!supabaseKonfiguriert(env)) { demoBestand = daten; return; }
  let payload = daten;
  if (verschluesselt) payload = await verschluessle(daten, await leiteSchluesselAb(env.MASTER_PASSWORT));
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/fuhrpark_state`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ id: 1, daten: payload, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Supabase-Speichern fehlgeschlagen (HTTP ${res.status})`);
}

/* ---------------- Fachlogik ---------------- */

const iso = () => new Date().toISOString().slice(0, 10);
const tageDiff = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);
function addMonate(isoDatum, n) { const d = new Date(isoDatum); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); }

function faelligkeiten(g) {
  return (g.pruefungen || [])
    .filter((p) => p.letzte && p.intervall)
    .map((p) => { const datum = addMonate(p.letzte, p.intervall); return { art: p.art, datum, tage: tageDiff(iso(), datum) }; })
    .sort((a, b) => a.tage - b.tage);
}

function statusVon(g) {
  if (g.status === 'defekt') return 'defekt';
  if (g.status === 'ausser_betrieb') return 'außer Betrieb';
  const f = faelligkeiten(g)[0];
  if (f && f.tage <= 30) return `Prüfung fällig (${f.art} ${f.datum})`;
  return 'funktionsfähig';
}

function kurzzeile(g) {
  const f = faelligkeiten(g)[0];
  return `#${g.id} ${g.name} · ${g.manufacturer} ${g.model || ''} · ${g.location}/${g.department} · Status: ${statusVon(g)}`
    + (f ? ` · nächste Prüfung: ${f.art} am ${f.datum} (in ${f.tage} Tagen)` : '');
}

function systemLog(g, text) {
  g.log = g.log || [];
  g.log.push({ ts: Date.now(), author: AUTOR, type: 'system', text });
}

const PFLICHTFELDER = [
  ['serial', 'Seriennummer'], ['inventoryNo', 'Inventarnummer'], ['purchaseDate', 'Anschaffungsdatum'],
  ['room', 'Raum'], ['team', 'Team'], ['distributor', 'Distributor'], ['distEmail', 'Service-E-Mail'],
  ['distPhone', 'Service-Telefon'], ['networkAddress', 'Netzwerkadresse'],
];

/* ---------------- MCP-Tools ---------------- */

const TOOLS = [
  {
    name: 'geraete_suchen',
    description: 'Geräte im Fuhrpark suchen/auflisten. Filter: Freitext (Name/Modell/Seriennummer), Standort, Abteilung, Status (ok|defekt|ausser_betrieb).',
    inputSchema: { type: 'object', properties: {
      suche: { type: 'string', description: 'Freitextsuche' },
      standort: { type: 'string' }, abteilung: { type: 'string' },
      status: { type: 'string', enum: ['ok', 'defekt', 'ausser_betrieb'] },
    } },
    async ausfuehren(args, { daten }) {
      let liste = daten.devices;
      const s = (args.suche || '').toLowerCase();
      if (s) liste = liste.filter((g) => [g.name, g.model, g.serial, g.inventoryNo, g.manufacturer, g.category].some((f) => (f || '').toLowerCase().includes(s)));
      if (args.standort) liste = liste.filter((g) => g.location === args.standort);
      if (args.abteilung) liste = liste.filter((g) => g.department === args.abteilung);
      if (args.status) liste = liste.filter((g) => g.status === args.status);
      if (!liste.length) return 'Keine Geräte gefunden.';
      return `${liste.length} Gerät(e):\n` + liste.map(kurzzeile).join('\n');
    },
  },
  {
    name: 'geraet_details',
    description: 'Alle Details eines Geräts (Stammdaten, Prüfungen, Defekthistorie, letzte Verlaufseinträge).',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    async ausfuehren(args, { daten }) {
      const g = daten.devices.find((x) => x.id === args.id);
      if (!g) return `Gerät #${args.id} nicht gefunden.`;
      const log = (g.log || []).slice(-5).map((e) => `  ${new Date(e.ts).toISOString().slice(0, 10)} ${e.author}: ${e.text}`).join('\n');
      return JSON.stringify({
        id: g.id, name: g.name, kategorie: g.category, hersteller: g.manufacturer, modell: g.model,
        seriennummer: g.serial, inventarnummer: g.inventoryNo, standort: g.location, abteilung: g.department,
        raum: g.room, team: g.team, status: statusVon(g), defektSeit: g.defectSince,
        anschaffung: g.purchaseDate, garantieBis: g.warrantyEnd,
        distributor: { name: g.distributor, service: g.distPhone, email: g.distEmail, vertrieb: g.salesName },
        pruefungen: (g.pruefungen || []).map((p) => ({ art: p.art, intervallMonate: p.intervall, zuletzt: p.letzte, naechste: p.letzte && p.intervall ? addMonate(p.letzte, p.intervall) : null })),
        defekteBisher: (g.defectHistory || []).length + (g.status === 'defekt' ? 1 : 0),
        reparaturkostenChf: (g.defectHistory || []).reduce((s, e) => s + (e.kosten || 0), 0),
      }, null, 2) + (log ? `\n\nLetzte Verlaufseinträge:\n${log}` : '');
    },
  },
  {
    name: 'fehlende_daten_finden',
    description: 'Findet Geräte mit unvollständigen Stammdaten (fehlende Seriennummer, Inventarnummer, Anschaffungsdatum, Raum, Team, Servicekontakt, Prüfzyklen …) – ideal für Datenpflege.',
    inputSchema: { type: 'object', properties: {} },
    async ausfuehren(_args, { daten }) {
      const befunde = [];
      for (const g of daten.devices) {
        const fehlt = PFLICHTFELDER.filter(([k]) => !g[k]).map(([, label]) => label);
        if (!(g.pruefungen || []).length) fehlt.push('Prüfzyklen (Wartung/STK/MTK)');
        else if ((g.pruefungen || []).some((p) => !p.letzte)) fehlt.push('Datum der letzten Prüfung');
        if (fehlt.length) befunde.push(`#${g.id} ${g.name} (${g.location}/${g.department}): fehlt → ${fehlt.join(', ')}`);
      }
      return befunde.length
        ? `${befunde.length} Gerät(e) mit unvollständigen Daten:\n` + befunde.join('\n')
        : 'Alle Geräte haben vollständige Stammdaten. 🎉';
    },
  },
  {
    name: 'geraet_anlegen',
    description: 'Legt ein neues Gerät im Fuhrpark an. Pflicht: name, kategorie, hersteller, standort, abteilung. Optional u. a. modell, seriennummer, inventarnummer, raum, team, distributor, distEmail, distPhone, anschaffung (JJJJ-MM-TT), pruefungen [{art, intervallMonate, zuletzt}].',
    inputSchema: { type: 'object', properties: {
      name: { type: 'string' }, kategorie: { type: 'string' }, hersteller: { type: 'string' },
      standort: { type: 'string' }, abteilung: { type: 'string' },
      modell: { type: 'string' }, seriennummer: { type: 'string' }, inventarnummer: { type: 'string' },
      raum: { type: 'string' }, team: { type: 'string' }, distributor: { type: 'string' },
      distEmail: { type: 'string' }, distPhone: { type: 'string' }, anschaffung: { type: 'string' },
      pruefungen: { type: 'array', items: { type: 'object', properties: {
        art: { type: 'string' }, intervallMonate: { type: 'number' }, zuletzt: { type: 'string' } } } },
    }, required: ['name', 'kategorie', 'hersteller', 'standort', 'abteilung'] },
    schreibt: true,
    async ausfuehren(args, ctx) {
      const { daten } = ctx;
      const g = {
        id: daten.nextId++,
        name: args.name, category: args.kategorie, manufacturer: args.hersteller,
        model: args.modell || '', serial: args.seriennummer || '', inventoryNo: args.inventarnummer || '',
        location: args.standort, department: args.abteilung, room: args.raum || '', team: args.team || '',
        distributor: args.distributor || '', distContact: '', distPhone: args.distPhone || '', distEmail: args.distEmail || '',
        salesName: '', salesPhone: '', salesEmail: '', networkAddress: '',
        purchaseDate: args.anschaffung || null, warrantyEnd: null,
        status: 'ok', defectSince: null, defectHistory: [],
        pruefungen: (args.pruefungen || []).map((p) => ({ art: p.art, intervall: p.intervallMonate, letzte: p.zuletzt || null })),
        dokumente: [], belegungen: [], log: [], custom: {},
      };
      systemLog(g, `Gerät angelegt (${AUTOR}).`);
      daten.devices.push(g);
      ctx.geaendert = true;
      return `Gerät angelegt: ${kurzzeile(g)}`;
    },
  },
  {
    name: 'geraet_aktualisieren',
    description: 'Aktualisiert Stammdaten eines Geräts (nur die übergebenen Felder). Erlaubte Felder: name, kategorie, hersteller, modell, seriennummer, inventarnummer, standort, abteilung, raum, team, distributor, distEmail, distPhone, anschaffung, netzwerkadresse.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'number' }, felder: { type: 'object' },
    }, required: ['id', 'felder'] },
    schreibt: true,
    async ausfuehren(args, ctx) {
      const g = ctx.daten.devices.find((x) => x.id === args.id);
      if (!g) return `Gerät #${args.id} nicht gefunden.`;
      const mapping = { name: 'name', kategorie: 'category', hersteller: 'manufacturer', modell: 'model',
        seriennummer: 'serial', inventarnummer: 'inventoryNo', standort: 'location', abteilung: 'department',
        raum: 'room', team: 'team', distributor: 'distributor', distEmail: 'distEmail', distPhone: 'distPhone',
        anschaffung: 'purchaseDate', netzwerkadresse: 'networkAddress' };
      const gesetzt = [];
      for (const [k, v] of Object.entries(args.felder || {})) {
        if (mapping[k]) { g[mapping[k]] = v; gesetzt.push(k); }
      }
      if (!gesetzt.length) return 'Keine gültigen Felder übergeben.';
      systemLog(g, `Stammdaten aktualisiert via Claude: ${gesetzt.join(', ')}.`);
      ctx.geaendert = true;
      return `Aktualisiert (#${g.id} ${g.name}): ${gesetzt.join(', ')}`;
    },
  },
  {
    name: 'defekt_melden',
    description: 'Meldet ein Gerät als defekt (mit Grund). Setzt den Status und startet die Ausfallzeit-Messung.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, grund: { type: 'string' } }, required: ['id', 'grund'] },
    schreibt: true,
    async ausfuehren(args, ctx) {
      const g = ctx.daten.devices.find((x) => x.id === args.id);
      if (!g) return `Gerät #${args.id} nicht gefunden.`;
      if (g.status === 'defekt') return `${g.name} ist bereits als defekt gemeldet (seit ${g.defectSince}).`;
      g.status = 'defekt';
      g.defectSince = iso();
      systemLog(g, `Status geändert: → Defekt (${AUTOR}). Grund: ${args.grund}`);
      ctx.geaendert = true;
      return `Defekt gemeldet: ${g.name}. ${g.distributor ? `Service-Kontakt: ${g.distributor}, ${g.distPhone || ''} ${g.distEmail || ''}` : 'Kein Service-Kontakt hinterlegt.'}`;
    },
  },
  {
    name: 'kommentar_hinzufuegen',
    description: 'Schreibt einen Eintrag in den Verlauf/Chat eines Geräts (z. B. "Techniker kontaktiert, kommt in 24 h").',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, text: { type: 'string' } }, required: ['id', 'text'] },
    schreibt: true,
    async ausfuehren(args, ctx) {
      const g = ctx.daten.devices.find((x) => x.id === args.id);
      if (!g) return `Gerät #${args.id} nicht gefunden.`;
      g.log = g.log || [];
      g.log.push({ ts: Date.now(), author: AUTOR, type: 'user', text: args.text });
      ctx.geaendert = true;
      return `Eintrag im Verlauf von ${g.name} gespeichert.`;
    },
  },
  {
    name: 'wartungsplan',
    description: 'Anstehende und überfällige Prüfungen/Wartungen (STK, MTK, Wartung, Validierung) der nächsten Monate – als Grundlage für Wartungsplanung.',
    inputSchema: { type: 'object', properties: { monate: { type: 'number', description: 'Zeithorizont in Monaten (Standard 3)' } } },
    async ausfuehren(args, { daten }) {
      const horizont = (args.monate || 3) * 30;
      const eintraege = [];
      for (const g of daten.devices) {
        if (g.status === 'ausser_betrieb') continue;
        for (const f of faelligkeiten(g)) {
          if (f.tage <= horizont) eintraege.push({ tage: f.tage, text: `${f.datum} · ${f.art} · ${g.name} (#${g.id}, ${g.location}/${g.department})${f.tage < 0 ? ` – ÜBERFÄLLIG seit ${-f.tage} Tagen` : ''}${g.distributor ? ` · Service: ${g.distributor}` : ''}` });
        }
      }
      eintraege.sort((a, b) => a.tage - b.tage);
      return eintraege.length
        ? `Wartungsplan (${args.monate || 3} Monate, ${eintraege.length} Termine):\n` + eintraege.map((e) => e.text).join('\n')
        : 'Keine Prüfungen im gewählten Zeitraum fällig.';
    },
  },
  {
    name: 'service_kontakt',
    description: 'Liefert die Servicekontakte eines Geräts und einen fertigen Entwurf für die Störungsmeldung (E-Mail an den technischen Service des Distributors).',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    async ausfuehren(args, { daten }) {
      const g = daten.devices.find((x) => x.id === args.id);
      if (!g) return `Gerät #${args.id} nicht gefunden.`;
      const dauer = g.defectSince ? ` (seit ${g.defectSince}, ${tageDiff(g.defectSince, iso())} Tage)` : '';
      return [
        `Servicekontakte für ${g.name}:`,
        `- Technischer Service: ${g.distributor || '–'} · ${g.distContact || ''} ${g.distPhone || ''} ${g.distEmail || ''}`,
        `- Vertrieb/Außendienst: ${g.salesName || '–'} ${g.salesPhone || ''} ${g.salesEmail || ''}`,
        '',
        'Entwurf Störungsmeldung:',
        `An: ${g.distEmail || '(Service-E-Mail fehlt!)'}`,
        `Betreff: Störungsmeldung: ${g.name} (${g.model || ''}), SN ${g.serial || '–'}`,
        '',
        `Gerät: ${g.name} – ${g.manufacturer} ${g.model || ''}`,
        `Seriennummer: ${g.serial || '–'} · Inventarnummer: ${g.inventoryNo || '–'}`,
        `Standort: ${g.location}${g.room ? ', Raum ' + g.room : ''} (${g.department})`,
        `Status: ${statusVon(g)}${dauer}`,
      ].join('\n');
    },
  },
  {
    name: 'ersatzteile_suchen',
    description: 'Ersatzteilkatalog durchsuchen (optional je Gerät): Positionen, Artikelnummern, Bezeichnungen, Preise (CHF) und Lieferanten – z. B. um eine Bestellung oder Serviceanfrage vorzubereiten.',
    inputSchema: { type: 'object', properties: {
      geraetId: { type: 'number', description: 'nur Teile dieses Geräts' },
      suche: { type: 'string', description: 'Freitext (Artikel-Nr./Bezeichnung)' },
    } },
    async ausfuehren(args, { daten }) {
      const s = (args.suche || '').toLowerCase();
      const treffer = [];
      for (const g of daten.devices) {
        if (args.geraetId && g.id !== args.geraetId) continue;
        for (const e of g.ersatzteile || []) {
          if (s && ![e.name, e.artikelNr].some((f) => (f || '').toLowerCase().includes(s))) continue;
          treffer.push(`#${g.id} ${g.name} · Pos. ${e.pos || '–'} · ${e.artikelNr || '–'} · ${e.name}`
            + ` · ${e.preis !== null && e.preis !== undefined ? 'CHF ' + e.preis.toFixed(2) : 'Preis unbekannt'}`
            + (e.lieferant ? ` · ${e.lieferant}` : ''));
        }
      }
      return treffer.length ? `${treffer.length} Ersatzteil(e):\n` + treffer.join('\n') : 'Keine Ersatzteile gefunden.';
    },
  },
  {
    name: 'uebersetzungen_fehlen',
    description: 'Listet Freitext-Verlaufseinträge ohne gespeicherte Übersetzung in der Zielsprache. Für die einmalige, dauerhaft gespeicherte Übersetzung: Einträge übersetzen und mit uebersetzung_speichern sichern. Das Original bleibt immer erhalten.',
    inputSchema: { type: 'object', properties: {
      sprache: { type: 'string', enum: ['de', 'en', 'fr', 'it'], description: 'Zielsprache' },
      limit: { type: 'number', description: 'max. Einträge (Standard 50)' },
    }, required: ['sprache'] },
    async ausfuehren(args, { daten }) {
      const limit = args.limit || 50;
      const offen = [];
      for (const g of daten.devices) {
        for (const e of g.log || []) {
          if (e.key) continue; // strukturierte Einträge rendern sich selbst mehrsprachig
          if (e.uebersetzungen && e.uebersetzungen[args.sprache]) continue;
          offen.push({ geraetId: g.id, geraet: g.name, ts: e.ts, autor: e.author, text: e.text });
          if (offen.length >= limit) break;
        }
        if (offen.length >= limit) break;
      }
      return offen.length
        ? `${offen.length} Eintrag/Einträge ohne ${args.sprache}-Übersetzung:\n` + JSON.stringify(offen, null, 2)
          + '\n\nBitte übersetzen und mit uebersetzung_speichern sichern (geraetId + ts referenzieren den Eintrag).'
        : `Alle Verlaufseinträge haben bereits eine ${args.sprache}-Übersetzung.`;
    },
  },
  {
    name: 'uebersetzung_speichern',
    description: 'Speichert einmalige Übersetzungen von Verlaufseinträgen dauerhaft. Das Original bleibt unverändert; die App zeigt die Übersetzung in der jeweiligen Sprache mit "KI-Übersetzung"-Kennzeichnung.',
    inputSchema: { type: 'object', properties: {
      eintraege: { type: 'array', items: { type: 'object', properties: {
        geraetId: { type: 'number' }, ts: { type: 'number' },
        sprache: { type: 'string', enum: ['de', 'en', 'fr', 'it'] }, text: { type: 'string' },
      }, required: ['geraetId', 'ts', 'sprache', 'text'] } },
    }, required: ['eintraege'] },
    schreibt: true,
    async ausfuehren(args, ctx) {
      let gespeichert = 0;
      const fehler = [];
      for (const u of args.eintraege || []) {
        const g = ctx.daten.devices.find((x) => x.id === u.geraetId);
        const e = g && (g.log || []).find((x) => x.ts === u.ts);
        if (!e) { fehler.push(`#${u.geraetId}/${u.ts}`); continue; }
        e.uebersetzungen = e.uebersetzungen || {};
        e.uebersetzungen[u.sprache] = u.text;
        gespeichert++;
      }
      if (gespeichert) ctx.geaendert = true;
      return `${gespeichert} Übersetzung(en) dauerhaft gespeichert.`
        + (fehler.length ? ` Nicht gefunden: ${fehler.join(', ')}` : '');
    },
  },
  {
    name: 'statistik',
    description: 'Ausfallstatistik: Defekte, Ausfalltage und Reparaturkosten (CHF) pro Hersteller und pro Standort, normalisiert pro Gerät.',
    inputSchema: { type: 'object', properties: {} },
    async ausfuehren(_args, { daten }) {
      const gruppen = (feld) => {
        const map = new Map();
        for (const g of daten.devices) {
          const key = g[feld] || 'Ohne Angabe';
          if (!map.has(key)) map.set(key, { geraete: 0, defekte: 0, tage: 0, kosten: 0 });
          const s = map.get(key);
          s.geraete++;
          for (const e of g.defectHistory || []) {
            s.defekte++; s.tage += Math.max(0, tageDiff(e.start, e.end)); s.kosten += e.kosten || 0;
          }
          if (g.status === 'defekt' && g.defectSince) { s.defekte++; s.tage += Math.max(0, tageDiff(g.defectSince, iso())); }
        }
        return [...map.entries()].map(([name, s]) =>
          `  ${name}: ${s.geraete} Geräte, ${s.defekte} Defekte (${(s.defekte / s.geraete).toFixed(1)}/Gerät), ${s.tage} Ausfalltage, CHF ${s.kosten.toFixed(0)} Reparaturkosten`)
          .join('\n');
      };
      return `Nach Hersteller:\n${gruppen('manufacturer')}\n\nNach Standort:\n${gruppen('location')}`;
    },
  },
];

/* ---------------- MCP-Protokoll (Streamable HTTP, JSON-RPC 2.0) ---------------- */

function rpcErgebnis(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcFehler(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

async function behandleRpc(nachricht, env) {
  const { id, method, params } = nachricht;
  switch (method) {
    case 'initialize':
      return rpcErgebnis(id, {
        protocolVersion: params?.protocolVersion || '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'geraetefuhrpark', version: '1.0.0', title: 'Gerätefuhrpark (Dietz-Engineering)' },
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null; // Benachrichtigung, keine Antwort
    case 'ping':
      return rpcErgebnis(id, {});
    case 'tools/list':
      return rpcErgebnis(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return rpcFehler(id, -32602, `Unbekanntes Tool: ${params?.name}`);
      try {
        const ctx = await datenLaden(env);
        ctx.geaendert = false;
        let text = await tool.ausfuehren(params.arguments || {}, ctx);
        if (ctx.geaendert) await datenSpeichern(env, ctx.daten, ctx.verschluesselt);
        if (ctx.demo) text += '\n\n(Hinweis: DEMO-Modus ohne Supabase – Änderungen sind nicht dauerhaft.)';
        return rpcErgebnis(id, { content: [{ type: 'text', text }] });
      } catch (e) {
        return rpcErgebnis(id, { content: [{ type: 'text', text: `Fehler: ${e.message}` }], isError: true });
      }
    }
    default:
      return rpcFehler(id, -32601, `Methode nicht unterstützt: ${method}`);
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
};

async function behandleAnfrage(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  // Optionaler Zugriffsschutz: MCP_SECRET muss als Bearer-Token mitkommen
  if (env.MCP_SECRET) {
    const auth = request.headers.get('Authorization') || '';
    if (auth !== `Bearer ${env.MCP_SECRET}`) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
  }
  if (request.method === 'GET') {
    return new Response('Gerätefuhrpark MCP-Server – bereit. In Claude unter Einstellungen → Connectors als Custom Connector hinzufügen.', { status: 200, headers: CORS });
  }
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS });
  let body;
  try { body = await request.json(); } catch (e) {
    return new Response(JSON.stringify(rpcFehler(null, -32700, 'Ungültiges JSON')), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  const nachrichten = Array.isArray(body) ? body : [body];
  const antworten = [];
  for (const n of nachrichten) {
    const antwort = await behandleRpc(n, env);
    if (antwort) antworten.push(antwort);
  }
  if (!antworten.length) return new Response(null, { status: 202, headers: CORS });
  const nutzlast = Array.isArray(body) ? antworten : antworten[0];
  return new Response(JSON.stringify(nutzlast), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/* ---------------- Cloudflare Worker ---------------- */
export default {
  fetch: (request, env) => behandleAnfrage(request, env || {}),
};

/* ---------------- Eigenständiger Node-Server ---------------- */
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('server.mjs')) {
  const { createServer } = await import('node:http');
  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL || '',
    SUPABASE_KEY: process.env.SUPABASE_KEY || '',
    MASTER_PASSWORT: process.env.MASTER_PASSWORT || '',
    MCP_SECRET: process.env.MCP_SECRET || '',
  };
  const port = Number(process.env.PORT || 8788);
  createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const antwort = await behandleAnfrage(request, env);
    res.writeHead(antwort.status, Object.fromEntries(antwort.headers));
    res.end(await antwort.text());
  }).listen(port, () => console.log(`Gerätefuhrpark MCP-Server läuft auf Port ${port}${supabaseKonfiguriert(env) ? '' : ' (DEMO-Modus ohne Supabase)'}`));
}
