/* =====================================================================
 * Gerätefuhrpark – Hauptanwendung
 * Login & Rollen, Übersichtsliste, Detailansicht mit Verlauf/Chat,
 * Benachrichtigungen, Statistik-Anbindung.
 *
 * © Dietz-Engineering · Alle Rechte vorbehalten
 * Designed by Dietz-Engineering · Initiiert von Christoph Lüttgens
 * ===================================================================== */

let daten = ladeDaten();
/** true, solange ein verschlüsselter Bestand auf die Passworteingabe wartet. */
let datenGesperrt = daten === null;
if (datenGesperrt) daten = { devices: [], nextId: 100, customFields: [], nextFieldId: 1 };
let nutzer = null;

const zustand = {
  suche: '', standort: '', abteilung: '', status: '', wartung: '',
  gruppe: '', // Gruppierungsfeld der Übersichtsliste ('' = keine Gruppierung)
  eingeklappt: new Set(), // eingeklappte Gruppenköpfe (Gruppierungswerte)
  sortKey: 'status', sortDir: 1,
  offenesGeraet: null, // Geräte-ID im Detail-Modal
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/** HTML-Sonderzeichen maskieren (Nutzereingaben sicher rendern). */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const STATUS_KLASSEN = { ok: 'b-ok', wartung: 'b-wartung', defekt: 'b-defekt', ausser_betrieb: 'b-ausser' };
/** Ampel-Info (Klasse + übersetzter Text) zu einem Status. */
function statusInfo(s) { return { klasse: STATUS_KLASSEN[s], text: t('status.' + s) }; }
const STATUS_RANG = { defekt: 0, wartung: 1, ok: 2, ausser_betrieb: 3 };

/* ===================== Login & Rollen ===================== */

const UNLOCK_KEY = 'geraetefuhrpark_unlock';

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** true, wenn ein Master-Passwort konfiguriert ist. */
function masterAktiv() {
  return typeof MASTER_PASSWORT_HASH !== 'undefined' && !!MASTER_PASSWORT_HASH;
}

/** true, wenn dieses Gerät das aktuelle Master-Passwort bereits korrekt eingegeben hat. */
function istFreigeschaltet() {
  return !masterAktiv() || localStorage.getItem(UNLOCK_KEY) === MASTER_PASSWORT_HASH;
}

function initLogin() {
  try { nutzer = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { nutzer = null; }
  const bereit = istFreigeschaltet() && !datenGesperrt && !(verschluesselungAktiv() && !kryptoSchluessel);
  if (nutzer && nutzer.name && bereit) { zeigeApp(); } else { zeigeLogin(); }

  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    // Master-Passwort prüfen (wenn konfiguriert und noch nicht freigeschaltet
    // oder ein Verschlüsselungs-Schlüssel für diese Sitzung fehlt)
    const passwortNoetig = masterAktiv() && (!istFreigeschaltet() || (verschluesselungAktiv() && !kryptoSchluessel));
    if (passwortNoetig) {
      const passwort = $('#login-passwort').value;
      const hash = await sha256Hex(passwort);
      if (hash !== MASTER_PASSWORT_HASH) {
        $('#passwort-fehler').classList.remove('hidden');
        $('#login-passwort').value = '';
        $('#login-passwort').focus();
        return;
      }
      localStorage.setItem(UNLOCK_KEY, MASTER_PASSWORT_HASH);
      if (verschluesselungAktiv()) {
        await leiteKryptoSchluesselAb(passwort);
        if (datenGesperrt) {
          try {
            daten = await entschluesselePersistenz();
            datenGesperrt = false;
          } catch (e) {
            $('#passwort-fehler').classList.remove('hidden');
            return;
          }
        }
        persistiereLokal(daten); // Bestand ab jetzt verschlüsselt ablegen
      }
    }
    const name = $('#login-name').value.trim();
    if (!name) return;
    nutzer = { name, role: document.querySelector('input[name="role"]:checked').value };
    localStorage.setItem(SESSION_KEY, JSON.stringify(nutzer));
    zeigeApp();
  });

  $('#logout-btn').addEventListener('click', () => {
    localStorage.removeItem(SESSION_KEY);
    nutzer = null;
    zeigeLogin();
  });
}

function zeigeLogin() {
  $('#login-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
  // Passwortfeld zeigen, wenn (a) Gerät noch nicht freigeschaltet oder
  // (b) Verschlüsselung aktiv ist und der Sitzungsschlüssel fehlt
  const passwortNoetig = !istFreigeschaltet() || (verschluesselungAktiv() && !kryptoSchluessel);
  $('#passwort-feld').classList.toggle('hidden', !masterAktiv() || !passwortNoetig);
  $('#passwort-fehler').classList.add('hidden');
}

function zeigeApp() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-name').textContent = nutzer.name;
  $('#user-role').textContent = nutzer.role === 'admin' ? t('rolle.admin') : t('rolle.mitarbeiter');
  $$('.admin-only').forEach((el) => el.classList.toggle('hidden', nutzer.role !== 'admin'));
  renderAlles();
  // Deep-Link aus QR-Code (?geraet=ID): Detailansicht direkt öffnen
  const qrId = Number(new URLSearchParams(location.search).get('geraet'));
  if (qrId && findeGeraet(qrId)) {
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* file:// o. ä. */ }
    oeffneDetail(qrId);
  }
}

function istAdmin() { return nutzer && nutzer.role === 'admin'; }

/* ===================== Übersicht ===================== */

function gefilterteListe() {
  const s = zustand.suche.toLowerCase();
  let liste = daten.devices.filter((g) => {
    if (s && ![g.name, g.serial, g.inventoryNo, g.model, g.manufacturer, g.room, g.team]
      .some((f) => (f || '').toLowerCase().includes(s))) return false;
    if (zustand.standort && g.location !== zustand.standort) return false;
    if (zustand.abteilung && g.department !== zustand.abteilung) return false;
    if (zustand.status && effektiverStatus(g) !== zustand.status) return false;
    const wt = wartungTageVerbleibend(g);
    if (zustand.wartung === 'faellig30' && !(wt !== null && wt <= WARTUNG_VORLAUF_TAGE)) return false;
    if (zustand.wartung === 'ueberfaellig' && !(wt !== null && wt < 0)) return false;
    return true;
  });

  const key = zustand.sortKey, dir = zustand.sortDir;
  const wert = (g) => {
    switch (key) {
      case 'status': return STATUS_RANG[effektiverStatus(g)];
      case 'nextMaint': { const f = naechsteFaelligkeit(g); return f ? f.datum : '9999-12-31'; }
      case 'defectDays': return -(defektTage(g) ?? -1);
      default: return (g[key] || '').toLowerCase();
    }
  };
  liste.sort((a, b) => {
    const va = wert(a), vb = wert(b);
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
  });
  return liste;
}

function renderKacheln() {
  const zaehler = { gesamt: daten.devices.length, ok: 0, wartung: 0, defekt: 0, ausser_betrieb: 0 };
  for (const g of daten.devices) zaehler[effektiverStatus(g)]++;
  $('#dashboard-tiles').innerHTML = `
    <div class="tile" data-status=""><div class="tile-num">${zaehler.gesamt}</div><div class="tile-label">${t('kachel.gesamt')}</div></div>
    <div class="tile t-green" data-status="ok"><div class="tile-num">${zaehler.ok}</div><div class="tile-label">${t('kachel.ok')}</div></div>
    <div class="tile t-yellow" data-status="wartung"><div class="tile-num">${zaehler.wartung}</div><div class="tile-label">${t('kachel.wartung')}</div></div>
    <div class="tile t-red" data-status="defekt"><div class="tile-num">${zaehler.defekt}</div><div class="tile-label">${t('kachel.defekt')}</div></div>
    <div class="tile t-grey" data-status="ausser_betrieb"><div class="tile-num">${zaehler.ausser_betrieb}</div><div class="tile-label">${t('kachel.ausser')}</div></div>`;
  $$('#dashboard-tiles .tile').forEach((tile) => tile.addEventListener('click', () => {
    zustand.status = tile.dataset.status;
    $('#filter-status').value = zustand.status;
    renderTabelle();
  }));
}

function wartungZelle(g) {
  const f = naechsteFaelligkeit(g);
  if (!f) return `<small>${t('zelle.keinePruefungen')}</small>`;
  const label = `${formatDatum(f.datum)} <small>(${esc(f.art)})</small>`;
  if (f.tage < 0) return `<span class="maint-overdue">${label}<br><small>${t('zelle.ueberfaelligSeit', { n: -f.tage })}</small></span>`;
  if (f.tage <= WARTUNG_VORLAUF_TAGE) return `<span class="maint-soon">${label}<br><small>${t('zelle.inTagen', { n: f.tage })}</small></span>`;
  return `${label}<br><small>${t('zelle.inTagen', { n: f.tage })}</small>`;
}

/** Betrag in der Hauswährung (CHF) formatieren, Schweizer Zahlenformat. */
function geld(n) {
  const waehrung = typeof WAEHRUNG !== 'undefined' ? WAEHRUNG : 'CHF';
  return (n || 0).toLocaleString(LOCALES[sprache] || 'de-CH', { style: 'currency', currency: waehrung });
}

function ausfallZelle(g) {
  const tage = defektTage(g);
  if (tage === null) return '–';
  return `<span class="defect-days">${tage === 0 ? t('zelle.seitHeute') : t('zelle.seitTagen', { n: tage })}</span><br><small>${t('zelle.gemeldet')} ${formatDatum(g.defectSince)}</small>`;
}

function geraetZeile(g) {
  const st = statusInfo(effektiverStatus(g));
  return `<tr data-id="${g.id}">
    <td><span class="badge ${st.klasse}">${st.text}</span></td>
    <td><span class="device-name">${esc(g.name)}</span><br><span class="device-sub">${esc(g.model || '')} · ${t('zelle.inv')} ${esc(g.inventoryNo || '–')}</span></td>
    <td>${esc(g.category)}</td>
    <td>${esc(g.location)}${g.room ? `<br><span class="device-sub">${t('zelle.raum')} ${esc(g.room)}</span>` : ''}</td>
    <td>${esc(g.department)}${g.team ? `<br><span class="device-sub">${esc(g.team)}</span>` : ''}</td>
    <td>${esc(g.manufacturer)}</td>
    <td>${wartungZelle(g)}</td>
    <td>${ausfallZelle(g)}</td>
    <td>${esc(g.distributor || '–')}<br><span class="device-sub">${esc(g.distPhone || '')}</span></td>
    <td><button class="btn btn-sm btn-detail">${t('zelle.details')}</button></td>
  </tr>`;
}

/** Anzeigename des Gruppierungswerts eines Geräts. */
function gruppenWert(g) {
  if (zustand.gruppe === 'status') return statusInfo(effektiverStatus(g)).text;
  return g[zustand.gruppe] || t('ohneAngabe');
}

function renderTabelle() {
  const liste = gefilterteListe();
  $('#empty-hint').classList.toggle('hidden', liste.length > 0);

  let html;
  if (zustand.gruppe) {
    const gruppen = new Map();
    for (const g of liste) {
      const key = gruppenWert(g);
      if (!gruppen.has(key)) gruppen.set(key, []);
      gruppen.get(key).push(g);
    }
    const keys = [...gruppen.keys()];
    if (zustand.gruppe === 'status') {
      const rang = Object.fromEntries(Object.keys(STATUS_KLASSEN).map((k) => [t('status.' + k), STATUS_RANG[k]]));
      keys.sort((a, b) => rang[a] - rang[b]);
    } else {
      keys.sort((a, b) => (a === t('ohneAngabe')) - (b === t('ohneAngabe')) || a.localeCompare(b, sprache));
    }
    html = keys.map((key) => {
      const items = gruppen.get(key);
      const zu = zustand.eingeklappt.has(key);
      const defekt = items.filter((g) => effektiverStatus(g) === 'defekt').length;
      const wartung = items.filter((g) => effektiverStatus(g) === 'wartung').length;
      const hinweise = [
        defekt ? `<span class="group-alert">${t('gruppe.defekt', { n: defekt })}</span>` : '',
        wartung ? `<span class="group-warn">${t('gruppe.wartung', { n: wartung })}</span>` : '',
      ].filter(Boolean).join(' · ');
      return `<tr class="group-row" data-group="${esc(key)}" title="${zu ? t('gruppe.aufklappen') : t('gruppe.zuklappen')}">
        <td colspan="10"><span class="group-toggle">${zu ? '▸' : '▾'}</span> ${esc(key)}
        <span class="group-count">${t('gruppe.geraete', { n: items.length })}${hinweise ? ' · ' + hinweise : ''}</span></td></tr>`
        + (zu ? '' : items.map(geraetZeile).join(''));
    }).join('');
  } else {
    html = liste.map(geraetZeile).join('');
  }
  $('#device-tbody').innerHTML = html;

  $$('#device-tbody tr[data-id]').forEach((tr) => {
    tr.querySelector('.btn-detail').addEventListener('click', () => oeffneDetail(Number(tr.dataset.id)));
  });

  // Gruppenköpfe: Klick klappt die Gruppe ein/aus
  $$('#device-tbody tr.group-row').forEach((tr) => tr.addEventListener('click', () => {
    const key = tr.dataset.group;
    if (zustand.eingeklappt.has(key)) zustand.eingeklappt.delete(key);
    else zustand.eingeklappt.add(key);
    renderTabelle();
  }));

  // Sortier-Pfeile
  $$('#device-table th.sortable').forEach((th) => {
    const arrow = th.dataset.sort === zustand.sortKey ? (zustand.sortDir === 1 ? ' ▲' : ' ▼') : '';
    th.innerHTML = th.textContent.replace(/ [▲▼]$/, '') + `<span class="sort-arrow">${arrow}</span>`;
  });
}

/** Gruppierungs-Auswahl in der aktiven Sprache aufbauen. */
function fuelleGruppenOptionen() {
  const dims = ['location', 'department', 'room', 'team', 'category', 'manufacturer', 'distributor', 'status'];
  const el = $('#group-by');
  const wert = el.value;
  el.innerHTML = `<option value="">${t('filter.keineGruppe')}</option>` +
    dims.map((d) => `<option value="${d}">${t('filter.gruppieren', { dim: t('dim.' + d) })}</option>`).join('');
  el.value = wert;
}

function fuelleFilterOptionen() {
  fuelleGruppenOptionen();
  const setze = (sel, werte, aktuell) => {
    const el = $(sel);
    const erste = el.querySelector('option').outerHTML;
    el.innerHTML = erste + [...werte].sort((a, b) => a.localeCompare(b, 'de'))
      .map((w) => `<option value="${esc(w)}">${esc(w)}</option>`).join('');
    el.value = aktuell;
  };
  const standorte = new Set(daten.devices.map((g) => g.location));
  const abteilungen = new Set(daten.devices.map((g) => g.department));
  const hersteller = new Set(daten.devices.map((g) => g.manufacturer));
  setze('#filter-standort', standorte, zustand.standort);
  setze('#filter-abteilung', abteilungen, zustand.abteilung);
  setze('#stat-standort', standorte, $('#stat-standort').value);
  setze('#stat-abteilung', abteilungen, $('#stat-abteilung').value);
  setze('#stat-hersteller', hersteller, $('#stat-hersteller').value);
  setze('#kal-standort', standorte, $('#kal-standort').value);
  setze('#kal-abteilung', abteilungen, $('#kal-abteilung').value);
  setze('#bel-standort', standorte, $('#bel-standort').value);
  setze('#bel-abteilung', abteilungen, $('#bel-abteilung').value);
  const pruefarten = new Set(daten.devices.flatMap((g) => (g.pruefungen || []).map((p) => p.art)));
  setze('#kal-art', pruefarten, $('#kal-art').value);

  // Datalists im Formular
  const dl = (id, werte) => { $(id).innerHTML = [...werte].map((w) => `<option value="${esc(w)}">`).join(''); };
  dl('#dl-category', new Set(daten.devices.map((g) => g.category)));
  dl('#dl-manufacturer', hersteller);
  dl('#dl-location', standorte);
  dl('#dl-department', abteilungen);
  dl('#dl-room', new Set(daten.devices.map((g) => g.room).filter(Boolean)));
  dl('#dl-team', new Set(daten.devices.map((g) => g.team).filter(Boolean)));
  dl('#dl-distributor', new Set(daten.devices.map((g) => g.distributor).filter(Boolean)));
}

/* ===================== Benachrichtigungen ===================== */

function berechneBenachrichtigungen() {
  const liste = [];
  for (const g of daten.devices) {
    for (const f of faelligkeiten(g)) {
      if (f.tage < 0) {
        liste.push({ id: g.id, icon: '🔴', text: t('notif.ueberfaellig', { geraet: g.name, art: f.art, n: -f.tage }) });
      } else if (f.tage <= WARTUNG_VORLAUF_TAGE && g.status !== 'ausser_betrieb') {
        liste.push({ id: g.id, icon: '🟡', text: t('notif.faellig', { geraet: g.name, art: f.art, n: f.tage, datum: formatDatum(f.datum) }) });
      }
    }
    const dt = defektTage(g);
    if (dt !== null && dt >= DEFEKT_ALARM_TAGE) {
      liste.push({ id: g.id, icon: '⚠️', text: t('notif.defekt', { geraet: g.name, n: dt }) });
    }
  }
  return liste;
}

function renderBenachrichtigungen() {
  const liste = berechneBenachrichtigungen();
  const badge = $('#notif-badge');
  badge.classList.toggle('hidden', liste.length === 0);
  badge.textContent = liste.length;
  $('#notif-panel').innerHTML = liste.length
    ? liste.map((n) => `<div class="notif-item" data-id="${n.id}"><span class="n-icon">${n.icon}</span>${esc(n.text)}</div>`).join('')
    : `<div class="notif-empty">${t('notif.keine')}</div>`;
  $$('#notif-panel .notif-item').forEach((el) => el.addEventListener('click', () => {
    $('#notif-panel').classList.add('hidden');
    oeffneDetail(Number(el.dataset.id));
  }));
}

/* ===================== Detailansicht & Chat ===================== */

function findeGeraet(id) { return daten.devices.find((g) => g.id === id); }

function systemEintrag(g, text) {
  g.log.push({ ts: Date.now(), author: 'System', type: 'system', text });
}

/**
 * mailto-Link mit vorausgefüllter Störungsmeldung an den technischen Service.
 * Öffnet das E-Mail-Programm – abschicken muss der Mensch (bewusst so:
 * vollautomatischer Versand bräuchte ein Backend, siehe README).
 */
function serviceMailLink(g) {
  const dt = defektTage(g);
  const betreff = t('mail.serviceBetreff', { geraet: `${g.name}${g.model ? ' (' + g.model + ')' : ''}`, sn: g.serial || '–' });
  const body = t('mail.serviceText', {
    geraet: `${g.name} – ${g.manufacturer} ${g.model || ''}`,
    sn: g.serial || '–',
    inv: g.inventoryNo || '–',
    standort: `${g.location}${g.room ? ', ' + t('zelle.raum') + ' ' + g.room : ''}${g.department ? ' (' + g.department + ')' : ''}`,
    seit: `${formatDatum(g.defectSince)}${dt !== null ? ' (' + dt + ' d)' : ''}`,
    name: nutzer ? nutzer.name : '',
  });
  return `mailto:${g.distEmail}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(body)}`;
}

function oeffneDetail(id) {
  zustand.offenesGeraet = id;
  renderDetail();
  $('#modal-detail').classList.remove('hidden');
}

function renderDetail() {
  const g = findeGeraet(zustand.offenesGeraet);
  if (!g) return;
  const st = statusInfo(effektiverStatus(g));
  const dt = defektTage(g);
  $('#detail-title').innerHTML = `${esc(g.name)} <span class="badge ${st.klasse}">${st.text}</span>`;

  const aktionen = [];
  if (g.status !== 'defekt') aktionen.push(`<button class="btn btn-danger btn-status" data-aktion="defekt">${t('aktion.defekt')}</button>`);
  if (g.status === 'defekt') aktionen.push(`<button class="btn btn-status" data-aktion="repariert">${t('aktion.repariert')}</button>`);
  if (g.status === 'defekt' && g.distEmail) aktionen.push(`<a class="btn btn-status" id="btn-service-mail" href="${serviceMailLink(g)}">${t('aktion.service')}</a>`);
  if (g.status !== 'ausser_betrieb') aktionen.push(`<button class="btn btn-status" data-aktion="ausser_betrieb">${t('aktion.ausser')}</button>`);
  else aktionen.push(`<button class="btn btn-status" data-aktion="in_betrieb">${t('aktion.inBetrieb')}</button>`);
  if (istAdmin()) {
    aktionen.push(`<button class="btn btn-status" data-aktion="bearbeiten">${t('aktion.bearbeiten')}</button>`);
    aktionen.push(`<button class="btn btn-danger btn-status" data-aktion="loeschen">${t('aktion.loeschen')}</button>`);
  }

  const logSortiert = [...g.log].sort((a, b) => b.ts - a.ts); // neueste zuerst
  const gesamtkosten = defektEreignisse(g).reduce((s, e) => s + (e.kosten || 0), 0);

  const pruefZeilen = (g.pruefungen || []).map((p, i) => {
    const nd = pruefungNaechste(p);
    const tage = nd ? tageDiff(isoDatum(heute()), nd) : null;
    const status = nd
      ? (tage < 0 ? `<span class="maint-overdue">${t('zelle.ueberfaelligSeit', { n: -tage })}</span>`
        : tage <= WARTUNG_VORLAUF_TAGE ? `<span class="maint-soon">${t('zelle.inTagen', { n: tage })}</span>`
        : t('zelle.inTagen', { n: tage }))
      : `<small>${t('pruef.nie')}</small>`;
    return `<tr>
      <td><strong>${esc(p.art)}</strong></td>
      <td>${t('pruef.alleMonate', { n: p.intervall })}</td>
      <td>${formatDatum(p.letzte)}</td>
      <td>${nd ? formatDatum(nd) : '–'}<br><small>${status}</small></td>
      <td><button type="button" class="btn btn-sm pruef-done" data-pruef="${i}">${t('pruef.done')}</button></td>
    </tr>`;
  }).join('');

  $('#detail-body').innerHTML = `
    <dl class="detail-grid">
      <div><dt>${t('dt.geraetetyp')}</dt><dd>${esc(g.category)}</dd></div>
      <div><dt>${t('dt.herstellerModell')}</dt><dd>${esc(g.manufacturer)} ${esc(g.model || '')}</dd></div>
      <div><dt>${t('dt.seriennummer')}</dt><dd>${esc(g.serial || '–')}</dd></div>
      <div><dt>${t('dt.inventarnummer')}</dt><dd>${esc(g.inventoryNo || '–')}</dd></div>
      <div><dt>${t('dt.standort')}</dt><dd>${esc(g.location)}${g.room ? ' · ' + t('zelle.raum') + ' ' + esc(g.room) : ''}</dd></div>
      <div><dt>${t('dt.abteilung')}</dt><dd>${esc(g.department)}${g.team ? ' · ' + esc(g.team) : ''}</dd></div>
      <div><dt>${t('dt.anschaffung')}</dt><dd>${formatDatum(g.purchaseDate)}</dd></div>
      <div><dt>${t('dt.garantie')}</dt><dd>${formatDatum(g.warrantyEnd)}</dd></div>
      <div><dt>${t('dt.distributor')}</dt><dd>${esc(g.distributor || '–')}</dd></div>
      <div><dt>${t('dt.serviceKontakt')}</dt><dd>${g.distContact ? esc(g.distContact) + ' · ' : ''}${esc(g.distPhone || '–')}${g.distEmail ? ' · <a href="mailto:' + esc(g.distEmail) + '">' + esc(g.distEmail) + '</a>' : ''}</dd></div>
      <div><dt>${t('dt.vertrieb')}</dt><dd>${g.salesName || g.salesPhone || g.salesEmail ? `${esc(g.salesName || '')}${g.salesPhone ? ' · ' + esc(g.salesPhone) : ''}${g.salesEmail ? ' · <a href="mailto:' + esc(g.salesEmail) + '">' + esc(g.salesEmail) + '</a>' : ''}` : '–'}</dd></div>
      <div><dt>${t('dt.netzwerk')}</dt><dd>${g.networkAddress
        ? esc(g.networkAddress) + (MONITORING_ENDPOINT
          ? ` <button type="button" class="btn btn-sm" id="btn-netcheck">${t('dt.netzwerkAbfrage')}</button>`
          : ` <small>${t('dt.netzwerkHinweis')}</small>`)
        : '–'}</dd></div>
      ${dt !== null ? `<div><dt>${t('dt.ausfalldauer')}</dt><dd class="defect-days">${t('dt.defektSeit', { seit: dt === 0 ? t('zelle.seitHeute') : t('zelle.seitTagen', { n: dt }), datum: formatDatum(g.defectSince) })}</dd></div>` : ''}
      <div><dt>${t('dt.defekte')}</dt><dd>${defektEreignisse(g).length}${gesamtkosten ? ' · ' + t('dt.kostenGesamt') + ': ' + geld(gesamtkosten) : ''}</dd></div>
      ${daten.customFields.map((f) => `<div><dt>${esc(f.label)}</dt><dd>${formatCustomWert(f, (g.custom || {})[f.id])}</dd></div>`).join('')}
    </dl>
    <div class="detail-section pruef-section">
      <h3>${t('pruef.titel')}</h3>
      ${pruefZeilen
        ? `<div class="table-wrap"><table class="pruef-table">
            <thead><tr><th>${t('pruef.art')}</th><th>${t('pruef.intervall')}</th><th>${t('pruef.zuletzt')}</th><th>${t('pruef.naechste')}</th><th></th></tr></thead>
            <tbody>${pruefZeilen}</tbody></table></div>`
        : `<p><small>${t('pruef.keine')}</small></p>`}
    </div>
    ${dokumenteHtml(g)}
    ${belegungHtml(g)}
    <div class="detail-actions">${aktionen.join('')}</div>
    <div class="detail-section">
      <h3>${t('verlauf.titel')}</h3>
      <form class="chat-form" id="chat-form">
        <input type="text" id="chat-input" placeholder="${esc(t('verlauf.ph'))}" maxlength="500">
        <button type="submit" class="btn btn-primary">${t('verlauf.senden')}</button>
      </form>
      <div class="log-list">
        ${logSortiert.length ? logSortiert.map((e) => `
          <div class="log-entry ${e.type === 'system' ? 'log-system' : ''}">
            <div class="log-meta"><strong>${esc(e.author)}</strong> · ${formatZeit(e.ts)}</div>
            <div>${esc(e.text)}</div>
          </div>`).join('') : `<small>${t('verlauf.keine')}</small>`}
      </div>
    </div>`;

  $('#chat-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = $('#chat-input').value.trim();
    if (!text) return;
    g.log.push({ ts: Date.now(), author: nutzer.name, type: 'user', text });
    speichereDaten(daten);
    renderDetail();
    renderAlles(false);
  });

  $$('#detail-body .btn-status').forEach((btn) => {
    if (btn.dataset.aktion) btn.addEventListener('click', () => statusAktion(g, btn.dataset.aktion));
  });

  // --- Dokumente ---
  $$('#detail-body .dok-open').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    const d = (g.dokumente || []).find((x) => x.id === a.closest('.dok-row').dataset.dok);
    if (d) oeffneDokument(d).catch(() => alert(t('dok.oeffnenFehler')));
  }));
  $$('#detail-body .dok-del').forEach((btn) => btn.addEventListener('click', () => {
    const d = (g.dokumente || []).find((x) => x.id === btn.closest('.dok-row').dataset.dok);
    if (!d || !confirm(t('dok.entfernenFrage', { name: d.name }))) return;
    g.dokumente = g.dokumente.filter((x) => x.id !== d.id);
    systemEintrag(g, t('sys.dokEntfernt', { dok: d.name, name: nutzer.name }));
    speichereDaten(daten);
    renderDetail();
  }));
  $('#dok-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const url = $('#dok-url').value.trim();
    const name = $('#dok-name').value.trim() || url;
    if (!url) { alert(t('dok.linkFehlt')); return; }
    g.dokumente.push({ id: neueId(), kategorie: $('#dok-kategorie').value, name, typ: 'link', url });
    systemEintrag(g, t('sys.dokLink', { dok: name, name: nutzer.name }));
    speichereDaten(daten);
    renderDetail();
  });
  $('#dok-datei-btn').addEventListener('click', () => $('#dok-datei').click());
  $('#dok-datei').addEventListener('change', () => {
    const datei = $('#dok-datei').files[0];
    if (!datei) return;
    if (datei.size > DOK_MAX_BYTES) {
      alert(t('dok.zuGross'));
      return;
    }
    const leser = new FileReader();
    leser.onload = () => {
      const name = $('#dok-name').value.trim() || datei.name;
      g.dokumente.push({ id: neueId(), kategorie: $('#dok-kategorie').value, name, typ: 'datei', url: leser.result, groesse: datei.size });
      systemEintrag(g, t('sys.dokUpload', { dok: name, name: nutzer.name }));
      speichereDaten(daten);
      renderDetail();
    };
    leser.readAsDataURL(datei);
  });

  // --- Belegung ---
  $('#beleg-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const von = $('#beleg-von').value, bis = $('#beleg-bis').value;
    const zweck = $('#beleg-zweck').value.trim();
    if (!von || !bis || !zweck) return;
    if (bis <= von) { alert(t('beleg.endeNachBeginn')); return; }
    const konflikt = belegungsKonflikt(g, von, bis, null);
    if (konflikt) {
      alert(t('beleg.konflikt', { details: `${formatBelegZeit(konflikt)} · ${konflikt.wer} · ${konflikt.zweck}` }));
      return;
    }
    g.belegungen.push({ id: neueId(), von, bis, wer: nutzer.name, zweck });
    systemEintrag(g, t('sys.reserviert', { zeit: formatBelegZeit({ von, bis }), zweck, name: nutzer.name }));
    speichereDaten(daten);
    renderDetail();
    renderAlles(false);
  });
  $$('#detail-body .beleg-del').forEach((btn) => btn.addEventListener('click', () => {
    const b = (g.belegungen || []).find((x) => x.id === btn.closest('.beleg-row').dataset.beleg);
    if (!b || !confirm(t('beleg.stornoFrage', { zweck: b.zweck, zeit: formatBelegZeit(b) }))) return;
    g.belegungen = g.belegungen.filter((x) => x.id !== b.id);
    systemEintrag(g, t('sys.storniert', { zeit: formatBelegZeit(b), zweck: b.zweck, name: nutzer.name }));
    speichereDaten(daten);
    renderDetail();
    renderAlles(false);
  }));

  // Prüfung als durchgeführt eintragen
  $$('#detail-body .pruef-done').forEach((btn) => btn.addEventListener('click', () => {
    const p = g.pruefungen[Number(btn.dataset.pruef)];
    if (!p) return;
    p.letzte = isoDatum(heute());
    systemEintrag(g, t('sys.pruefung', { art: p.art, name: nutzer.name, datum: formatDatum(pruefungNaechste(p)) }));
    speichereDaten(daten);
    renderDetail();
    renderAlles(false);
  }));

  // Störungs-E-Mail: Klick im Verlauf dokumentieren (mailto öffnet das Mailprogramm)
  const mailBtn = $('#btn-service-mail');
  if (mailBtn) mailBtn.addEventListener('click', () => {
    systemEintrag(g, t('sys.serviceMail', { email: g.distEmail, name: nutzer.name }));
    speichereDaten(daten);
    setTimeout(renderDetail, 300);
  });

  // Online-Statusabfrage (nur aktiv, wenn ein Monitoring-Dienst konfiguriert ist)
  const netBtn = $('#btn-netcheck');
  if (netBtn) netBtn.addEventListener('click', async () => {
    netBtn.disabled = true;
    netBtn.textContent = t('monitor.laeuft');
    try {
      const s = await frageGeraeteStatusAb(g);
      alert(s.erreichbar === null
        ? t('monitor.nicht')
        : t('monitor.status', { geraet: g.name, status: s.erreichbar ? t('monitor.erreichbar') : t('monitor.nichtErreichbar'), zeit: s.geprueft ? formatZeit(new Date(s.geprueft).getTime()) : '–' }));
    } catch (e) {
      alert(t('monitor.fehler', { fehler: e.message }));
    }
    renderDetail();
  });
}

function statusAktion(g, aktion) {
  const alterStatus = statusInfo(effektiverStatus(g)).text;
  switch (aktion) {
    case 'defekt': {
      const grund = prompt(t('dialog.defektGrund'));
      if (grund === null) return;
      g.status = 'defekt';
      g.defectSince = isoDatum(heute());
      systemEintrag(g, t('sys.defekt', { alt: alterStatus, name: nutzer.name }) + (grund ? ' ' + t('sys.grund', { grund }) : ''));
      break;
    }
    case 'repariert': {
      // Reparaturkosten optional erfassen (fließen in die Statistik ein)
      let kosten = null;
      const eingabe = prompt(t('dialog.kosten'));
      if (eingabe) {
        const zahl = parseFloat(eingabe.replace(/\./g, '').replace(',', '.'));
        if (!isNaN(zahl) && zahl >= 0) kosten = zahl;
      }
      if (g.defectSince) {
        g.defectHistory = g.defectHistory || [];
        g.defectHistory.push({ start: g.defectSince, end: isoDatum(heute()), kosten });
      }
      const dauer = g.defectSince ? tageDiff(g.defectSince, Date.now()) : 0;
      g.status = 'ok';
      g.defectSince = null;
      systemEintrag(g, t('sys.repariert', { name: nutzer.name, dauer }) + (kosten !== null ? ' ' + t('sys.kosten', { betrag: geld(kosten) }) : ''));
      break;
    }
    case 'ausser_betrieb': {
      if (g.status === 'defekt' && g.defectSince) {
        g.defectHistory = g.defectHistory || [];
        g.defectHistory.push({ start: g.defectSince, end: isoDatum(heute()) });
        g.defectSince = null;
      }
      g.status = 'ausser_betrieb';
      systemEintrag(g, t('sys.ausser', { alt: alterStatus, name: nutzer.name }));
      break;
    }
    case 'in_betrieb': {
      g.status = 'ok';
      systemEintrag(g, t('sys.inBetrieb', { name: nutzer.name }));
      break;
    }
    case 'bearbeiten': {
      $('#modal-detail').classList.add('hidden');
      oeffneFormular(g);
      return;
    }
    case 'loeschen': {
      if (!confirm(t('dialog.loeschen', { name: g.name }))) return;
      daten.devices = daten.devices.filter((x) => x.id !== g.id);
      speichereDaten(daten);
      $('#modal-detail').classList.add('hidden');
      renderAlles();
      return;
    }
  }
  speichereDaten(daten);
  renderDetail();
  renderAlles(false);
}

/* ===================== Eigene Felder (Admin) ===================== */

function feldTypName(typ) { return { text: t('felder.typText'), number: t('felder.typZahl'), date: t('felder.typDatum') }[typ] || typ; }

function renderFelderListe() {
  const liste = daten.customFields;
  $('#fields-list').innerHTML = liste.length
    ? liste.map((f) => `
      <div class="field-row" data-id="${esc(f.id)}">
        <span class="field-label">${esc(f.label)}</span>
        <span class="field-type">${feldTypName(f.type)}</span>
        <button type="button" class="btn btn-sm btn-danger field-del">${t('felder.entfernen')}</button>
      </div>`).join('')
    : `<p class="empty-hint">${t('felder.keine')}</p>`;

  $$('#fields-list .field-del').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.closest('.field-row').dataset.id;
    const f = daten.customFields.find((x) => x.id === id);
    if (!confirm(t('felder.entfernenFrage', { label: f.label }))) return;
    daten.customFields = daten.customFields.filter((x) => x.id !== id);
    speichereDaten(daten);
    renderFelderListe();
  }));
}

function formatCustomWert(feld, wert) {
  if (!wert) return '–';
  return feld.type === 'date' ? formatDatum(wert) : esc(wert);
}

/* ===================== Formular (Admin) ===================== */

/** Eine Zeile des Prüfarten-Editors erzeugen. */
function pruefEditorZeile(p) {
  return `<div class="pruef-row">
    <input type="text" class="pe-art" list="dl-pruefart" placeholder="${esc(t('pruef.artPh'))}" value="${esc(p?.art || '')}" maxlength="30">
    <input type="number" class="pe-intervall" min="1" max="120" placeholder="${esc(t('pruef.monatePh'))}" value="${p?.intervall || ''}">
    <input type="date" class="pe-letzte" title="${esc(t('pruef.zuletzt'))}" value="${p?.letzte || ''}">
    <button type="button" class="btn btn-sm pe-del" title="${esc(t('pruef.entfernen'))}">✕</button>
  </div>`;
}

function renderPruefEditor(pruefungen) {
  $('#pruef-editor').innerHTML = pruefungen.map(pruefEditorZeile).join('');
  $$('#pruef-editor .pe-del').forEach((btn) =>
    btn.addEventListener('click', () => btn.closest('.pruef-row').remove()));
}

/** Prüfarten aus dem Editor einsammeln (Zeilen ohne Art/Intervall werden ignoriert). */
function samplePruefungen() {
  return $$('#pruef-editor .pruef-row').map((row) => ({
    art: row.querySelector('.pe-art').value.trim(),
    intervall: Number(row.querySelector('.pe-intervall').value) || null,
    letzte: row.querySelector('.pe-letzte').value || null,
  })).filter((p) => p.art && p.intervall);
}

function oeffneFormular(g) {
  $('#form-title').textContent = g ? t('form.titelBearbeiten') : t('form.titelNeu');
  $('#f-id').value = g ? g.id : '';
  $('#f-name').value = g?.name || '';
  $('#f-category').value = g?.category || '';
  $('#f-manufacturer').value = g?.manufacturer || '';
  $('#f-model').value = g?.model || '';
  $('#f-serial').value = g?.serial || '';
  $('#f-inventory').value = g?.inventoryNo || '';
  $('#f-location').value = g?.location || '';
  $('#f-department').value = g?.department || '';
  $('#f-room').value = g?.room || '';
  $('#f-team').value = g?.team || '';
  $('#f-distributor').value = g?.distributor || '';
  $('#f-dist-contact').value = g?.distContact || '';
  $('#f-dist-phone').value = g?.distPhone || '';
  $('#f-dist-email').value = g?.distEmail || '';
  $('#f-sales-name').value = g?.salesName || '';
  $('#f-sales-phone').value = g?.salesPhone || '';
  $('#f-sales-email').value = g?.salesEmail || '';
  $('#f-purchase').value = g?.purchaseDate || '';
  $('#f-warranty').value = g?.warrantyEnd || '';
  $('#f-network').value = g?.networkAddress || '';
  renderPruefEditor(g?.pruefungen?.length ? g.pruefungen : [{ art: 'Wartung', intervall: 12, letzte: null }]);
  // Eigene Felder dynamisch einfügen
  $('#custom-fields-form').innerHTML = daten.customFields.map((f) => `
    <label>${esc(f.label)}<input type="${f.type}" data-field="${esc(f.id)}" value="${esc((g?.custom || {})[f.id] || '')}"></label>`).join('');
  $('#modal-form').classList.remove('hidden');
}

function speichereFormular(ev) {
  ev.preventDefault();
  const id = $('#f-id').value ? Number($('#f-id').value) : null;
  const felder = {
    name: $('#f-name').value.trim(),
    category: $('#f-category').value.trim(),
    manufacturer: $('#f-manufacturer').value.trim(),
    model: $('#f-model').value.trim(),
    serial: $('#f-serial').value.trim(),
    inventoryNo: $('#f-inventory').value.trim(),
    location: $('#f-location').value.trim(),
    department: $('#f-department').value.trim(),
    room: $('#f-room').value.trim(),
    team: $('#f-team').value.trim(),
    distributor: $('#f-distributor').value.trim(),
    distContact: $('#f-dist-contact').value.trim(),
    distPhone: $('#f-dist-phone').value.trim(),
    distEmail: $('#f-dist-email').value.trim(),
    salesName: $('#f-sales-name').value.trim(),
    salesPhone: $('#f-sales-phone').value.trim(),
    salesEmail: $('#f-sales-email').value.trim(),
    purchaseDate: $('#f-purchase').value || null,
    warrantyEnd: $('#f-warranty').value || null,
    networkAddress: $('#f-network').value.trim(),
    pruefungen: samplePruefungen(),
  };
  // Eigene Felder: bestehende Werte übernehmen, sichtbare Eingaben aktualisieren
  const custom = { ...(id ? (findeGeraet(id).custom || {}) : {}) };
  $$('#custom-fields-form input').forEach((inp) => { custom[inp.dataset.field] = inp.value.trim(); });
  felder.custom = custom;
  if (id) {
    const g = findeGeraet(id);
    Object.assign(g, felder);
    systemEintrag(g, t('sys.bearbeitet', { name: nutzer.name }));
  } else {
    if (daten.devices.length >= lizenzGeraetelimit()) {
      alert(t('lizenz.limit', { n: lizenzGeraetelimit() }));
      return;
    }
    const g = {
      id: daten.nextId++, ...felder,
      status: 'ok', defectSince: null, defectHistory: [], log: [],
    };
    systemEintrag(g, t('sys.angelegt', { name: nutzer.name }));
    daten.devices.push(g);
  }
  speichereDaten(daten);
  $('#modal-form').classList.add('hidden');
  renderAlles();
}

/* ===================== Statistik-Ansicht ===================== */

function statFilter() {
  return {
    monate: Number($('#stat-zeitraum').value),
    standort: $('#stat-standort').value,
    abteilung: $('#stat-abteilung').value,
    hersteller: $('#stat-hersteller').value,
  };
}

const f1 = (n) => n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function renderStatistik() {
  const filter = statFilter();
  const events = gefilterteEreignisse(daten.devices, filter);
  const geraete = gefilterteGeraete(daten.devices, filter);
  const abgeschlossen = events.filter((e) => e.end);
  const ausfalltage = events.reduce((s, e) => s + e.dauerTage, 0);
  const kostenGesamt = events.reduce((s, e) => s + (e.kosten || 0), 0);
  const mittlereRep = abgeschlossen.length
    ? abgeschlossen.reduce((s, e) => s + e.dauerTage, 0) / abgeschlossen.length : 0;

  $('#stat-tiles').innerHTML = `
    <div class="tile"><div class="tile-num">${geraete.length}</div><div class="tile-label">${t('stat.geraeteImFilter')}</div></div>
    <div class="tile t-red"><div class="tile-num">${events.length}</div><div class="tile-label">${t('stat.defekteImZeitraum')}</div></div>
    <div class="tile t-yellow"><div class="tile-num">${ausfalltage}</div><div class="tile-label">${t('stat.ausfalltageGesamt')}</div></div>
    <div class="tile"><div class="tile-num">${f1(mittlereRep)}</div><div class="tile-label">${t('stat.oRep')}</div></div>
    <div class="tile t-red"><div class="tile-num">${geld(kostenGesamt)}</div><div class="tile-label">${t('stat.kostenZeitraum')}</div></div>`;

  balkendiagramm($('#chart-monat'), statMonatsverlauf(daten.devices, filter));

  // --- Hersteller ---
  const hs = statHersteller(daten.devices, filter);
  $('#table-hersteller').innerHTML = `
    <thead><tr><th>${t('th.hersteller')}</th><th class="num">${t('stat.geraete')}</th><th class="num">${t('stat.defekte')}</th>
    <th class="num">${t('stat.defekteProGeraet')}</th><th class="num">${t('stat.defekteProJahr')}</th>
    <th class="num">${t('stat.ausfalltage')}</th><th class="num">${t('stat.oAusfall')}</th><th class="num">${t('stat.kosten')}</th></tr></thead><tbody>` +
    hs.map((s, i) => `<tr>
      <td class="${i === 0 && s.defekte > 0 ? 'rank-1' : ''}">${esc(s.hersteller)}</td>
      <td class="num">${s.geraete}</td><td class="num">${s.defekte}</td>
      <td class="num">${f1(s.defekteProGeraet)}</td><td class="num">${f1(s.defekteProBetriebsjahr)}</td>
      <td class="num">${s.ausfalltage}</td><td class="num">${t('stat.tage', { n: f1(s.mittlereAusfalldauer) })}</td>
      <td class="num">${geld(s.kosten)}</td>
    </tr>`).join('') + '</tbody>';

  // --- Ausfallquote nach Dimension (Standort/Abteilung/Team/Raum) ---
  const dim = $('#stat-dimension').value;
  $('#dim-titel').textContent = t('dim.' + dim);
  const ds2 = statDimension(daten.devices, filter, dim);
  $('#table-dimension').innerHTML = `
    <thead><tr><th>${t('dim.' + dim)}</th><th class="num">${t('stat.geraete')}</th><th class="num">${t('stat.defekte')}</th>
    <th class="num">${t('stat.defekteProGeraet')}</th><th class="num">${t('stat.defekteProJahr')}</th>
    <th class="num">${t('stat.ausfalltage')}</th><th class="num">${t('stat.oAusfall')}</th><th class="num">${t('stat.kosten')}</th></tr></thead><tbody>` +
    ds2.map((s, i) => `<tr>
      <td class="${i === 0 && s.defekte > 0 ? 'rank-1' : ''}">${esc(s.name)}</td>
      <td class="num">${s.geraete}</td><td class="num">${s.defekte}</td>
      <td class="num">${f1(s.defekteProGeraet)}</td><td class="num">${f1(s.defekteProBetriebsjahr)}</td>
      <td class="num">${s.ausfalltage}</td><td class="num">${t('stat.tage', { n: f1(s.mittlereAusfalldauer) })}</td>
      <td class="num">${geld(s.kosten)}</td>
    </tr>`).join('') + '</tbody>';

  // --- Top-Ausfallgeräte ---
  const gs = statGeraete(daten.devices, filter);
  $('#table-geraete').innerHTML = `
    <thead><tr><th>#</th><th>${t('th.geraet')}</th><th>${t('th.hersteller')}</th><th>${t('th.standort')}</th>
    <th class="num">${t('stat.defekte')}</th><th class="num">${t('stat.ausfalltage')}</th><th class="num">${t('stat.kosten')}</th><th class="num">${t('stat.alter')}</th><th class="num">${t('stat.defekteProJahr')}</th></tr></thead><tbody>` +
    (gs.length ? gs.map((r, i) => `<tr>
      <td class="${i === 0 ? 'rank-1' : ''}">${i + 1}</td>
      <td>${esc(r.geraet.name)}<br><small>${esc(r.geraet.model || '')} · ${esc(r.geraet.department)}</small></td>
      <td>${esc(r.geraet.manufacturer)}</td><td>${esc(r.geraet.location)}</td>
      <td class="num">${r.defekte}</td><td class="num">${r.ausfalltage}</td>
      <td class="num">${geld(r.kosten)}</td>
      <td class="num">${f1(r.alterJahre)}</td><td class="num">${f1(r.defekteProBetriebsjahr)}</td>
    </tr>`).join('') : `<tr><td colspan="9"><small>${t('stat.keineDefekte')}</small></td></tr>`) + '</tbody>';

  // --- Gerätetypen ---
  const ts = statTypen(daten.devices, filter);
  $('#table-typen').innerHTML = `
    <thead><tr><th>${t('dt.geraetetyp')}</th><th>${t('th.hersteller')}</th><th class="num">${t('stat.geraete')}</th>
    <th class="num">${t('stat.defekte')}</th><th class="num">${t('stat.defekteProGeraet')}</th><th class="num">${t('stat.ausfalltage')}</th></tr></thead><tbody>` +
    ts.map((s) => `<tr>
      <td>${esc(s.kategorie)}</td><td>${esc(s.hersteller)}</td>
      <td class="num">${s.geraete}</td><td class="num">${s.defekte}</td>
      <td class="num">${f1(s.defekte / s.geraete)}</td><td class="num">${s.ausfalltage}</td>
    </tr>`).join('') + '</tbody>';

  // --- Distributoren ---
  const ds = statDistributor(daten.devices, filter);
  $('#table-distributor').innerHTML = `
    <thead><tr><th>${t('th.distributor')}</th><th class="num">${t('stat.reparaturen')}</th>
    <th class="num">${t('stat.oRepZeit')}</th><th class="num">${t('stat.repTage')}</th></tr></thead><tbody>` +
    (ds.length ? ds.map((s) => `<tr>
      <td>${esc(s.distributor)}</td><td class="num">${s.reparaturen}</td>
      <td class="num">${t('stat.tage', { n: f1(s.mittlereDauer) })}</td><td class="num">${s.tageGesamt}</td>
    </tr>`).join('') : `<tr><td colspan="4"><small>${t('stat.keineRep')}</small></td></tr>`) + '</tbody>';
}

function initCsvExporte() {
  $('#csv-hersteller').addEventListener('click', () => {
    const hs = statHersteller(daten.devices, statFilter());
    exportiereCSV('ausfallstatistik-hersteller.csv',
      [t('th.hersteller'), t('stat.geraete'), t('stat.defekte'), t('stat.defekteProGeraet'), t('stat.defekteProJahr'), t('stat.ausfalltage'), t('stat.oAusfall'), t('stat.kosten') + ' (' + WAEHRUNG + ')'],
      hs.map((s) => [s.hersteller, s.geraete, s.defekte, f1(s.defekteProGeraet), f1(s.defekteProBetriebsjahr), s.ausfalltage, f1(s.mittlereAusfalldauer), f1(s.kosten)]));
  });
  $('#csv-geraete').addEventListener('click', () => {
    const gs = statGeraete(daten.devices, statFilter());
    exportiereCSV('top-ausfallgeraete.csv',
      ['#', t('th.geraet'), t('form.modell'), t('th.hersteller'), t('th.standort'), t('th.abteilung'), t('stat.defekte'), t('stat.ausfalltage'), t('stat.kosten') + ' (' + WAEHRUNG + ')', t('stat.alter'), t('stat.defekteProJahr')],
      gs.map((r, i) => [i + 1, r.geraet.name, r.geraet.model, r.geraet.manufacturer, r.geraet.location, r.geraet.department, r.defekte, r.ausfalltage, f1(r.kosten), f1(r.alterJahre), f1(r.defekteProBetriebsjahr)]));
  });
  $('#csv-dimension').addEventListener('click', () => {
    const dim = $('#stat-dimension').value;
    const ds2 = statDimension(daten.devices, statFilter(), dim);
    exportiereCSV(`ausfallquote-${dim}.csv`,
      [t('dim.' + dim), t('stat.geraete'), t('stat.defekte'), t('stat.defekteProGeraet'), t('stat.defekteProJahr'), t('stat.ausfalltage'), t('stat.oAusfall'), t('stat.kosten') + ' (' + WAEHRUNG + ')'],
      ds2.map((s) => [s.name, s.geraete, s.defekte, f1(s.defekteProGeraet), f1(s.defekteProBetriebsjahr), s.ausfalltage, f1(s.mittlereAusfalldauer), f1(s.kosten)]));
  });
  $('#csv-typen').addEventListener('click', () => {
    const ts = statTypen(daten.devices, statFilter());
    exportiereCSV('vergleich-geraetetypen.csv',
      [t('dt.geraetetyp'), t('th.hersteller'), t('stat.geraete'), t('stat.defekte'), t('stat.defekteProGeraet'), t('stat.ausfalltage')],
      ts.map((s) => [s.kategorie, s.hersteller, s.geraete, s.defekte, f1(s.defekte / s.geraete), s.ausfalltage]));
  });
  $('#csv-distributor').addEventListener('click', () => {
    const ds = statDistributor(daten.devices, statFilter());
    exportiereCSV('reparaturzeit-distributoren.csv',
      [t('th.distributor'), t('stat.reparaturen'), t('stat.oRepZeit'), t('stat.repTage')],
      ds.map((s) => [s.distributor, s.reparaturen, f1(s.mittlereDauer), s.tageGesamt]));
  });
}

/* ===================== Dokumente pro Gerät ===================== */

// Kategorien werden kanonisch (deutsch) gespeichert und übersetzt angezeigt
const DOK_KATEGORIEN = {
  'Bedienungsanleitung': 'dok.kat.anleitung', 'Arbeitsanweisung (SOP)': 'dok.kat.sop',
  'Wartungsbericht': 'dok.kat.wartung', 'Zertifikat': 'dok.kat.zertifikat', 'Sonstiges': 'dok.kat.sonstiges',
};
function dokKategorieName(kat) { return DOK_KATEGORIEN[kat] ? t(DOK_KATEGORIEN[kat]) : kat; }
const DOK_ICONS = { 'Bedienungsanleitung': '📘', 'Arbeitsanweisung (SOP)': '📋', 'Wartungsbericht': '🛠', 'Zertifikat': '📜', 'Sonstiges': '📄' };
/** Max. Dateigröße für direkte Uploads (localStorage-Prototyp); größere Dokumente bitte verlinken. */
const DOK_MAX_BYTES = 2 * 1024 * 1024;

function dokGroesse(bytes) {
  if (!bytes) return '';
  return bytes > 1024 * 1024 ? (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.round(bytes / 1024) + ' KB';
}

/** Dokument öffnen: Links direkt, hochgeladene Dateien über eine Blob-URL. */
async function oeffneDokument(d) {
  if (d.typ === 'link') { window.open(d.url, '_blank'); return; }
  const blob = await (await fetch(d.url)).blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function dokumenteHtml(g) {
  const liste = (g.dokumente || []).map((d) => `
    <div class="dok-row" data-dok="${esc(d.id)}">
      <span class="dok-icon">${DOK_ICONS[d.kategorie] || '📄'}</span>
      <a href="#" class="dok-open">${esc(d.name)}</a>
      <span class="dok-meta">${esc(dokKategorieName(d.kategorie))}${d.typ === 'datei' ? ' · ' + dokGroesse(d.groesse) : ' · ' + t('dok.link')}</span>
      ${istAdmin() ? `<button type="button" class="btn btn-sm btn-danger dok-del" title="${t('dok.entfernenBtn')}">🗑</button>` : ''}
    </div>`).join('');
  return `
    <div class="detail-section">
      <h3>${t('dok.titel')}</h3>
      ${liste || `<p><small>${t('dok.keine')}</small></p>`}
      <form id="dok-form" class="dok-form">
        <select id="dok-kategorie">${Object.keys(DOK_KATEGORIEN).map((k) => `<option value="${esc(k)}">${esc(dokKategorieName(k))}</option>`).join('')}</select>
        <input type="text" id="dok-name" placeholder="${esc(t('dok.namePh'))}" maxlength="80">
        <input type="url" id="dok-url" placeholder="${esc(t('dok.urlPh'))}">
        <button type="submit" class="btn btn-sm">${t('dok.linkBtn')}</button>
        <button type="button" id="dok-datei-btn" class="btn btn-sm">${t('dok.dateiBtn')}</button>
        <input type="file" id="dok-datei" class="hidden">
      </form>
    </div>`;
}

/* ===================== Belegung / Reservierung ===================== */

/** Kommende + laufende Belegungen eines Geräts, chronologisch. */
function kommendeBelegungen(g) {
  const jetzt = new Date();
  return (g.belegungen || [])
    .filter((b) => new Date(b.bis) >= jetzt)
    .sort((a, b) => a.von.localeCompare(b.von));
}

function formatBelegZeit(b) {
  const von = new Date(b.von), bis = new Date(b.bis);
  const gleicherTag = b.von.slice(0, 10) === b.bis.slice(0, 10);
  const zeit = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${tArr('wochentage')[von.getDay()].slice(0, 2)} ${formatDatum(b.von.slice(0, 10))} ${zeit(von)}–${gleicherTag ? '' : formatDatum(b.bis.slice(0, 10)) + ' '}${zeit(bis)}`;
}

/** Überschneidung mit bestehenden Belegungen finden (oder null). */
function belegungsKonflikt(g, von, bis, ausserId) {
  return (g.belegungen || []).find((b) => b.id !== ausserId && von < b.bis && bis > b.von) || null;
}

function belegungHtml(g) {
  const jetzt = new Date();
  const liste = kommendeBelegungen(g).map((b) => {
    const laeuft = new Date(b.von) <= jetzt && jetzt <= new Date(b.bis);
    return `<div class="beleg-row ${laeuft ? 'beleg-aktiv' : ''}" data-beleg="${esc(b.id)}">
      <span class="beleg-zeit">${formatBelegZeit(b)}</span>
      <span class="beleg-info"><strong>${esc(b.wer)}</strong> · ${esc(b.zweck)}${laeuft ? ` <span class="beleg-badge">${t('beleg.laeuft')}</span>` : ''}</span>
      ${(istAdmin() || b.wer === nutzer.name) ? `<button type="button" class="btn btn-sm beleg-del">${t('beleg.stornieren')}</button>` : ''}
    </div>`;
  }).join('');
  return `
    <div class="detail-section">
      <h3>${t('beleg.titel')}</h3>
      ${liste || `<p><small>${t('beleg.frei')}</small></p>`}
      <form id="beleg-form" class="beleg-form">
        <input type="datetime-local" id="beleg-von" required>
        <input type="datetime-local" id="beleg-bis" required>
        <input type="text" id="beleg-zweck" placeholder="${esc(t('beleg.zweckPh'))}" required maxlength="80">
        <button type="submit" class="btn btn-sm btn-primary">${t('beleg.reservieren')}</button>
      </form>
    </div>`;
}

/* ===================== QR-Etiketten ===================== */

/** Deep-Link zur Detailansicht eines Geräts (Inhalt der QR-Codes). */
function qrUrl(g) {
  return location.href.split(/[?#]/)[0] + '?geraet=' + g.id;
}

function qrSvg(g) {
  const qr = qrcode(0, 'M');
  qr.addData(qrUrl(g));
  qr.make();
  return qr.createSvgTag({ cellSize: 3, margin: 2 });
}

function oeffneQrModal() {
  const liste = gefilterteListe();
  $('#qr-grid').innerHTML = liste.map((g) => `
    <div class="qr-label">
      ${qrSvg(g)}
      <div class="qr-text">
        <strong>${esc(g.name)}</strong>
        <span>${esc(g.manufacturer)} ${esc(g.model || '')}</span>
        <span>${t('zelle.inv')} ${esc(g.inventoryNo || '–')} · SN ${esc(g.serial || '–')}</span>
        <span>${esc(g.location)}${g.room ? ' · ' + t('zelle.raum') + ' ' + esc(g.room) : ''}</span>
      </div>
    </div>`).join('') || `<p class="empty-hint">${t('qr.keine')}</p>`;
  document.body.classList.add('print-qr');
  $('#modal-qr').classList.remove('hidden');
}

/* ===================== Belegungs-Übersicht (Tab) ===================== */

function renderBelegungsUebersicht() {
  const standort = $('#bel-standort').value;
  const abteilung = $('#bel-abteilung').value;
  const jetzt = new Date();
  const horizont = new Date(); horizont.setDate(horizont.getDate() + 14);
  const items = [];
  for (const g of daten.devices) {
    if (standort && g.location !== standort) continue;
    if (abteilung && g.department !== abteilung) continue;
    for (const b of g.belegungen || []) {
      if (new Date(b.bis) < jetzt || new Date(b.von) > horizont) continue;
      items.push({ g, b });
    }
  }
  items.sort((a, b) => a.b.von.localeCompare(b.b.von));
  if (!items.length) {
    $('#belegung-liste').innerHTML = `<p class="empty-hint">${t('bel.keine')}</p>`;
    return;
  }
  // Nach Tag gruppieren
  const gruppen = new Map();
  for (const i of items) {
    const d = new Date(i.b.von);
    const key = `${tArr('wochentage')[d.getDay()]}, ${formatDatum(i.b.von.slice(0, 10))}`;
    if (!gruppen.has(key)) gruppen.set(key, []);
    gruppen.get(key).push(i);
  }
  const zeit = (s) => s.slice(11, 16);
  $('#belegung-liste').innerHTML = [...gruppen.entries()].map(([tag, eintraege]) => `
    <div class="kal-gruppe">
      <h2 class="kal-monat">${esc(tag)} <span class="group-count">${t('bel.belegungen', { n: eintraege.length })}</span></h2>
      ${eintraege.map((i) => {
        const laeuft = new Date(i.b.von) <= jetzt && jetzt <= new Date(i.b.bis);
        return `<div class="kal-item" data-id="${i.g.id}">
          <span class="kal-datum">${zeit(i.b.von)}–${zeit(i.b.bis)}</span>
          <span class="kal-geraet"><strong>${esc(i.g.name)}</strong> <small>· ${esc(i.g.location)}${i.g.room ? ' · ' + t('zelle.raum') + ' ' + esc(i.g.room) : ''}</small></span>
          <span class="kal-tage">${esc(i.b.wer)} · ${esc(i.b.zweck)}${laeuft ? ` <span class="beleg-badge">${t('beleg.laeuft')}</span>` : ''}</span>
          <button class="btn btn-sm">${t('zelle.details')}</button>
        </div>`;
      }).join('')}
    </div>`).join('');
  $$('#belegung-liste .kal-item').forEach((el) =>
    el.querySelector('.btn').addEventListener('click', () => oeffneDetail(Number(el.dataset.id))));
}

/* ===================== Kalender (Fälligkeiten) ===================== */

function kalenderEintraege() {
  const standort = $('#kal-standort').value;
  const abteilung = $('#kal-abteilung').value;
  const art = $('#kal-art').value;
  const items = [];
  for (const g of daten.devices) {
    if (g.status === 'ausser_betrieb') continue;
    if (standort && g.location !== standort) continue;
    if (abteilung && g.department !== abteilung) continue;
    for (const f of faelligkeiten(g)) {
      if (art && f.art !== art) continue;
      if (f.tage > 365) continue; // Horizont: 12 Monate
      items.push({ g, ...f });
    }
  }
  return items.sort((a, b) => a.tage - b.tage);
}

function renderKalender() {
  const items = kalenderEintraege();
  if (!items.length) {
    $('#kalender-liste').innerHTML = `<p class="empty-hint">${t('kal.keine')}</p>`;
    return;
  }
  // Gruppieren: Überfällig zuerst, dann pro Monat
  const gruppen = new Map();
  for (const i of items) {
    const key = i.tage < 0 ? t('kal.ueberfaellig') : (() => {
      const d = new Date(i.datum);
      return `${tArr('monate')[d.getMonth()]} ${d.getFullYear()}`;
    })();
    if (!gruppen.has(key)) gruppen.set(key, []);
    gruppen.get(key).push(i);
  }
  $('#kalender-liste').innerHTML = [...gruppen.entries()].map(([titel, eintraege]) => `
    <div class="kal-gruppe">
      <h2 class="kal-monat ${titel.startsWith('⚠') ? 'kal-overdue' : ''}">${esc(titel)} <span class="group-count">${t('kal.pruefungen', { n: eintraege.length })}</span></h2>
      ${eintraege.map((i) => `
        <div class="kal-item" data-id="${i.g.id}">
          <span class="kal-datum ${i.tage < 0 ? 'maint-overdue' : i.tage <= WARTUNG_VORLAUF_TAGE ? 'maint-soon' : ''}">${formatDatum(i.datum)}</span>
          <span class="kal-art">${esc(i.art)}</span>
          <span class="kal-geraet"><strong>${esc(i.g.name)}</strong> <small>· ${esc(i.g.location)} · ${esc(i.g.department)}</small></span>
          <span class="kal-tage">${i.tage < 0 ? `<span class="maint-overdue">${t('zelle.ueberfaelligSeit', { n: -i.tage })}</span>` : t('zelle.inTagen', { n: i.tage })}</span>
          <button class="btn btn-sm">${t('zelle.details')}</button>
        </div>`).join('')}
    </div>`).join('');
  $$('#kalender-liste .kal-item').forEach((el) =>
    el.querySelector('.btn').addEventListener('click', () => oeffneDetail(Number(el.dataset.id))));
}

/** ICS-Sonderzeichen maskieren. */
function icsText(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/[,;]/g, '\\$&').replace(/\n/g, '\\n');
}

/** Fälligkeiten als Kalenderdatei (ICS) exportieren – importierbar in Outlook & Co. */
function exportiereICS() {
  const items = kalenderEintraege();
  const zeilen = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dietz-Engineering//Geraetefuhrpark//DE',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
  ];
  for (const i of items) {
    const d = i.datum.replace(/-/g, '');
    zeilen.push(
      'BEGIN:VEVENT',
      `UID:pruefung-${i.g.id}-${encodeURIComponent(i.art)}-${d}@geraetefuhrpark`,
      `DTSTART;VALUE=DATE:${d}`,
      `SUMMARY:${icsText(`${i.art} ${t('kal.faellig')}: ${i.g.name}`)}`,
      `DESCRIPTION:${icsText(`${i.g.manufacturer} ${i.g.model || ''} · Inv. ${i.g.inventoryNo || '–'} · SN ${i.g.serial || '–'}`)}`,
      `LOCATION:${icsText(`${i.g.location}${i.g.room ? ', Raum ' + i.g.room : ''}`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(`${i.art} ${t('kal.faellig')}: ${i.g.name}`)}`,
      'TRIGGER:-P7D', 'END:VALARM',
      'END:VEVENT');
  }
  zeilen.push('END:VCALENDAR');
  const blob = new Blob([zeilen.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pruefungen-geraetefuhrpark.ics';
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Erinnerungs-E-Mail mit allen überfälligen / bald fälligen Prüfungen vorbereiten. */
function erinnerungsMail() {
  const items = kalenderEintraege().filter((i) => i.tage <= WARTUNG_VORLAUF_TAGE);
  if (!items.length) { alert(t('kal.keineFaellig')); return; }
  const liste = items.map((i) => `- ${formatDatum(i.datum)} · ${i.art} · ${i.g.name} (${i.g.location}, ${i.g.department})${i.tage < 0 ? ` – ${t('mail.ueberfaelligSeit', { n: -i.tage })}` : ''}`).join('\n');
  const body = t('mail.erinnerungText', { liste, datum: formatDatum(isoDatum(heute())) });
  location.href = `mailto:?subject=${encodeURIComponent(t('mail.erinnerungBetreff'))}&body=${encodeURIComponent(body)}`;
}

/* ===================== Cloud-Synchronisation ===================== */

/** Cloud-Stand übernehmen und Oberfläche aktualisieren. */
async function uebernehmeCloudStand(zeile) {
  if (!zeile || !zeile.daten) return;
  let d = zeile.daten;
  if (istVerschluesselt(d)) {
    if (!kryptoSchluessel) return; // noch gesperrt – nächster Abgleich nach dem Login
    try { d = await entschluessleDaten(d, kryptoSchluessel); } catch (e) { return; }
  }
  cloudStand = zeile.updated_at;
  daten = d;
  migriereDaten(daten);
  persistiereLokal(daten);
  if (nutzer) {
    renderAlles();
    if (!$('#modal-detail').classList.contains('hidden')) renderDetail();
  }
}

/**
 * Abgleich mit dem gemeinsamen Datenbestand (nur aktiv, wenn in
 * js/config.js Supabase-Zugangsdaten eingetragen sind): beim Start
 * Cloud-Stand übernehmen, danach alle 30 Sekunden auf Änderungen
 * anderer Arbeitsplätze prüfen. Eigene Änderungen werden von
 * speichereDaten() sofort hochgeladen.
 */
async function initCloudSync() {
  if (!cloudAktiv()) return;
  try {
    const zeile = await cloudLaden();
    if (zeile) await uebernehmeCloudStand(zeile);
    else if (!datenGesperrt) await cloudSpeichern(daten); // erster Start: lokalen Stand hochladen
  } catch (e) { console.warn('Cloud-Sync:', e.message); }
  setInterval(async () => {
    try {
      const zeile = await cloudLaden();
      if (zeile && zeile.updated_at !== cloudStand) await uebernehmeCloudStand(zeile);
    } catch (e) { /* offline o. ä. – nächster Versuch in 30 s */ }
  }, 30000);
}

/* ===================== Lizenzanzeige ===================== */

async function renderLizenz() {
  const info = await pruefeLizenz();
  const el = $('#lizenz-status');
  if (el) {
    if (!info) {
      el.textContent = t('lizenz.demo');
      el.className = 'lizenz-status lizenz-demo';
    } else if (info.abgelaufen) {
      el.textContent = t('lizenz.abgelaufen');
      el.className = 'lizenz-status lizenz-warn';
    } else {
      el.textContent = t('lizenz.fuer', { kunde: info.kunde, edition: info.edition, datum: formatDatum(info.gueltigBis) })
        + (info.restTage <= 30 ? ' · ' + t('lizenz.ablauf', { n: info.restTage }) : '');
      el.className = 'lizenz-status' + (info.restTage <= 30 ? ' lizenz-warn' : '');
    }
  }
  const krypto = $('#krypto-status');
  if (krypto) krypto.textContent = verschluesselungAktiv() ? t('krypto.aktiv') : '';
}

/* ===================== Navigation & Initialisierung ===================== */

function renderAlles(filterNeu = true) {
  if (filterNeu) fuelleFilterOptionen();
  renderKacheln();
  renderTabelle();
  renderBenachrichtigungen();
  if (!$('#view-statistik').classList.contains('hidden')) renderStatistik();
  if (!$('#view-kalender').classList.contains('hidden')) renderKalender();
  if (!$('#view-belegung').classList.contains('hidden')) renderBelegungsUebersicht();
}

function initEvents() {
  // Tabs
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    ['uebersicht', 'belegung', 'kalender', 'statistik'].forEach((v) =>
      $('#view-' + v).classList.toggle('hidden', tab.dataset.view !== v));
    if (tab.dataset.view === 'statistik') renderStatistik();
    if (tab.dataset.view === 'kalender') renderKalender();
    if (tab.dataset.view === 'belegung') renderBelegungsUebersicht();
  }));

  // Filter Übersicht
  $('#filter-search').addEventListener('input', (e) => { zustand.suche = e.target.value; renderTabelle(); });
  $('#filter-standort').addEventListener('change', (e) => { zustand.standort = e.target.value; renderTabelle(); });
  $('#filter-abteilung').addEventListener('change', (e) => { zustand.abteilung = e.target.value; renderTabelle(); });
  $('#filter-status').addEventListener('change', (e) => { zustand.status = e.target.value; renderTabelle(); });
  $('#filter-wartung').addEventListener('change', (e) => { zustand.wartung = e.target.value; renderTabelle(); });
  $('#group-by').addEventListener('change', (e) => {
    zustand.gruppe = e.target.value;
    zustand.eingeklappt.clear();
    renderTabelle();
  });
  $('#filter-reset').addEventListener('click', () => {
    Object.assign(zustand, { suche: '', standort: '', abteilung: '', status: '', wartung: '', gruppe: '' });
    zustand.eingeklappt.clear();
    $('#filter-search').value = '';
    ['#filter-standort', '#filter-abteilung', '#filter-status', '#filter-wartung', '#group-by'].forEach((s) => { $(s).value = ''; });
    renderTabelle();
  });

  // Sortierung
  $$('#device-table th.sortable').forEach((th) => th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (zustand.sortKey === key) zustand.sortDir *= -1;
    else { zustand.sortKey = key; zustand.sortDir = 1; }
    renderTabelle();
  }));

  // Filter Statistik
  ['#stat-zeitraum', '#stat-standort', '#stat-abteilung', '#stat-hersteller', '#stat-dimension']
    .forEach((s) => $(s).addEventListener('change', renderStatistik));

  // QR-Etiketten & Kalender
  $('#btn-qr').addEventListener('click', oeffneQrModal);
  $('#btn-ics').addEventListener('click', exportiereICS);
  $('#btn-erinnerung').addEventListener('click', erinnerungsMail);
  ['#kal-standort', '#kal-abteilung', '#kal-art'].forEach((s) =>
    $(s).addEventListener('change', renderKalender));
  ['#bel-standort', '#bel-abteilung'].forEach((s) =>
    $(s).addEventListener('change', renderBelegungsUebersicht));

  // Benachrichtigungen
  $('#notif-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#notif-panel').classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.notif-wrap')) $('#notif-panel').classList.add('hidden');
  });

  // Prüfarten-Editor: Zeile hinzufügen
  $('#pruef-add').addEventListener('click', () => {
    $('#pruef-editor').insertAdjacentHTML('beforeend', pruefEditorZeile(null));
    const row = $('#pruef-editor').lastElementChild;
    row.querySelector('.pe-del').addEventListener('click', () => row.remove());
  });

  // Modals
  $('#btn-new-device').addEventListener('click', () => oeffneFormular(null));
  $('#device-form').addEventListener('submit', speichereFormular);
  $('#btn-fields').addEventListener('click', () => {
    renderFelderListe();
    $('#modal-fields').classList.remove('hidden');
  });
  $('#field-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const label = $('#nf-label').value.trim();
    if (!label) return;
    daten.customFields.push({ id: 'cf' + daten.nextFieldId++, label, type: $('#nf-type').value });
    speichereDaten(daten);
    $('#nf-label').value = '';
    renderFelderListe();
  });
  $$('[data-close]').forEach((btn) => btn.addEventListener('click', () => {
    $('#' + btn.dataset.close).classList.add('hidden');
    if (btn.dataset.close === 'modal-qr') document.body.classList.remove('print-qr');
  }));
  $$('.modal-backdrop').forEach((bd) => bd.addEventListener('mousedown', (e) => {
    if (e.target === bd) {
      bd.classList.add('hidden');
      if (bd.id === 'modal-qr') document.body.classList.remove('print-qr');
    }
  }));

  initCsvExporte();

  // Sprachumschalter (Header + Login)
  $$('.sprach-wahl').forEach((sel) => sel.addEventListener('change', () => {
    setzeSprache(sel.value);
    if (nutzer) {
      $('#user-role').textContent = nutzer.role === 'admin' ? t('rolle.admin') : t('rolle.mitarbeiter');
      renderAlles();
      if (!$('#modal-detail').classList.contains('hidden')) renderDetail();
    }
    renderLizenz();
  }));

  // Copyright-Jahr im Footer und auf der Login-Karte
  $$('.copyright-jahr').forEach((el) => { el.textContent = new Date().getFullYear(); });

  // Ausfalldauer & Benachrichtigungen laufend aktualisieren (1× pro Minute)
  setInterval(() => { if (nutzer) renderAlles(false); }, 60000);
}

(async () => {
  wendeSprachenAn();
  initEvents();
  // Verschlüsselung: Sitzungsschlüssel wiederherstellen (Reload im selben Tab)
  if (verschluesselungAktiv() && datenGesperrt && await ladeKryptoSchluesselAusSitzung()) {
    try {
      daten = await entschluesselePersistenz();
      datenGesperrt = false;
    } catch (e) { kryptoSchluessel = null; /* Passwort erneut nötig */ }
  }
  initLogin();
  initCloudSync();
  renderLizenz();
})();
