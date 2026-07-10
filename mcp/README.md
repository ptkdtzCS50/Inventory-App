# Claude-Integration (MCP-Server)

Verbindet die **Claude-App** (claude.ai, Desktop, Mobile) mit dem
Gerätefuhrpark über das **Model Context Protocol (MCP)**. Die Anwender
melden sich mit ihrem normalen Claude-Konto an (Pro/Team) und fügen die
Server-URL als Connector hinzu — **keine API-Tokens, keine separate
Abrechnung**; die Nutzung läuft über das Claude-Abo des Anwenders.

Claude kann dann direkt im Chat:

- **Geräte suchen und Details abrufen** („Welche Geräte in der Histologie
  sind defekt?")
- **Fehlende Stammdaten finden** („Bei welchen Geräten fehlt die
  Seriennummer oder der Servicekontakt?")
- **Geräte anlegen und aktualisieren** („Lege das neue Mikrotom an:
  Leica RM2265, Standort Nord, Raum 1.05 …")
- **Wartungspläne vorbereiten** („Erstelle den Wartungsplan fürs nächste
  Quartal und gruppiere nach Servicepartner")
- **Defekte melden und Kommentare schreiben** („Melde die Zytozentrifuge
  defekt, Rotor blockiert")
- **Service-Kontaktaufnahme vorbereiten** („Entwirf die Störungsmeldung an
  Thermo Fisher für Gerät 9")
- **Statistiken abfragen** („Welcher Hersteller verursacht die meisten
  Kosten pro Gerät?")

Jede Änderung durch Claude wird im Geräteverlauf als Eintrag von
„Claude (KI-Assistent)" protokolliert — die Historie bleibt lückenlos.

## Voraussetzung

Der Server arbeitet auf dem **gemeinsamen Datenbestand in Supabase**
(gleiche Tabelle wie der Cloud-Sync der App). Ohne konfiguriertes
Supabase läuft er im **DEMO-Modus** mit Beispieldaten — zum Ausprobieren
des Connectors, Änderungen sind dann nicht dauerhaft.

Ist die Datenverschlüsselung der App aktiv (`DATEN_VERSCHLUESSELN`),
braucht der Server zusätzlich das Master-Passwort als Umgebungsvariable
(`MASTER_PASSWORT`), um den Bestand zu ent-/verschlüsseln.

## Deployment

**Variante A — Cloudflare Workers (empfohlen, kostenlos):**

```bash
cd mcp
npx wrangler deploy
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
npx wrangler secret put MCP_SECRET       # optional: Zugriffsschutz
```

Ergebnis: `https://geraetefuhrpark-mcp.<account>.workers.dev`

**Variante B — eigener Server (Node ≥ 18, z. B. im Institutsnetz):**

```bash
SUPABASE_URL=… SUPABASE_KEY=… node mcp/server.mjs   # Port 8788
```

(HTTPS z. B. per Reverse-Proxy; Claude benötigt eine öffentlich
erreichbare HTTPS-URL.)

## In Claude verbinden

1. claude.ai → **Einstellungen → Connectors → „Add custom connector"**
2. URL des Servers eintragen (Workers-URL bzw. eigene HTTPS-Adresse)
3. Fertig — die Tools erscheinen automatisch im Chat (Werkzeug-Symbol)

Mit gesetztem `MCP_SECRET` ist der Server nur mit dem passenden
Bearer-Token nutzbar (in Claude beim Connector als OAuth/Token
hinterlegbar oder für den Pilot einfach ohne Secret betreiben).

## Sicherheit / ehrliche Einordnung

- Der `SUPABASE_KEY` liegt **nur auf dem Server** (Cloudflare Secret),
  nie im Claude-Chat oder beim Anwender.
- Schreibende Tools (anlegen, aktualisieren, Defekt melden, Kommentar)
  bestätigt Claude standardmäßig vor der Ausführung beim Anwender.
- Bei gleichzeitigen Änderungen von App und Claude gilt wie beim
  Cloud-Sync: Der letzte Schreiber gewinnt (Ein-Dokument-Modell des
  Prototyps).
- Der DEMO-Modus hält Daten nur im Arbeitsspeicher der jeweiligen
  Server-Instanz.

© Dietz-Engineering · Alle Rechte vorbehalten
Designed by Dietz-Engineering · Initiiert von Christoph Lüttgens
