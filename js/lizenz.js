/* =====================================================================
 * Lizenzprüfung – Gerätefuhrpark
 *
 * Lizenzschlüssel-Format: base64url(Nutzlast-JSON) + '.' + base64url(Signatur)
 * Die Nutzlast enthält Kunde, Edition, Gerätelimit und Ablaufdatum und ist
 * mit dem privaten ECDSA-P-256-Schlüssel von Dietz-Engineering signiert
 * (Erzeugung: tools/lizenz-generator.mjs). Die App prüft die Signatur mit
 * dem hier eingebetteten öffentlichen Schlüssel – manipulierte oder
 * selbstgebaute Schlüssel fallen durch, die App läuft dann als Demo.
 *
 * Ehrliche Einordnung: Da die Prüfung clientseitig läuft, ist sie ein
 * Lizenz-Gate wie bei klassischer Desktop-Software, kein Kopierschutz
 * gegen entschlossene Angreifer. Rechtlich bindend ist der Lizenzvertrag
 * (LICENSE); technisch verhindert das Gate versehentliche und beiläufige
 * Weiternutzung nach Ablauf.
 *
 * © Dietz-Engineering · Alle Rechte vorbehalten
 * Designed by Dietz-Engineering · Initiiert von Christoph Lüttgens
 * ===================================================================== */

/** Öffentlicher Prüfschlüssel von Dietz-Engineering (JWK, ECDSA P-256). */
const LIZENZ_PUBLIC_KEY = {
  kty: 'EC', crv: 'P-256', ext: true, key_ops: ['verify'],
  x: 'XbLTa5pPq9x2z3tbXZNL02IXpf8tgHxjTM5lP5f63_M',
  y: 'CsYUBSYQS85jc7JOzSo0phK8MVAFHstzXUXa9-bWwvA',
};

/** Ergebnis der Lizenzprüfung (null = Demo/ungültig), gesetzt von pruefeLizenz(). */
let lizenzInfo = null;

function b64urlZuBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Lizenzschlüssel prüfen.
 * -> { kunde, edition, maxGeraete, gueltigBis, abgelaufen, restTage } oder null
 */
async function pruefeLizenz() {
  try {
    const schluessel = typeof LIZENZ_SCHLUESSEL !== 'undefined' ? LIZENZ_SCHLUESSEL : '';
    if (!schluessel || !schluessel.includes('.')) return null;
    const [nutzlastB64, signaturB64] = schluessel.split('.');
    const nutzlastBytes = b64urlZuBytes(nutzlastB64);
    const key = await crypto.subtle.importKey('jwk', LIZENZ_PUBLIC_KEY,
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const gueltig = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' },
      key, b64urlZuBytes(signaturB64), nutzlastBytes);
    if (!gueltig) return null;
    const info = JSON.parse(new TextDecoder().decode(nutzlastBytes));
    const restTage = Math.floor((new Date(info.gueltigBis) - Date.now()) / 86400000);
    lizenzInfo = { ...info, restTage, abgelaufen: restTage < 0 };
    return lizenzInfo;
  } catch (e) {
    return null; // beschädigter/gefälschter Schlüssel -> Demo-Modus
  }
}

/** Gerätelimit der Lizenz (Infinity im Demo-Modus – die Demo soll nicht bremsen). */
function lizenzGeraetelimit() {
  return lizenzInfo && !lizenzInfo.abgelaufen ? lizenzInfo.maxGeraete : Infinity;
}
