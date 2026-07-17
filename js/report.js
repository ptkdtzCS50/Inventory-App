/* =====================================================================
 * Geräte-Report – konfigurierbare Liste mit Export (Excel / PDF / CSV)
 * Nutzt die globalen Helfer aus data.js (aktiveGeraete, effektiverStatus,
 * naechsteFaelligkeit, formatDatum, t) sowie die Vendor-Libs XLSX & jsPDF.
 * © Dietz-Engineering
 * ===================================================================== */
(function () {
  'use strict';

  const EMPTY = '–';
  const val = (s) => {
    const x = s == null ? '' : String(s).trim();
    return x === '' ? EMPTY : x;
  };

  function statusLabel(g) { return t('status.' + effektiverStatus(g)); }

  function pruefStatusText(g) {
    const f = naechsteFaelligkeit(g);
    if (!f) return EMPTY;
    if (f.tage < 0) return 'überfällig (' + Math.abs(f.tage) + ' T)';
    if (f.tage === 0) return 'heute fällig';
    return 'in ' + f.tage + ' T';
  }

  function letzteWartung(g) {
    const w = (g.pruefungen || []).find((p) => p.art === 'Wartung');
    return w && w.letzte ? formatDatum(w.letzte) : EMPTY;
  }

  function defektSummary(g) {
    const ev = g.defectHistory || [];
    if (!ev.length) return EMPTY;
    const sum = ev.reduce((s, e) => s + (e.kosten || 0), 0);
    const k = sum > 0 ? ' · ' + sum.toLocaleString('de-CH') + ' CHF' : '';
    return ev.length + '×' + k;
  }

  // ---- Feldkatalog (parallel zu V2 report.ts) ----
  const FIELDS = [
    { key: 'name', label: 'Gerätename', group: 'Identifikation', val: (g) => val(g.name), on: true },
    { key: 'inventoryNo', label: 'Inventarnummer', group: 'Identifikation', val: (g) => val(g.inventoryNo), on: true },
    { key: 'serial', label: 'Seriennummer', group: 'Identifikation', val: (g) => val(g.serial) },
    { key: 'category', label: 'Kategorie / Typ', group: 'Einordnung', val: (g) => val(g.category) },
    { key: 'manufacturer', label: 'Hersteller', group: 'Einordnung', val: (g) => val(g.manufacturer) },
    { key: 'model', label: 'Modell', group: 'Einordnung', val: (g) => val(g.model) },
    { key: 'location', label: 'Standort', group: 'Einordnung', val: (g) => val(g.location), on: true },
    { key: 'room', label: 'Raum', group: 'Einordnung', val: (g) => val(g.room), on: true },
    { key: 'department', label: 'Abteilung', group: 'Einordnung', val: (g) => val(g.department) },
    { key: 'responsible', label: 'Verantwortlich', group: 'Einordnung', val: (g) => val(g.responsible) },
    { key: 'status', label: 'Status', group: 'Status & Wartung', val: statusLabel, on: true },
    { key: 'pruefStatus', label: 'Prüf-Fälligkeit', group: 'Status & Wartung', val: pruefStatusText, on: true },
    { key: 'nextPruefArt', label: 'Nächste Prüfung (Art)', group: 'Status & Wartung', val: (g) => { const f = naechsteFaelligkeit(g); return f ? val(f.art) : EMPTY; } },
    { key: 'nextPruefDate', label: 'Nächste Prüfung (Datum)', group: 'Status & Wartung', val: (g) => { const f = naechsteFaelligkeit(g); return f ? formatDatum(f.datum) : EMPTY; }, on: true },
    { key: 'lastPruef', label: 'Letzte Wartung', group: 'Status & Wartung', val: letzteWartung },
    { key: 'purchaseDate', label: 'Anschaffungsdatum', group: 'Weitere', val: (g) => (g.purchaseDate ? formatDatum(g.purchaseDate) : EMPTY) },
    { key: 'warrantyEnd', label: 'Garantieende', group: 'Weitere', val: (g) => (g.warrantyEnd ? formatDatum(g.warrantyEnd) : EMPTY) },
    { key: 'defectHistory', label: 'Defekthistorie', group: 'Weitere', val: defektSummary },
    { key: 'distributor', label: 'Distributor', group: 'Weitere', val: (g) => val(g.distributor) },
    { key: 'responsibleKuerzel', label: 'Kürzel', group: 'Weitere', val: (g) => val(g.responsibleKuerzel) },
  ];
  const GROUPS = ['Identifikation', 'Einordnung', 'Status & Wartung', 'Weitere'];
  const PREVIEW_LIMIT = 50;

  const state = {
    selected: new Set(FIELDS.filter((f) => f.on).map((f) => f.key)),
    site: '', overdueOnly: false, defectOnly: false, includeArchived: false,
    sortIdx: null, sortDir: 1,
  };

  function baseDevices() {
    const list = state.includeArchived ? daten.devices.slice() : aktiveGeraete();
    return list.filter((g) => {
      if (state.site && g.location !== state.site) return false;
      if (state.overdueOnly) { const wt = wartungTageVerbleibend(g); if (!(wt !== null && wt < 0)) return false; }
      if (state.defectOnly && effektiverStatus(g) !== 'defekt') return false;
      return true;
    });
  }

  function selectedFields() { return FIELDS.filter((f) => state.selected.has(f.key)); }

  function buildRows(devices, fields) { return devices.map((g) => fields.map((f) => f.val(g))); }

  function sortRows(rows) {
    if (state.sortIdx == null) return rows;
    const i = state.sortIdx, dir = state.sortDir;
    return rows.slice().sort((a, b) => String(a[i]).localeCompare(String(b[i]), 'de', { numeric: true }) * dir);
  }

  function filterSummary() {
    const parts = [];
    if (state.site) parts.push(state.site);
    if (state.overdueOnly) parts.push('nur überfällige');
    if (state.defectOnly) parts.push('nur defekte');
    if (state.includeArchived) parts.push('inkl. Archiv');
    return parts.length ? parts.join(', ') : 'Alle Geräte';
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ---- UI-Aufbau ----
  function renderControls() {
    const sites = Array.from(new Set(aktiveGeraete().map((g) => g.location).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'de'));

    const cols = GROUPS.map((grp) => {
      const items = FIELDS.filter((f) => f.group === grp).map((f) =>
        '<label class="rep-check"><input type="checkbox" data-col="' + f.key + '"' +
        (state.selected.has(f.key) ? ' checked' : '') + '> ' + esc(f.label) + '</label>'
      ).join('');
      return '<div class="rep-col"><div class="rep-grp">' + esc(grp) + '</div>' + items + '</div>';
    }).join('');

    const siteOpts = ['<option value="">Alle Standorte</option>']
      .concat(sites.map((s) => '<option value="' + esc(s) + '"' + (state.site === s ? ' selected' : '') + '>' + esc(s) + '</option>'))
      .join('');

    return '' +
      '<div class="rep-section-title">Spalten</div>' +
      '<div class="rep-cols">' + cols + '</div>' +
      '<div class="rep-section-title">Filter</div>' +
      '<div class="rep-filters">' +
      '<select id="rep-site">' + siteOpts + '</select>' +
      '<label class="rep-check"><input type="checkbox" id="rep-overdue"' + (state.overdueOnly ? ' checked' : '') + '> Nur überfällige Prüfungen</label>' +
      '<label class="rep-check"><input type="checkbox" id="rep-defect"' + (state.defectOnly ? ' checked' : '') + '> Nur defekte Geräte</label>' +
      '<label class="rep-check"><input type="checkbox" id="rep-archived"' + (state.includeArchived ? ' checked' : '') + '> Archivierte einschließen</label>' +
      '</div>' +
      '<div class="rep-section-title">Vorschau <span id="rep-count" class="rep-count"></span></div>' +
      '<div id="rep-preview" class="table-wrap rep-preview"></div>' +
      '<div class="modal-foot">' +
      '<button type="button" class="btn btn-ghost" data-close="modal-report">Schließen</button>' +
      '<button type="button" class="btn" id="rep-csv">⬇ CSV</button>' +
      '<button type="button" class="btn" id="rep-pdf">📄 PDF</button>' +
      '<button type="button" class="btn btn-primary" id="rep-xlsx">📊 Excel (.xlsx)</button>' +
      '</div>';
  }

  function renderPreview() {
    const fields = selectedFields();
    const preview = $('#rep-preview');
    const countEl = $('#rep-count');
    const devices = baseDevices();
    if (fields.length === 0) {
      preview.innerHTML = '<p class="stat-note" style="padding:16px">Bitte mindestens eine Spalte wählen.</p>';
      if (countEl) countEl.textContent = '';
      return;
    }
    const rows = sortRows(buildRows(devices, fields));
    if (countEl) countEl.textContent = '(' + rows.length + ' Geräte' + (rows.length > PREVIEW_LIMIT ? ', Vorschau ' + PREVIEW_LIMIT : '') + ')';

    const th = fields.map((f, i) => {
      const arrow = state.sortIdx === i ? (state.sortDir === 1 ? ' ▲' : ' ▼') : '';
      return '<th data-sort="' + i + '" style="cursor:pointer;white-space:nowrap">' + esc(f.label) + arrow + '</th>';
    }).join('');
    const body = rows.slice(0, PREVIEW_LIMIT).map((r) =>
      '<tr>' + r.map((c) => '<td style="white-space:nowrap">' + esc(c) + '</td>').join('') + '</tr>'
    ).join('');
    preview.innerHTML = '<table class="stat-table"><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table>';

    preview.querySelectorAll('th[data-sort]').forEach((el) => {
      el.addEventListener('click', () => {
        const i = parseInt(el.getAttribute('data-sort'), 10);
        if (state.sortIdx === i) state.sortDir *= -1; else { state.sortIdx = i; state.sortDir = 1; }
        renderPreview();
      });
    });
  }

  // ---- Exporte ----
  function currentTable() {
    const fields = selectedFields();
    const rows = sortRows(buildRows(baseDevices(), fields));
    return { header: fields.map((f) => f.label), rows: rows };
  }

  function stamp() { return isoDatum(heute()); }

  function exportXLSX() {
    const { header, rows } = currentTable();
    if (!header.length || !rows.length) return;
    const aoa = [header].concat(rows);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = header.map((h, i) => {
      let maxLen = h.length;
      for (const r of rows) maxLen = Math.max(maxLen, (r[i] || '').length);
      return { wch: Math.min(48, Math.max(10, maxLen + 2)) };
    });
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Geräte-Report');
    XLSX.writeFile(wb, 'geraete-report_' + stamp() + '.xlsx');
  }

  function accentRGB() {
    try {
      const hex = getComputedStyle(document.documentElement).getPropertyValue('--blue').trim();
      const m = /^#?([0-9a-f]{6})$/i.exec(hex);
      if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    } catch (e) { /* ignore */ }
    return [14, 116, 144]; // Fallback: --blue #0e7490
  }

  function exportPDF() {
    const { header, rows } = currentTable();
    if (!header.length || !rows.length) return;
    const jsPDFctor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    const doc = new jsPDFctor({ orientation: header.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    const accent = accentRGB();
    const dateStr = formatDatum(stamp());

    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20, 20, 20);
    doc.text('Geräte-Report', 40, 46);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110, 110, 110);
    doc.text([filterSummary(), rows.length + ' Geräte', 'Stand: ' + dateStr].join('   ·   '), 40, 62);

    doc.autoTable({
      head: [header], body: rows, startY: 78, margin: { left: 40, right: 40 },
      styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak', lineColor: [230, 230, 230], lineWidth: 0.5 },
      headStyles: { fillColor: accent, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
      alternateRowStyles: { fillColor: [240, 249, 251] },
      didDrawPage: function () {
        const h = doc.internal.pageSize.getHeight(), w = doc.internal.pageSize.getWidth();
        doc.setFontSize(8); doc.setTextColor(150, 150, 150);
        doc.text('Gerätefuhrpark · Dietz-Engineering', 40, h - 20);
        doc.text('Seite ' + doc.internal.getNumberOfPages(), w - 40, h - 20, { align: 'right' });
      },
    });
    doc.save('geraete-report_' + stamp() + '.pdf');
  }

  function exportCSVreport() {
    const { header, rows } = currentTable();
    if (!header.length || !rows.length) return;
    exportiereCSV('geraete-report_' + stamp() + '.csv', header, rows);
  }

  // ---- Öffnen / Verdrahtung ----
  function oeffneReportModal() {
    if (typeof daten === 'undefined') return;
    state.sortIdx = null; state.sortDir = 1;
    const body = $('#report-body');
    body.innerHTML = renderControls();

    body.querySelectorAll('input[data-col]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) state.selected.add(cb.getAttribute('data-col'));
        else state.selected.delete(cb.getAttribute('data-col'));
        renderPreview();
      });
    });
    $('#rep-site').addEventListener('change', (e) => { state.site = e.target.value; renderPreview(); });
    $('#rep-overdue').addEventListener('change', (e) => { state.overdueOnly = e.target.checked; renderPreview(); });
    $('#rep-defect').addEventListener('change', (e) => { state.defectOnly = e.target.checked; renderPreview(); });
    $('#rep-archived').addEventListener('change', (e) => { state.includeArchived = e.target.checked; renderPreview(); });
    $('#rep-xlsx').addEventListener('click', exportXLSX);
    $('#rep-pdf').addEventListener('click', exportPDF);
    $('#rep-csv').addEventListener('click', exportCSVreport);

    renderPreview();
    $('#modal-report').classList.remove('hidden');
  }

  // Öffnen-Button verdrahten (Schließen läuft über die generische data-close-Logik in app.js).
  window.addEventListener('DOMContentLoaded', () => {
    const btn = $('#btn-report');
    if (btn) btn.addEventListener('click', oeffneReportModal);
  });

  // Für evtl. externen Aufruf
  window.oeffneReportModal = oeffneReportModal;
})();
