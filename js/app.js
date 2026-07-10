/* =====================================================================
 * Gerätefuhrpark – Hauptanwendung
 * Login & Rollen, Übersichtsliste, Detailansicht mit Verlauf/Chat,
 * Benachrichtigungen, Statistik-Anbindung.
 *
 * © Dietz-Engineering · Alle Rechte vorbehalten
 * Designed by Dietz-Engineering · Initiiert von Christoph Lüttgens
 * ===================================================================== */

let daten = ladeDaten();
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

const STATUS_BADGE = {
  ok: { klasse: 'b-ok', text: 'Funktionsfähig' },
  wartung: { klasse: 'b-wartung', text: 'Wartung fällig' },
  defekt: { klasse: 'b-defekt', text: 'Defekt' },
  ausser_betrieb: { klasse: 'b-ausser', text: 'Außer Betrieb' },
};
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
  if (nutzer && nutzer.name && istFreigeschaltet()) { zeigeApp(); } else { zeigeLogin(); }

  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    // Master-Passwort prüfen (nur wenn konfiguriert und noch nicht freigeschaltet)
    if (masterAktiv() && !istFreigeschaltet()) {
      const hash = await sha256Hex($('#login-passwort').value);
      if (hash !== MASTER_PASSWORT_HASH) {
        $('#passwort-fehler').classList.remove('hidden');
        $('#login-passwort').value = '';
        $('#login-passwort').focus();
        return;
      }
      localStorage.setItem(UNLOCK_KEY, MASTER_PASSWORT_HASH);
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
  // Passwortfeld nur zeigen, wenn ein Master-Passwort gesetzt und dieses Gerät noch nicht freigeschaltet ist
  $('#passwort-feld').classList.toggle('hidden', istFreigeschaltet());
  $('#passwort-fehler').classList.add('hidden');
}

function zeigeApp() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-name').textContent = nutzer.name;
  $('#user-role').textContent = nutzer.role === 'admin' ? 'Admin' : 'Mitarbeiter';
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
    const t = wartungTageVerbleibend(g);
    if (zustand.wartung === 'faellig30' && !(t !== null && t <= WARTUNG_VORLAUF_TAGE)) return false;
    if (zustand.wartung === 'ueberfaellig' && !(t !== null && t < 0)) return false;
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
    <div class="tile" data-status=""><div class="tile-num">${zaehler.gesamt}</div><div class="tile-label">Geräte gesamt</div></div>
    <div class="tile t-green" data-status="ok"><div class="tile-num">${zaehler.ok}</div><div class="tile-label">Funktionsfähig</div></div>
    <div class="tile t-yellow" data-status="wartung"><div class="tile-num">${zaehler.wartung}</div><div class="tile-label">Wartung fällig</div></div>
    <div class="tile t-red" data-status="defekt"><div class="tile-num">${zaehler.defekt}</div><div class="tile-label">Defekt</div></div>
    <div class="tile t-grey" data-status="ausser_betrieb"><div class="tile-num">${zaehler.ausser_betrieb}</div><div class="tile-label">Außer Betrieb</div></div>`;
  $$('#dashboard-tiles .tile').forEach((tile) => tile.addEventListener('click', () => {
    zustand.status = tile.dataset.status;
    $('#filter-status').value = zustand.status;
    renderTabelle();
  }));
}

function wartungZelle(g) {
  const f = naechsteFaelligkeit(g);
  if (!f) return '<small>keine Prüfungen</small>';
  const label = `${formatDatum(f.datum)} <small>(${esc(f.art)})</small>`;
  if (f.tage < 0) return `<span class="maint-overdue">${label}<br><small>überfällig seit ${-f.tage} Tagen</small></span>`;
  if (f.tage <= WARTUNG_VORLAUF_TAGE) return `<span class="maint-soon">${label}<br><small>in ${f.tage} Tagen</small></span>`;
  return `${label}<br><small>in ${f.tage} Tagen</small>`;
}

/** Betrag als Euro formatieren. */
function eur(n) {
  return (n || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

function ausfallZelle(g) {
  const t = defektTage(g);
  if (t === null) return '–';
  return `<span class="defect-days">seit ${t === 0 ? 'heute' : t + ' Tag' + (t === 1 ? '' : 'en')}</span><br><small>gemeldet ${formatDatum(g.defectSince)}</small>`;
}

function geraetZeile(g) {
  const st = STATUS_BADGE[effektiverStatus(g)];
  return `<tr data-id="${g.id}">
    <td><span class="badge ${st.klasse}">${st.text}</span></td>
    <td><span class="device-name">${esc(g.name)}</span><br><span class="device-sub">${esc(g.model || '')} · Inv. ${esc(g.inventoryNo || '–')}</span></td>
    <td>${esc(g.category)}</td>
    <td>${esc(g.location)}${g.room ? `<br><span class="device-sub">Raum ${esc(g.room)}</span>` : ''}</td>
    <td>${esc(g.department)}${g.team ? `<br><span class="device-sub">${esc(g.team)}</span>` : ''}</td>
    <td>${esc(g.manufacturer)}</td>
    <td>${wartungZelle(g)}</td>
    <td>${ausfallZelle(g)}</td>
    <td>${esc(g.distributor || '–')}<br><span class="device-sub">${esc(g.distPhone || '')}</span></td>
    <td><button class="btn btn-sm btn-detail">Details</button></td>
  </tr>`;
}

/** Anzeigename des Gruppierungswerts eines Geräts. */
function gruppenWert(g) {
  if (zustand.gruppe === 'status') return STATUS_BADGE[effektiverStatus(g)].text;
  return g[zustand.gruppe] || 'Ohne Angabe';
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
      const rang = Object.fromEntries(Object.entries(STATUS_BADGE).map(([k, v]) => [v.text, STATUS_RANG[k]]));
      keys.sort((a, b) => rang[a] - rang[b]);
    } else {
      keys.sort((a, b) => (a === 'Ohne Angabe') - (b === 'Ohne Angabe') || a.localeCompare(b, 'de'));
    }
    html = keys.map((key) => {
      const items = gruppen.get(key);
      const zu = zustand.eingeklappt.has(key);
      const defekt = items.filter((g) => effektiverStatus(g) === 'defekt').length;
      const wartung = items.filter((g) => effektiverStatus(g) === 'wartung').length;
      const hinweise = [
        defekt ? `<span class="group-alert">${defekt} defekt</span>` : '',
        wartung ? `<span class="group-warn">${wartung}× Wartung fällig</span>` : '',
      ].filter(Boolean).join(' · ');
      return `<tr class="group-row" data-group="${esc(key)}" title="Klicken zum ${zu ? 'Ausklappen' : 'Einklappen'}">
        <td colspan="10"><span class="group-toggle">${zu ? '▸' : '▾'}</span> ${esc(key)}
        <span class="group-count">${items.length} Gerät${items.length === 1 ? '' : 'e'}${hinweise ? ' · ' + hinweise : ''}</span></td></tr>`
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

function fuelleFilterOptionen() {
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
        liste.push({ id: g.id, icon: '🔴', text: `${g.name}: ${f.art} seit ${-f.tage} Tagen überfällig` });
      } else if (f.tage <= WARTUNG_VORLAUF_TAGE && g.status !== 'ausser_betrieb') {
        liste.push({ id: g.id, icon: '🟡', text: `${g.name}: ${f.art} fällig in ${f.tage} Tagen (${formatDatum(f.datum)})` });
      }
    }
    const dt = defektTage(g);
    if (dt !== null && dt >= DEFEKT_ALARM_TAGE) {
      liste.push({ id: g.id, icon: '⚠️', text: `${g.name}: seit ${dt} Tagen defekt – bitte Service-Status prüfen` });
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
    : '<div class="notif-empty">Keine offenen Hinweise 🎉</div>';
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
  const betreff = `Störungsmeldung: ${g.name}${g.model ? ' (' + g.model + ')' : ''}, SN ${g.serial || '–'}`;
  const dt = defektTage(g);
  const body = [
    'Sehr geehrte Damen und Herren,',
    '',
    'wir melden eine Störung an folgendem Gerät:',
    '',
    `Gerät:          ${g.name} – ${g.manufacturer} ${g.model || ''}`,
    `Seriennummer:   ${g.serial || '–'}`,
    `Inventarnummer: ${g.inventoryNo || '–'}`,
    `Standort:       ${g.location}${g.room ? ', Raum ' + g.room : ''}${g.department ? ' (' + g.department + ')' : ''}`,
    `Defekt seit:    ${formatDatum(g.defectSince)}${dt !== null ? ' (' + dt + ' Tag' + (dt === 1 ? '' : 'e') + ')' : ''}`,
    '',
    'Bitte melden Sie sich zur Terminabstimmung.',
    '',
    'Mit freundlichen Grüßen',
    nutzer ? nutzer.name : '',
  ].join('\n');
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
  const st = STATUS_BADGE[effektiverStatus(g)];
  const dt = defektTage(g);
  $('#detail-title').innerHTML = `${esc(g.name)} <span class="badge ${st.klasse}">${st.text}</span>`;

  const aktionen = [];
  if (g.status !== 'defekt') aktionen.push('<button class="btn btn-danger btn-status" data-aktion="defekt">⚠ Defekt melden</button>');
  if (g.status === 'defekt') aktionen.push('<button class="btn btn-status" data-aktion="repariert">✔ Repariert / wieder funktionsfähig</button>');
  if (g.status === 'defekt' && g.distEmail) aktionen.push(`<a class="btn btn-status" id="btn-service-mail" href="${serviceMailLink(g)}">✉ Service kontaktieren</a>`);
  if (g.status !== 'ausser_betrieb') aktionen.push('<button class="btn btn-status" data-aktion="ausser_betrieb">⏸ Außer Betrieb setzen</button>');
  else aktionen.push('<button class="btn btn-status" data-aktion="in_betrieb">▶ Wieder in Betrieb nehmen</button>');
  if (istAdmin()) {
    aktionen.push('<button class="btn btn-status" data-aktion="bearbeiten">✏ Bearbeiten</button>');
    aktionen.push('<button class="btn btn-danger btn-status" data-aktion="loeschen">🗑 Löschen</button>');
  }

  const logSortiert = [...g.log].sort((a, b) => b.ts - a.ts); // neueste zuerst
  const gesamtkosten = defektEreignisse(g).reduce((s, e) => s + (e.kosten || 0), 0);

  const pruefZeilen = (g.pruefungen || []).map((p, i) => {
    const nd = pruefungNaechste(p);
    const tage = nd ? tageDiff(isoDatum(heute()), nd) : null;
    const status = nd
      ? (tage < 0 ? `<span class="maint-overdue">überfällig seit ${-tage} Tagen</span>`
        : tage <= WARTUNG_VORLAUF_TAGE ? `<span class="maint-soon">in ${tage} Tagen</span>`
        : `in ${tage} Tagen`)
      : '<small>noch nie durchgeführt</small>';
    return `<tr>
      <td><strong>${esc(p.art)}</strong></td>
      <td>alle ${p.intervall} Monate</td>
      <td>${formatDatum(p.letzte)}</td>
      <td>${nd ? formatDatum(nd) : '–'}<br><small>${status}</small></td>
      <td><button type="button" class="btn btn-sm pruef-done" data-pruef="${i}">✓ durchgeführt</button></td>
    </tr>`;
  }).join('');

  $('#detail-body').innerHTML = `
    <dl class="detail-grid">
      <div><dt>Gerätetyp</dt><dd>${esc(g.category)}</dd></div>
      <div><dt>Hersteller / Modell</dt><dd>${esc(g.manufacturer)} ${esc(g.model || '')}</dd></div>
      <div><dt>Seriennummer</dt><dd>${esc(g.serial || '–')}</dd></div>
      <div><dt>Inventarnummer</dt><dd>${esc(g.inventoryNo || '–')}</dd></div>
      <div><dt>Standort</dt><dd>${esc(g.location)}${g.room ? ' · Raum ' + esc(g.room) : ''}</dd></div>
      <div><dt>Abteilung</dt><dd>${esc(g.department)}${g.team ? ' · ' + esc(g.team) : ''}</dd></div>
      <div><dt>Anschaffung</dt><dd>${formatDatum(g.purchaseDate)}</dd></div>
      <div><dt>Garantieende</dt><dd>${formatDatum(g.warrantyEnd)}</dd></div>
      <div><dt>Distributor</dt><dd>${esc(g.distributor || '–')}</dd></div>
      <div><dt>Service-Kontakt (Technik)</dt><dd>${g.distContact ? esc(g.distContact) + ' · ' : ''}${esc(g.distPhone || '–')}${g.distEmail ? ' · <a href="mailto:' + esc(g.distEmail) + '">' + esc(g.distEmail) + '</a>' : ''}</dd></div>
      <div><dt>Vertrieb / Außendienst</dt><dd>${g.salesName || g.salesPhone || g.salesEmail ? `${esc(g.salesName || '')}${g.salesPhone ? ' · ' + esc(g.salesPhone) : ''}${g.salesEmail ? ' · <a href="mailto:' + esc(g.salesEmail) + '">' + esc(g.salesEmail) + '</a>' : ''}` : '–'}</dd></div>
      <div><dt>Netzwerkadresse</dt><dd>${g.networkAddress
        ? esc(g.networkAddress) + (MONITORING_ENDPOINT
          ? ' <button type="button" class="btn btn-sm" id="btn-netcheck">Online-Status abfragen</button>'
          : ' <small>· Online-Abfrage vorbereitet (Monitoring-Dienst noch nicht angebunden)</small>')
        : '–'}</dd></div>
      ${dt !== null ? `<div><dt>Ausfalldauer</dt><dd class="defect-days">defekt seit ${dt === 0 ? 'heute' : dt + ' Tag' + (dt === 1 ? '' : 'en')} (gemeldet ${formatDatum(g.defectSince)})</dd></div>` : ''}
      <div><dt>Bisherige Defekte</dt><dd>${defektEreignisse(g).length}${gesamtkosten ? ' · Reparaturkosten gesamt: ' + eur(gesamtkosten) : ''}</dd></div>
      ${daten.customFields.map((f) => `<div><dt>${esc(f.label)}</dt><dd>${formatCustomWert(f, (g.custom || {})[f.id])}</dd></div>`).join('')}
    </dl>
    <div class="detail-section pruef-section">
      <h3>Prüfungen & Wartungen (MPBetreibV)</h3>
      ${pruefZeilen
        ? `<div class="table-wrap"><table class="pruef-table">
            <thead><tr><th>Prüfart</th><th>Intervall</th><th>Zuletzt</th><th>Nächste Fälligkeit</th><th></th></tr></thead>
            <tbody>${pruefZeilen}</tbody></table></div>`
        : '<p><small>Keine Prüfzyklen hinterlegt – über „Bearbeiten" ergänzen.</small></p>'}
    </div>
    <div class="detail-actions">${aktionen.join('')}</div>
    <div class="detail-section">
      <h3>Verlauf & Kommentare</h3>
      <form class="chat-form" id="chat-form">
        <input type="text" id="chat-input" placeholder="Update eintragen, z. B. „Techniker kontaktiert, kommt in 24 h“ …" maxlength="500">
        <button type="submit" class="btn btn-primary">Senden</button>
      </form>
      <div class="log-list">
        ${logSortiert.length ? logSortiert.map((e) => `
          <div class="log-entry ${e.type === 'system' ? 'log-system' : ''}">
            <div class="log-meta"><strong>${esc(e.author)}</strong> · ${formatZeit(e.ts)}</div>
            <div>${esc(e.text)}</div>
          </div>`).join('') : '<small>Noch keine Einträge.</small>'}
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

  // Prüfung als durchgeführt eintragen
  $$('#detail-body .pruef-done').forEach((btn) => btn.addEventListener('click', () => {
    const p = g.pruefungen[Number(btn.dataset.pruef)];
    if (!p) return;
    p.letzte = isoDatum(heute());
    systemEintrag(g, `${p.art} durchgeführt (${nutzer.name}). Nächste Fälligkeit: ${formatDatum(pruefungNaechste(p))}.`);
    speichereDaten(daten);
    renderDetail();
    renderAlles(false);
  }));

  // Störungs-E-Mail: Klick im Verlauf dokumentieren (mailto öffnet das Mailprogramm)
  const mailBtn = $('#btn-service-mail');
  if (mailBtn) mailBtn.addEventListener('click', () => {
    systemEintrag(g, `Störungs-E-Mail an ${g.distEmail} vorbereitet (${nutzer.name}).`);
    speichereDaten(daten);
    setTimeout(renderDetail, 300);
  });

  // Online-Statusabfrage (nur aktiv, wenn ein Monitoring-Dienst konfiguriert ist)
  const netBtn = $('#btn-netcheck');
  if (netBtn) netBtn.addEventListener('click', async () => {
    netBtn.disabled = true;
    netBtn.textContent = 'Frage ab …';
    try {
      const s = await frageGeraeteStatusAb(g);
      alert(s.erreichbar === null
        ? 'Monitoring nicht konfiguriert.'
        : `${g.name} ist derzeit ${s.erreichbar ? 'ERREICHBAR' : 'NICHT ERREICHBAR'} (geprüft: ${s.geprueft ? formatZeit(new Date(s.geprueft).getTime()) : 'jetzt'}).`);
    } catch (e) {
      alert('Abfrage fehlgeschlagen: ' + e.message);
    }
    renderDetail();
  });
}

function statusAktion(g, aktion) {
  const alterStatus = STATUS_BADGE[effektiverStatus(g)].text;
  switch (aktion) {
    case 'defekt': {
      const grund = prompt('Kurze Beschreibung des Defekts:');
      if (grund === null) return;
      g.status = 'defekt';
      g.defectSince = isoDatum(heute());
      systemEintrag(g, `Status geändert: ${alterStatus} → Defekt (${nutzer.name}).${grund ? ' Grund: ' + grund : ''}`);
      break;
    }
    case 'repariert': {
      // Reparaturkosten optional erfassen (fließen in die Statistik ein)
      let kosten = null;
      const eingabe = prompt('Reparaturkosten in € (optional, leer lassen wenn unbekannt/kostenfrei):');
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
      systemEintrag(g, `Status geändert: Defekt → Funktionsfähig (${nutzer.name}). Ausfalldauer: ${dauer} Tag${dauer === 1 ? '' : 'e'}.${kosten !== null ? ' Reparaturkosten: ' + eur(kosten) + '.' : ''}`);
      break;
    }
    case 'ausser_betrieb': {
      if (g.status === 'defekt' && g.defectSince) {
        g.defectHistory = g.defectHistory || [];
        g.defectHistory.push({ start: g.defectSince, end: isoDatum(heute()) });
        g.defectSince = null;
      }
      g.status = 'ausser_betrieb';
      systemEintrag(g, `Status geändert: ${alterStatus} → Außer Betrieb (${nutzer.name}).`);
      break;
    }
    case 'in_betrieb': {
      g.status = 'ok';
      systemEintrag(g, `Status geändert: Außer Betrieb → Funktionsfähig (${nutzer.name}).`);
      break;
    }
    case 'bearbeiten': {
      $('#modal-detail').classList.add('hidden');
      oeffneFormular(g);
      return;
    }
    case 'loeschen': {
      if (!confirm(`Gerät „${g.name}“ wirklich löschen? Die gesamte Historie geht verloren.`)) return;
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

const FELD_TYP_NAME = { text: 'Text', number: 'Zahl', date: 'Datum' };

function renderFelderListe() {
  const liste = daten.customFields;
  $('#fields-list').innerHTML = liste.length
    ? liste.map((f) => `
      <div class="field-row" data-id="${esc(f.id)}">
        <span class="field-label">${esc(f.label)}</span>
        <span class="field-type">${FELD_TYP_NAME[f.type] || f.type}</span>
        <button type="button" class="btn btn-sm btn-danger field-del">Entfernen</button>
      </div>`).join('')
    : '<p class="empty-hint">Noch keine eigenen Felder definiert.</p>';

  $$('#fields-list .field-del').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.closest('.field-row').dataset.id;
    const f = daten.customFields.find((x) => x.id === id);
    if (!confirm(`Feld „${f.label}“ entfernen?\nBereits eingetragene Werte bleiben gespeichert, werden aber nicht mehr angezeigt.`)) return;
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
    <input type="text" class="pe-art" list="dl-pruefart" placeholder="Prüfart" value="${esc(p?.art || '')}" maxlength="30">
    <input type="number" class="pe-intervall" min="1" max="120" placeholder="Monate" value="${p?.intervall || ''}">
    <input type="date" class="pe-letzte" title="Zuletzt durchgeführt" value="${p?.letzte || ''}">
    <button type="button" class="btn btn-sm pe-del" title="Prüfart entfernen">✕</button>
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
  $('#form-title').textContent = g ? 'Gerät bearbeiten' : 'Neues Gerät';
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
    systemEintrag(g, `Stammdaten bearbeitet (${nutzer.name}).`);
  } else {
    const g = {
      id: daten.nextId++, ...felder,
      status: 'ok', defectSince: null, defectHistory: [], log: [],
    };
    systemEintrag(g, `Gerät angelegt (${nutzer.name}).`);
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
    <div class="tile"><div class="tile-num">${geraete.length}</div><div class="tile-label">Geräte im Filter</div></div>
    <div class="tile t-red"><div class="tile-num">${events.length}</div><div class="tile-label">Defekte im Zeitraum</div></div>
    <div class="tile t-yellow"><div class="tile-num">${ausfalltage}</div><div class="tile-label">Ausfalltage gesamt</div></div>
    <div class="tile"><div class="tile-num">${f1(mittlereRep)}</div><div class="tile-label">Ø Reparaturzeit (Tage)</div></div>
    <div class="tile t-red"><div class="tile-num">${eur(kostenGesamt)}</div><div class="tile-label">Reparaturkosten im Zeitraum</div></div>`;

  balkendiagramm($('#chart-monat'), statMonatsverlauf(daten.devices, filter));

  // --- Hersteller ---
  const hs = statHersteller(daten.devices, filter);
  $('#table-hersteller').innerHTML = `
    <thead><tr><th>Hersteller</th><th class="num">Geräte</th><th class="num">Defekte</th>
    <th class="num">Defekte / Gerät</th><th class="num">Defekte / Betriebsjahr</th>
    <th class="num">Ausfalltage</th><th class="num">Ø Ausfalldauer</th><th class="num">Reparaturkosten</th></tr></thead><tbody>` +
    hs.map((s, i) => `<tr>
      <td class="${i === 0 && s.defekte > 0 ? 'rank-1' : ''}">${esc(s.hersteller)}</td>
      <td class="num">${s.geraete}</td><td class="num">${s.defekte}</td>
      <td class="num">${f1(s.defekteProGeraet)}</td><td class="num">${f1(s.defekteProBetriebsjahr)}</td>
      <td class="num">${s.ausfalltage}</td><td class="num">${f1(s.mittlereAusfalldauer)} Tage</td>
      <td class="num">${eur(s.kosten)}</td>
    </tr>`).join('') + '</tbody>';

  // --- Ausfallquote nach Dimension (Standort/Abteilung/Team/Raum) ---
  const DIM_NAMEN = { location: 'Standort', department: 'Abteilung', team: 'Team', room: 'Raum' };
  const dim = $('#stat-dimension').value;
  $('#dim-titel').textContent = DIM_NAMEN[dim];
  const ds2 = statDimension(daten.devices, filter, dim);
  $('#table-dimension').innerHTML = `
    <thead><tr><th>${DIM_NAMEN[dim]}</th><th class="num">Geräte</th><th class="num">Defekte</th>
    <th class="num">Defekte / Gerät</th><th class="num">Defekte / Betriebsjahr</th>
    <th class="num">Ausfalltage</th><th class="num">Ø Ausfalldauer</th><th class="num">Reparaturkosten</th></tr></thead><tbody>` +
    ds2.map((s, i) => `<tr>
      <td class="${i === 0 && s.defekte > 0 ? 'rank-1' : ''}">${esc(s.name)}</td>
      <td class="num">${s.geraete}</td><td class="num">${s.defekte}</td>
      <td class="num">${f1(s.defekteProGeraet)}</td><td class="num">${f1(s.defekteProBetriebsjahr)}</td>
      <td class="num">${s.ausfalltage}</td><td class="num">${f1(s.mittlereAusfalldauer)} Tage</td>
      <td class="num">${eur(s.kosten)}</td>
    </tr>`).join('') + '</tbody>';

  // --- Top-Ausfallgeräte ---
  const gs = statGeraete(daten.devices, filter);
  $('#table-geraete').innerHTML = `
    <thead><tr><th>#</th><th>Gerät</th><th>Hersteller</th><th>Standort</th>
    <th class="num">Defekte</th><th class="num">Ausfalltage</th><th class="num">Reparaturkosten</th><th class="num">Alter (Jahre)</th><th class="num">Defekte / Betriebsjahr</th></tr></thead><tbody>` +
    (gs.length ? gs.map((r, i) => `<tr>
      <td class="${i === 0 ? 'rank-1' : ''}">${i + 1}</td>
      <td>${esc(r.geraet.name)}<br><small>${esc(r.geraet.model || '')} · ${esc(r.geraet.department)}</small></td>
      <td>${esc(r.geraet.manufacturer)}</td><td>${esc(r.geraet.location)}</td>
      <td class="num">${r.defekte}</td><td class="num">${r.ausfalltage}</td>
      <td class="num">${eur(r.kosten)}</td>
      <td class="num">${f1(r.alterJahre)}</td><td class="num">${f1(r.defekteProBetriebsjahr)}</td>
    </tr>`).join('') : '<tr><td colspan="9"><small>Keine Defekte im gewählten Zeitraum.</small></td></tr>') + '</tbody>';

  // --- Gerätetypen ---
  const ts = statTypen(daten.devices, filter);
  $('#table-typen').innerHTML = `
    <thead><tr><th>Gerätetyp</th><th>Hersteller</th><th class="num">Geräte</th>
    <th class="num">Defekte</th><th class="num">Defekte / Gerät</th><th class="num">Ausfalltage</th></tr></thead><tbody>` +
    ts.map((s) => `<tr>
      <td>${esc(s.kategorie)}</td><td>${esc(s.hersteller)}</td>
      <td class="num">${s.geraete}</td><td class="num">${s.defekte}</td>
      <td class="num">${f1(s.defekte / s.geraete)}</td><td class="num">${s.ausfalltage}</td>
    </tr>`).join('') + '</tbody>';

  // --- Distributoren ---
  const ds = statDistributor(daten.devices, filter);
  $('#table-distributor').innerHTML = `
    <thead><tr><th>Distributor</th><th class="num">Abgeschlossene Reparaturen</th>
    <th class="num">Ø Reparaturzeit</th><th class="num">Reparaturtage gesamt</th></tr></thead><tbody>` +
    (ds.length ? ds.map((s) => `<tr>
      <td>${esc(s.distributor)}</td><td class="num">${s.reparaturen}</td>
      <td class="num">${f1(s.mittlereDauer)} Tage</td><td class="num">${s.tageGesamt}</td>
    </tr>`).join('') : '<tr><td colspan="4"><small>Keine abgeschlossenen Reparaturen im Zeitraum.</small></td></tr>') + '</tbody>';
}

function initCsvExporte() {
  $('#csv-hersteller').addEventListener('click', () => {
    const hs = statHersteller(daten.devices, statFilter());
    exportiereCSV('ausfallstatistik-hersteller.csv',
      ['Hersteller', 'Geräte', 'Defekte', 'Defekte pro Gerät', 'Defekte pro Betriebsjahr', 'Ausfalltage', 'Mittlere Ausfalldauer (Tage)', 'Reparaturkosten (EUR)'],
      hs.map((s) => [s.hersteller, s.geraete, s.defekte, f1(s.defekteProGeraet), f1(s.defekteProBetriebsjahr), s.ausfalltage, f1(s.mittlereAusfalldauer), f1(s.kosten)]));
  });
  $('#csv-geraete').addEventListener('click', () => {
    const gs = statGeraete(daten.devices, statFilter());
    exportiereCSV('top-ausfallgeraete.csv',
      ['Rang', 'Gerät', 'Modell', 'Hersteller', 'Standort', 'Abteilung', 'Defekte', 'Ausfalltage', 'Reparaturkosten (EUR)', 'Alter (Jahre)', 'Defekte pro Betriebsjahr'],
      gs.map((r, i) => [i + 1, r.geraet.name, r.geraet.model, r.geraet.manufacturer, r.geraet.location, r.geraet.department, r.defekte, r.ausfalltage, f1(r.kosten), f1(r.alterJahre), f1(r.defekteProBetriebsjahr)]));
  });
  $('#csv-dimension').addEventListener('click', () => {
    const DIM_NAMEN = { location: 'Standort', department: 'Abteilung', team: 'Team', room: 'Raum' };
    const dim = $('#stat-dimension').value;
    const ds2 = statDimension(daten.devices, statFilter(), dim);
    exportiereCSV(`ausfallquote-${DIM_NAMEN[dim].toLowerCase()}.csv`,
      [DIM_NAMEN[dim], 'Geräte', 'Defekte', 'Defekte pro Gerät', 'Defekte pro Betriebsjahr', 'Ausfalltage', 'Mittlere Ausfalldauer (Tage)', 'Reparaturkosten (EUR)'],
      ds2.map((s) => [s.name, s.geraete, s.defekte, f1(s.defekteProGeraet), f1(s.defekteProBetriebsjahr), s.ausfalltage, f1(s.mittlereAusfalldauer), f1(s.kosten)]));
  });
  $('#csv-typen').addEventListener('click', () => {
    const ts = statTypen(daten.devices, statFilter());
    exportiereCSV('vergleich-geraetetypen.csv',
      ['Gerätetyp', 'Hersteller', 'Geräte', 'Defekte', 'Defekte pro Gerät', 'Ausfalltage'],
      ts.map((s) => [s.kategorie, s.hersteller, s.geraete, s.defekte, f1(s.defekte / s.geraete), s.ausfalltage]));
  });
  $('#csv-distributor').addEventListener('click', () => {
    const ds = statDistributor(daten.devices, statFilter());
    exportiereCSV('reparaturzeit-distributoren.csv',
      ['Distributor', 'Abgeschlossene Reparaturen', 'Mittlere Reparaturzeit (Tage)', 'Reparaturtage gesamt'],
      ds.map((s) => [s.distributor, s.reparaturen, f1(s.mittlereDauer), s.tageGesamt]));
  });
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
        <span>Inv. ${esc(g.inventoryNo || '–')} · SN ${esc(g.serial || '–')}</span>
        <span>${esc(g.location)}${g.room ? ' · Raum ' + esc(g.room) : ''}</span>
      </div>
    </div>`).join('') || '<p class="empty-hint">Keine Geräte im aktuellen Filter.</p>';
  document.body.classList.add('print-qr');
  $('#modal-qr').classList.remove('hidden');
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

const MONATSNAMEN = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function renderKalender() {
  const items = kalenderEintraege();
  if (!items.length) {
    $('#kalender-liste').innerHTML = '<p class="empty-hint">Keine anstehenden Prüfungen im gewählten Filter. 🎉</p>';
    return;
  }
  // Gruppieren: Überfällig zuerst, dann pro Monat
  const gruppen = new Map();
  for (const i of items) {
    const key = i.tage < 0 ? '⚠ Überfällig' : (() => {
      const d = new Date(i.datum);
      return `${MONATSNAMEN[d.getMonth()]} ${d.getFullYear()}`;
    })();
    if (!gruppen.has(key)) gruppen.set(key, []);
    gruppen.get(key).push(i);
  }
  $('#kalender-liste').innerHTML = [...gruppen.entries()].map(([titel, eintraege]) => `
    <div class="kal-gruppe">
      <h2 class="kal-monat ${titel.startsWith('⚠') ? 'kal-overdue' : ''}">${esc(titel)} <span class="group-count">${eintraege.length} Prüfung${eintraege.length === 1 ? '' : 'en'}</span></h2>
      ${eintraege.map((i) => `
        <div class="kal-item" data-id="${i.g.id}">
          <span class="kal-datum ${i.tage < 0 ? 'maint-overdue' : i.tage <= WARTUNG_VORLAUF_TAGE ? 'maint-soon' : ''}">${formatDatum(i.datum)}</span>
          <span class="kal-art">${esc(i.art)}</span>
          <span class="kal-geraet"><strong>${esc(i.g.name)}</strong> <small>· ${esc(i.g.location)} · ${esc(i.g.department)}</small></span>
          <span class="kal-tage">${i.tage < 0 ? `<span class="maint-overdue">seit ${-i.tage} Tagen überfällig</span>` : `in ${i.tage} Tagen`}</span>
          <button class="btn btn-sm">Details</button>
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
      `SUMMARY:${icsText(`${i.art} fällig: ${i.g.name}`)}`,
      `DESCRIPTION:${icsText(`${i.g.manufacturer} ${i.g.model || ''} · Inv. ${i.g.inventoryNo || '–'} · SN ${i.g.serial || '–'}`)}`,
      `LOCATION:${icsText(`${i.g.location}${i.g.room ? ', Raum ' + i.g.room : ''}`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(`${i.art} fällig: ${i.g.name}`)}`,
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
  if (!items.length) { alert('Aktuell sind keine Prüfungen fällig oder bald fällig. 🎉'); return; }
  const body = [
    'Hallo zusammen,', '',
    'folgende Prüfungen/Wartungen sind überfällig oder werden in den nächsten 30 Tagen fällig:', '',
    ...items.map((i) => `- ${formatDatum(i.datum)} · ${i.art} · ${i.g.name} (${i.g.location}, ${i.g.department})${i.tage < 0 ? ` – ÜBERFÄLLIG seit ${-i.tage} Tagen` : ''}`),
    '', `Stand: ${formatDatum(isoDatum(heute()))} · Gerätefuhrpark Pathologisches Institut`,
  ].join('\n');
  location.href = `mailto:?subject=${encodeURIComponent('Fällige Prüfungen Gerätefuhrpark')}&body=${encodeURIComponent(body)}`;
}

/* ===================== Cloud-Synchronisation ===================== */

/** Cloud-Stand übernehmen und Oberfläche aktualisieren. */
function uebernehmeCloudStand(zeile) {
  if (!zeile || !zeile.daten) return;
  cloudStand = zeile.updated_at;
  daten = zeile.daten;
  migriereDaten(daten);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(daten));
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
    if (zeile) uebernehmeCloudStand(zeile);
    else await cloudSpeichern(daten); // erster Start: lokalen Stand hochladen
  } catch (e) { console.warn('Cloud-Sync:', e.message); }
  setInterval(async () => {
    try {
      const zeile = await cloudLaden();
      if (zeile && zeile.updated_at !== cloudStand) uebernehmeCloudStand(zeile);
    } catch (e) { /* offline o. ä. – nächster Versuch in 30 s */ }
  }, 30000);
}

/* ===================== Navigation & Initialisierung ===================== */

function renderAlles(filterNeu = true) {
  if (filterNeu) fuelleFilterOptionen();
  renderKacheln();
  renderTabelle();
  renderBenachrichtigungen();
  if (!$('#view-statistik').classList.contains('hidden')) renderStatistik();
  if (!$('#view-kalender').classList.contains('hidden')) renderKalender();
}

function initEvents() {
  // Tabs
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    ['uebersicht', 'kalender', 'statistik'].forEach((v) =>
      $('#view-' + v).classList.toggle('hidden', tab.dataset.view !== v));
    if (tab.dataset.view === 'statistik') renderStatistik();
    if (tab.dataset.view === 'kalender') renderKalender();
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

  // Copyright-Jahr im Footer und auf der Login-Karte
  $$('.copyright-jahr').forEach((el) => { el.textContent = new Date().getFullYear(); });

  // Ausfalldauer & Benachrichtigungen laufend aktualisieren (1× pro Minute)
  setInterval(() => { if (nutzer) renderAlles(false); }, 60000);
}

initEvents();
initLogin();
initCloudSync();
