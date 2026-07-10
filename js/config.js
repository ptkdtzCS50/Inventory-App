/* =====================================================================
 * Cloud-Synchronisation (Supabase) – Konfiguration
 *
 * Solange beide Werte leer sind, arbeitet die App rein lokal
 * (localStorage des Browsers). Für einen gemeinsamen Datenbestand
 * aller Arbeitsplätze:
 *
 *   1. Kostenloses Projekt anlegen auf https://supabase.com
 *   2. Im SQL-Editor den Inhalt von supabase/schema.sql ausführen
 *   3. Unter Settings → API die Project-URL und den anon-Key kopieren
 *      und hier eintragen
 *
 * © Dietz-Engineering · Alle Rechte vorbehalten
 * Designed by Dietz-Engineering · Initiiert von Christoph Lüttgens
 * ===================================================================== */

const SUPABASE_URL = '';      // z. B. 'https://abcdefgh.supabase.co'
const SUPABASE_ANON_KEY = ''; // der öffentliche "anon"-Key des Projekts

/* ---------------------------------------------------------------------
 * Master-Passwort (Zugangsschutz vor dem Login)
 *
 * Hier steht nur der SHA-256-Hash, nie das Passwort selbst.
 * Leer lassen ('') schaltet die Abfrage ab. Das Passwort wird pro
 * Gerät/Browser nur einmal abgefragt und dann gemerkt.
 *
 * Neues Passwort setzen: Browser-Konsole (F12) öffnen und ausführen –
 *   crypto.subtle.digest('SHA-256', new TextEncoder().encode('NeuesPasswort'))
 *     .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')))
 * – und den ausgegebenen Hash hier eintragen.
 *
 * Hinweis: Das ist ein Sichtschutz für die Preview, keine echte
 * Zugriffskontrolle (der Code ist clientseitig einsehbar). Echte
 * Authentifizierung folgt mit Supabase-Auth.
 * ------------------------------------------------------------------- */

// Aktuelles Passwort: "Pathologie2026"
const MASTER_PASSWORT_HASH = '76f58bac75941400948fbd19e2cc731a28adc0baea704645aec87498f08262ad';
