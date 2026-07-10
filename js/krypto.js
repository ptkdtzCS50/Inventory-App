/* =====================================================================
 * Datenverschlüsselung – AES-256-GCM, Schlüssel aus dem Master-Passwort
 *
 * Aktivierung: DATEN_VERSCHLUESSELN = true in js/config.js (setzt ein
 * konfiguriertes Master-Passwort voraus). Verschlüsselt wird an der
 * Speichergrenze: localStorage UND Cloud-Payload (Supabase sieht dann
 * nur Chiffretext – "Zero-Knowledge"-Hosting).
 *
 * Schlüsselableitung: PBKDF2-SHA-256 mit 210'000 Iterationen aus dem
 * Master-Passwort. Der abgeleitete Schlüssel wird pro Browser-Sitzung
 * in der sessionStorage gehalten (beim Schließen des Tabs weg) – das
 * Passwort wird daher einmal pro Sitzung abgefragt, nicht einmal pro Gerät.
 *
 * Ehrliche Grenzen:
 * - Wer das Master-Passwort kennt, kann die Daten lesen (Schlüssel = Passwort).
 * - Das PBKDF2-Salt ist installationsübergreifend fix, damit alle
 *   Arbeitsplätze mit demselben Passwort denselben Schlüssel ableiten
 *   (nötig für den gemeinsamen Cloud-Datenbestand). Für den Produktiv-
 *   ausbau mit Supabase-Auth wird das Salt pro Mandant in der Datenbank
 *   abgelegt.
 *
 * © Dietz-Engineering · Alle Rechte vorbehalten
 * Designed by Dietz-Engineering · Initiiert von Christoph Lüttgens
 * ===================================================================== */

const KRYPTO_SESSION_KEY = 'geraetefuhrpark_schluessel';
const KRYPTO_SALT = 'geraetefuhrpark-dietz-engineering-v1';
const KRYPTO_ITERATIONEN = 210000;

/** Aktiver AES-Schlüssel dieser Sitzung (CryptoKey) oder null. */
let kryptoSchluessel = null;

/** true, wenn Verschlüsselung konfiguriert ist (Flag + Master-Passwort gesetzt). */
function verschluesselungAktiv() {
  return typeof DATEN_VERSCHLUESSELN !== 'undefined' && DATEN_VERSCHLUESSELN
    && typeof MASTER_PASSWORT_HASH !== 'undefined' && !!MASTER_PASSWORT_HASH;
}

/** AES-256-Schlüssel aus dem Master-Passwort ableiten und in der Sitzung merken. */
async function leiteKryptoSchluesselAb(passwort) {
  const basis = await crypto.subtle.importKey('raw', new TextEncoder().encode(passwort),
    'PBKDF2', false, ['deriveKey']);
  kryptoSchluessel = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode(KRYPTO_SALT), iterations: KRYPTO_ITERATIONEN, hash: 'SHA-256' },
    basis, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  try {
    const roh = await crypto.subtle.exportKey('raw', kryptoSchluessel);
    sessionStorage.setItem(KRYPTO_SESSION_KEY, btoa(String.fromCharCode(...new Uint8Array(roh))));
  } catch (e) { /* Sitzung ohne sessionStorage: Schlüssel bleibt nur im Speicher */ }
  return kryptoSchluessel;
}

/** Sitzungs-Schlüssel wiederherstellen (nach Reload im selben Tab). */
async function ladeKryptoSchluesselAusSitzung() {
  try {
    const b64 = sessionStorage.getItem(KRYPTO_SESSION_KEY);
    if (!b64) return null;
    const roh = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    kryptoSchluessel = await crypto.subtle.importKey('raw', roh, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    return kryptoSchluessel;
  } catch (e) { return null; }
}

/** Objekt verschlüsseln -> { v: 'enc1', iv, chiffre } (base64). */
async function verschluessleDaten(obj, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chiffre = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(JSON.stringify(obj)));
  return {
    v: 'enc1',
    iv: btoa(String.fromCharCode(...iv)),
    chiffre: btoa(String.fromCharCode(...new Uint8Array(chiffre))),
  };
}

/** Verschlüsseltes Paket entschlüsseln -> Objekt (wirft bei falschem Schlüssel). */
async function entschluessleDaten(paket, key) {
  const iv = Uint8Array.from(atob(paket.iv), (c) => c.charCodeAt(0));
  const chiffre = Uint8Array.from(atob(paket.chiffre), (c) => c.charCodeAt(0));
  const klartext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, chiffre);
  return JSON.parse(new TextDecoder().decode(klartext));
}

/** true, wenn ein gespeichertes Objekt ein Verschlüsselungs-Paket ist. */
function istVerschluesselt(obj) {
  return !!obj && obj.v === 'enc1' && typeof obj.chiffre === 'string';
}
