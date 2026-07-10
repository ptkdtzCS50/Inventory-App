/* =====================================================================
 * Statistik & Auswertung (Punkt 7)
 * Alle Auswertungen arbeiten auf Defekt-Ereignissen (defektEreignisse)
 * und werden über die Statistik-Filter (Zeitraum, Standort, Abteilung,
 * Hersteller) eingegrenzt.
 *
 * © Dietz-Engineering · Alle Rechte vorbehalten
 * Designed by Dietz-Engineering · Initiiert von Christoph Lüttgens
 * ===================================================================== */

/** Betriebsjahre eines Geräts seit Anschaffung (min. 0.1, damit nichts durch 0 geteilt wird). */
function betriebsjahre(g) {
  if (!g.purchaseDate) return 1;
  return Math.max(0.1, tageDiff(g.purchaseDate, Date.now()) / 365.25);
}

/**
 * Defekt-Ereignisse aller Geräte, gefiltert.
 * filter: { monate: 0|6|12|24, standort, abteilung, hersteller }
 * -> [{ geraet, start, end|null, dauerTage }]
 */
function gefilterteEreignisse(devices, filter) {
  const grenze = filter.monate > 0 ? new Date(monateVor(filter.monate)) : null;
  const events = [];
  for (const g of devices) {
    if (filter.standort && g.location !== filter.standort) continue;
    if (filter.abteilung && g.department !== filter.abteilung) continue;
    if (filter.hersteller && g.manufacturer !== filter.hersteller) continue;
    for (const e of defektEreignisse(g)) {
      if (grenze && new Date(e.start) < grenze) continue;
      events.push({ geraet: g, ...e });
    }
  }
  return events;
}

/** Geräte, die den Statistik-Filtern (ohne Zeitraum) entsprechen. */
function gefilterteGeraete(devices, filter) {
  return devices.filter((g) =>
    (!filter.standort || g.location === filter.standort) &&
    (!filter.abteilung || g.department === filter.abteilung) &&
    (!filter.hersteller || g.manufacturer === filter.hersteller));
}

/* ---------- Auswertungen ---------- */

/** Ausfallstatistik pro Hersteller, normalisiert auf Bestand und Betriebsjahre. */
function statHersteller(devices, filter) {
  const geraete = gefilterteGeraete(devices, filter);
  const events = gefilterteEreignisse(devices, filter);
  const map = new Map();
  for (const g of geraete) {
    if (!map.has(g.manufacturer)) {
      map.set(g.manufacturer, { hersteller: g.manufacturer, geraete: 0, jahre: 0, defekte: 0, ausfalltage: 0 });
    }
    const s = map.get(g.manufacturer);
    s.geraete++;
    s.jahre += betriebsjahre(g);
  }
  for (const e of events) {
    const s = map.get(e.geraet.manufacturer);
    if (!s) continue;
    s.defekte++;
    s.ausfalltage += e.dauerTage;
  }
  return [...map.values()]
    .map((s) => ({
      ...s,
      defekteProGeraet: s.defekte / s.geraete,
      defekteProBetriebsjahr: s.defekte / s.jahre,
      mittlereAusfalldauer: s.defekte ? s.ausfalltage / s.defekte : 0,
    }))
    .sort((a, b) => b.defekteProGeraet - a.defekteProGeraet);
}

/** Rangliste der Top-Ausfallgeräte. */
function statGeraete(devices, filter) {
  const geraete = gefilterteGeraete(devices, filter);
  const grenze = filter.monate > 0 ? new Date(monateVor(filter.monate)) : null;
  return geraete
    .map((g) => {
      const events = defektEreignisse(g).filter((e) => !grenze || new Date(e.start) >= grenze);
      return {
        geraet: g,
        defekte: events.length,
        ausfalltage: events.reduce((s, e) => s + e.dauerTage, 0),
        alterJahre: betriebsjahre(g),
        defekteProBetriebsjahr: events.length / betriebsjahre(g),
      };
    })
    .filter((r) => r.defekte > 0)
    .sort((a, b) => b.defekte - a.defekte || b.ausfalltage - a.ausfalltage);
}

/** Vergleich nach Gerätetyp: Kategorie × Hersteller. */
function statTypen(devices, filter) {
  const geraete = gefilterteGeraete(devices, filter);
  const grenze = filter.monate > 0 ? new Date(monateVor(filter.monate)) : null;
  const map = new Map();
  for (const g of geraete) {
    const key = `${g.category}||${g.manufacturer}`;
    if (!map.has(key)) map.set(key, { kategorie: g.category, hersteller: g.manufacturer, geraete: 0, defekte: 0, ausfalltage: 0 });
    const s = map.get(key);
    s.geraete++;
    for (const e of defektEreignisse(g)) {
      if (grenze && new Date(e.start) < grenze) continue;
      s.defekte++;
      s.ausfalltage += e.dauerTage;
    }
  }
  return [...map.values()].sort((a, b) =>
    a.kategorie.localeCompare(b.kategorie, 'de') || (b.defekte / b.geraete) - (a.defekte / a.geraete));
}

/** Reparaturzeit pro Distributor (nur abgeschlossene Reparaturen). */
function statDistributor(devices, filter) {
  const events = gefilterteEreignisse(devices, filter).filter((e) => e.end);
  const map = new Map();
  for (const e of events) {
    const name = e.geraet.distributor || 'Unbekannt';
    if (!map.has(name)) map.set(name, { distributor: name, reparaturen: 0, tageGesamt: 0 });
    const s = map.get(name);
    s.reparaturen++;
    s.tageGesamt += e.dauerTage;
  }
  return [...map.values()]
    .map((s) => ({ ...s, mittlereDauer: s.tageGesamt / s.reparaturen }))
    .sort((a, b) => a.mittlereDauer - b.mittlereDauer);
}

/** Defekte pro Monat für die letzten n Monate -> [{ label, value }]. */
function statMonatsverlauf(devices, filter) {
  const n = filter.monate > 0 ? filter.monate : 24;
  const events = gefilterteEreignisse(devices, { ...filter, monate: n });
  const buckets = [];
  const d = heute();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    buckets.push({
      key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`,
      label: `${String(m.getMonth() + 1).padStart(2, '0')}/${String(m.getFullYear()).slice(2)}`,
      value: 0,
    });
  }
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  for (const e of events) {
    const key = e.start.slice(0, 7);
    if (idx.has(key)) buckets[idx.get(key)].value++;
  }
  return buckets;
}

/* ---------- Balkendiagramm (SVG, ohne externe Bibliothek) ---------- */

function balkendiagramm(container, daten) {
  const barW = 34, gap = 10, padL = 30, padB = 26, padT = 20, h = 200;
  const w = padL + daten.length * (barW + gap) + 10;
  const max = Math.max(1, ...daten.map((d) => d.value));
  const skala = (h - padT - padB) / max;
  let svg = `<svg width="${w}" height="${h}" role="img" aria-label="Defekte pro Monat">`;
  // Grundlinie
  svg += `<line x1="${padL}" y1="${h - padB}" x2="${w - 5}" y2="${h - padB}" stroke="#d1d5db"/>`;
  daten.forEach((d, i) => {
    const x = padL + i * (barW + gap);
    const bh = Math.round(d.value * skala);
    const y = h - padB - bh;
    if (d.value > 0) {
      svg += `<rect class="bar-rect" x="${x}" y="${y}" width="${barW}" height="${bh}" rx="3"><title>${d.label}: ${d.value} Defekt(e)</title></rect>`;
      svg += `<text class="chart-value" x="${x + barW / 2}" y="${y - 5}" text-anchor="middle">${d.value}</text>`;
    }
    svg += `<text class="chart-axis" x="${x + barW / 2}" y="${h - padB + 15}" text-anchor="middle">${d.label}</text>`;
  });
  svg += '</svg>';
  container.innerHTML = svg;
}

/* ---------- CSV-Export ---------- */

function exportiereCSV(dateiname, kopf, zeilen) {
  const escape = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Semikolon als Trennzeichen + BOM, damit deutsches Excel die Datei direkt korrekt öffnet
  const inhalt = '﻿' + [kopf, ...zeilen].map((z) => z.map(escape).join(';')).join('\r\n');
  const blob = new Blob([inhalt], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = dateiname;
  a.click();
  URL.revokeObjectURL(a.href);
}
