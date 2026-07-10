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

function initLogin() {
  try { nutzer = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { nutzer = null; }
  if (nutzer && nutzer.name) { zeigeApp(); } else { zeigeLogin(); }

  $('#login-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
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
}

function zeigeApp() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-name').textContent = nutzer.name;
  $('#user-role').textContent = nutzer.role === 'admin' ? 'Admin' : 'Mitarbeiter';
  $$('.admin-only').forEach((el) => el.classList.toggle('hidden', nutzer.role !== 'admin'));
  renderAlles();
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
      case 'nextMaint': { const n = naechsteWartung(g); return n || '9999-12-31'; }
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
  const nw = naechsteWartung(g);
  if (!nw) return '<small>kein Intervall</small>';
  const t = wartungTageVerbleibend(g);
  if (t < 0) return `<span class="maint-overdue">${formatDatum(nw)}<br><small>überfällig seit ${-t} Tagen</small></span>`;
  if (t <= WARTUNG_VORLAUF_TAGE) return `<span class="maint-soon">${formatDatum(nw)}<br><small>in ${t} Tagen</small></span>`;
  return `${formatDatum(nw)}<br><small>in ${t} Tagen</small>`;
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
      const defekt = items.filter((g) => effektiverStatus(g) === 'defekt').length;
      const wartung = items.filter((g) => effektiverStatus(g) === 'wartung').length;
      const hinweise = [
        defekt ? `<span class="group-alert">${defekt} defekt</span>` : '',
        wartung ? `<span class="group-warn">${wartung}× Wartung fällig</span>` : '',
      ].filter(Boolean).join(' · ');
      return `<tr class="group-row"><td colspan="10">${esc(key)}
        <span class="group-count">${items.length} Gerät${items.length === 1 ? '' : 'e'}${hinweise ? ' · ' + hinweise : ''}</span></td></tr>`
        + items.map(geraetZeile).join('');
    }).join('');
  } else {
    html = liste.map(geraetZeile).join('');
  }
  $('#device-tbody').innerHTML = html;

  $$('#device-tbody tr[data-id]').forEach((tr) => {
    tr.querySelector('.btn-detail').addEventListener('click', () => oeffneDetail(Number(tr.dataset.id)));
  });

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
    const t = wartungTageVerbleibend(g);
    if (t !== null && t < 0) {
      liste.push({ id: g.id, icon: '🔴', text: `${g.name}: Wartung seit ${-t} Tagen überfällig` });
    } else if (t !== null && t <= WARTUNG_VORLAUF_TAGE && g.status !== 'ausser_betrieb') {
      liste.push({ id: g.id, icon: '🟡', text: `${g.name}: Wartung fällig in ${t} Tagen (${formatDatum(naechsteWartung(g))})` });
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
  aktionen.push('<button class="btn btn-status" data-aktion="wartung">🛠 Wartung durchgeführt</button>');
  if (g.status !== 'ausser_betrieb') aktionen.push('<button class="btn btn-status" data-aktion="ausser_betrieb">⏸ Außer Betrieb setzen</button>');
  else aktionen.push('<button class="btn btn-status" data-aktion="in_betrieb">▶ Wieder in Betrieb nehmen</button>');
  if (istAdmin()) {
    aktionen.push('<button class="btn btn-status" data-aktion="bearbeiten">✏ Bearbeiten</button>');
    aktionen.push('<button class="btn btn-danger btn-status" data-aktion="loeschen">🗑 Löschen</button>');
  }

  const nw = naechsteWartung(g);
  const logSortiert = [...g.log].sort((a, b) => b.ts - a.ts); // neueste zuerst

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
      <div><dt>Wartungsintervall</dt><dd>${g.maintenanceInterval ? 'alle ' + g.maintenanceInterval + ' Monate' : '–'}</dd></div>
      <div><dt>Letzte / nächste Wartung</dt><dd>${formatDatum(g.lastMaintenance)} / ${nw ? formatDatum(nw) : '–'}</dd></div>
      <div><dt>Distributor</dt><dd>${esc(g.distributor || '–')}</dd></div>
      <div><dt>Service-Kontakt (Technik)</dt><dd>${g.distContact ? esc(g.distContact) + ' · ' : ''}${esc(g.distPhone || '–')}${g.distEmail ? ' · <a href="mailto:' + esc(g.distEmail) + '">' + esc(g.distEmail) + '</a>' : ''}</dd></div>
      <div><dt>Vertrieb / Außendienst</dt><dd>${g.salesName || g.salesPhone || g.salesEmail ? `${esc(g.salesName || '')}${g.salesPhone ? ' · ' + esc(g.salesPhone) : ''}${g.salesEmail ? ' · <a href="mailto:' + esc(g.salesEmail) + '">' + esc(g.salesEmail) + '</a>' : ''}` : '–'}</dd></div>
      ${dt !== null ? `<div><dt>Ausfalldauer</dt><dd class="defect-days">defekt seit ${dt === 0 ? 'heute' : dt + ' Tag' + (dt === 1 ? '' : 'en')} (gemeldet ${formatDatum(g.defectSince)})</dd></div>` : ''}
      <div><dt>Bisherige Defekte</dt><dd>${defektEreignisse(g).length}</dd></div>
    </dl>
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

  $$('#detail-body .btn-status').forEach((btn) =>
    btn.addEventListener('click', () => statusAktion(g, btn.dataset.aktion)));
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
      if (g.defectSince) {
        g.defectHistory = g.defectHistory || [];
        g.defectHistory.push({ start: g.defectSince, end: isoDatum(heute()) });
      }
      const dauer = g.defectSince ? tageDiff(g.defectSince, Date.now()) : 0;
      g.status = 'ok';
      g.defectSince = null;
      systemEintrag(g, `Status geändert: Defekt → Funktionsfähig (${nutzer.name}). Ausfalldauer: ${dauer} Tag${dauer === 1 ? '' : 'e'}.`);
      break;
    }
    case 'wartung': {
      g.lastMaintenance = isoDatum(heute());
      systemEintrag(g, `Wartung durchgeführt (${nutzer.name}). Nächste Fälligkeit: ${formatDatum(naechsteWartung(g))}.`);
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

/* ===================== Formular (Admin) ===================== */

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
  $('#f-interval').value = g?.maintenanceInterval || '';
  $('#f-lastmaint').value = g?.lastMaintenance || '';
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
    maintenanceInterval: $('#f-interval').value ? Number($('#f-interval').value) : null,
    lastMaintenance: $('#f-lastmaint').value || null,
  };
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
  const mittlereRep = abgeschlossen.length
    ? abgeschlossen.reduce((s, e) => s + e.dauerTage, 0) / abgeschlossen.length : 0;

  $('#stat-tiles').innerHTML = `
    <div class="tile"><div class="tile-num">${geraete.length}</div><div class="tile-label">Geräte im Filter</div></div>
    <div class="tile t-red"><div class="tile-num">${events.length}</div><div class="tile-label">Defekte im Zeitraum</div></div>
    <div class="tile t-yellow"><div class="tile-num">${ausfalltage}</div><div class="tile-label">Ausfalltage gesamt</div></div>
    <div class="tile"><div class="tile-num">${f1(mittlereRep)}</div><div class="tile-label">Ø Reparaturzeit (Tage)</div></div>`;

  balkendiagramm($('#chart-monat'), statMonatsverlauf(daten.devices, filter));

  // --- Hersteller ---
  const hs = statHersteller(daten.devices, filter);
  $('#table-hersteller').innerHTML = `
    <thead><tr><th>Hersteller</th><th class="num">Geräte</th><th class="num">Defekte</th>
    <th class="num">Defekte / Gerät</th><th class="num">Defekte / Betriebsjahr</th>
    <th class="num">Ausfalltage</th><th class="num">Ø Ausfalldauer</th></tr></thead><tbody>` +
    hs.map((s, i) => `<tr>
      <td class="${i === 0 && s.defekte > 0 ? 'rank-1' : ''}">${esc(s.hersteller)}</td>
      <td class="num">${s.geraete}</td><td class="num">${s.defekte}</td>
      <td class="num">${f1(s.defekteProGeraet)}</td><td class="num">${f1(s.defekteProBetriebsjahr)}</td>
      <td class="num">${s.ausfalltage}</td><td class="num">${f1(s.mittlereAusfalldauer)} Tage</td>
    </tr>`).join('') + '</tbody>';

  // --- Top-Ausfallgeräte ---
  const gs = statGeraete(daten.devices, filter);
  $('#table-geraete').innerHTML = `
    <thead><tr><th>#</th><th>Gerät</th><th>Hersteller</th><th>Standort</th>
    <th class="num">Defekte</th><th class="num">Ausfalltage</th><th class="num">Alter (Jahre)</th><th class="num">Defekte / Betriebsjahr</th></tr></thead><tbody>` +
    (gs.length ? gs.map((r, i) => `<tr>
      <td class="${i === 0 ? 'rank-1' : ''}">${i + 1}</td>
      <td>${esc(r.geraet.name)}<br><small>${esc(r.geraet.model || '')} · ${esc(r.geraet.department)}</small></td>
      <td>${esc(r.geraet.manufacturer)}</td><td>${esc(r.geraet.location)}</td>
      <td class="num">${r.defekte}</td><td class="num">${r.ausfalltage}</td>
      <td class="num">${f1(r.alterJahre)}</td><td class="num">${f1(r.defekteProBetriebsjahr)}</td>
    </tr>`).join('') : '<tr><td colspan="8"><small>Keine Defekte im gewählten Zeitraum.</small></td></tr>') + '</tbody>';

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
      ['Hersteller', 'Geräte', 'Defekte', 'Defekte pro Gerät', 'Defekte pro Betriebsjahr', 'Ausfalltage', 'Mittlere Ausfalldauer (Tage)'],
      hs.map((s) => [s.hersteller, s.geraete, s.defekte, f1(s.defekteProGeraet), f1(s.defekteProBetriebsjahr), s.ausfalltage, f1(s.mittlereAusfalldauer)]));
  });
  $('#csv-geraete').addEventListener('click', () => {
    const gs = statGeraete(daten.devices, statFilter());
    exportiereCSV('top-ausfallgeraete.csv',
      ['Rang', 'Gerät', 'Modell', 'Hersteller', 'Standort', 'Abteilung', 'Defekte', 'Ausfalltage', 'Alter (Jahre)', 'Defekte pro Betriebsjahr'],
      gs.map((r, i) => [i + 1, r.geraet.name, r.geraet.model, r.geraet.manufacturer, r.geraet.location, r.geraet.department, r.defekte, r.ausfalltage, f1(r.alterJahre), f1(r.defekteProBetriebsjahr)]));
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

/* ===================== Navigation & Initialisierung ===================== */

function renderAlles(filterNeu = true) {
  if (filterNeu) fuelleFilterOptionen();
  renderKacheln();
  renderTabelle();
  renderBenachrichtigungen();
  if (!$('#view-statistik').classList.contains('hidden')) renderStatistik();
}

function initEvents() {
  // Tabs
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('#view-uebersicht').classList.toggle('hidden', tab.dataset.view !== 'uebersicht');
    $('#view-statistik').classList.toggle('hidden', tab.dataset.view !== 'statistik');
    if (tab.dataset.view === 'statistik') renderStatistik();
  }));

  // Filter Übersicht
  $('#filter-search').addEventListener('input', (e) => { zustand.suche = e.target.value; renderTabelle(); });
  $('#filter-standort').addEventListener('change', (e) => { zustand.standort = e.target.value; renderTabelle(); });
  $('#filter-abteilung').addEventListener('change', (e) => { zustand.abteilung = e.target.value; renderTabelle(); });
  $('#filter-status').addEventListener('change', (e) => { zustand.status = e.target.value; renderTabelle(); });
  $('#filter-wartung').addEventListener('change', (e) => { zustand.wartung = e.target.value; renderTabelle(); });
  $('#group-by').addEventListener('change', (e) => { zustand.gruppe = e.target.value; renderTabelle(); });
  $('#filter-reset').addEventListener('click', () => {
    Object.assign(zustand, { suche: '', standort: '', abteilung: '', status: '', wartung: '', gruppe: '' });
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
  ['#stat-zeitraum', '#stat-standort', '#stat-abteilung', '#stat-hersteller']
    .forEach((s) => $(s).addEventListener('change', renderStatistik));

  // Benachrichtigungen
  $('#notif-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#notif-panel').classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.notif-wrap')) $('#notif-panel').classList.add('hidden');
  });

  // Modals
  $('#btn-new-device').addEventListener('click', () => oeffneFormular(null));
  $('#device-form').addEventListener('submit', speichereFormular);
  $$('[data-close]').forEach((btn) => btn.addEventListener('click', () => $('#' + btn.dataset.close).classList.add('hidden')));
  $$('.modal-backdrop').forEach((bd) => bd.addEventListener('mousedown', (e) => {
    if (e.target === bd) bd.classList.add('hidden');
  }));

  initCsvExporte();

  // Copyright-Jahr im Footer und auf der Login-Karte
  $$('.copyright-jahr').forEach((el) => { el.textContent = new Date().getFullYear(); });

  // Ausfalldauer & Benachrichtigungen laufend aktualisieren (1× pro Minute)
  setInterval(() => { if (nutzer) renderAlles(false); }, 60000);
}

initEvents();
initLogin();
