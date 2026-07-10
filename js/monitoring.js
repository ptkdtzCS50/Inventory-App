/* =====================================================================
 * Netzwerk-Monitoring – VORBEREITET, noch nicht aktiv
 *
 * Die Laborgeräte hängen im Institutsnetz. Ein Browser darf aus
 * Sicherheitsgründen (Same-Origin-Policy) keine fremden Geräte direkt
 * anpingen – dafür braucht es einen kleinen Monitoring-Dienst im
 * Institutsnetz (z. B. ein Mini-Server, der die hinterlegten
 * Netzwerkadressen zyklisch anpingt).
 *
 * Sobald so ein Dienst existiert, hier nur MONITORING_ENDPOINT setzen –
 * die App zeigt dann automatisch einen "Online-Status abfragen"-Button
 * in der Gerätedetailansicht. Erwartetes API-Format:
 *
 *   GET {MONITORING_ENDPOINT}?host={networkAddress}
 *   -> { "erreichbar": true|false, "geprueft": "2026-07-10T09:30:00Z" }
 *
 * © Dietz-Engineering · Alle Rechte vorbehalten
 * Designed by Dietz-Engineering · Initiiert von Christoph Lüttgens
 * ===================================================================== */

/** URL des Monitoring-Dienstes im Institutsnetz, z. B. 'https://monitoring.patho.intern/api/status'. */
const MONITORING_ENDPOINT = null;

/**
 * Online-Status eines Geräts abfragen.
 * -> { erreichbar: true|false|null, geprueft: ISO-Zeitstempel|null }
 * (erreichbar === null: Monitoring nicht konfiguriert oder keine Adresse hinterlegt)
 */
async function frageGeraeteStatusAb(geraet) {
  if (!MONITORING_ENDPOINT || !geraet.networkAddress) {
    return { erreichbar: null, geprueft: null };
  }
  const res = await fetch(`${MONITORING_ENDPOINT}?host=${encodeURIComponent(geraet.networkAddress)}`);
  if (!res.ok) throw new Error(`Monitoring-Dienst antwortet mit HTTP ${res.status}`);
  return res.json();
}
