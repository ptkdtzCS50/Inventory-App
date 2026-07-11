# Supabase einrichten – Schritt für Schritt (≈ 10 Minuten)

Diese Anleitung schaltet den **gemeinsamen Datenbestand** für alle
Arbeitsplätze frei – und damit auch die Claude-Integration mit Live-Daten.
Alles im Code ist bereits vorbereitet; es fehlen nur Projekt und Schlüssel.

## 1. Konto & Projekt anlegen (≈ 5 Min.)

1. https://supabase.com öffnen → **"Start your project"** → Konto
   erstellen (Login mit GitHub geht am schnellsten). Kostenloser Plan reicht.
2. **"New project"** klicken:
   - **Name:** `geraetefuhrpark` (frei wählbar)
   - **Database Password:** generieren lassen und **im Passwortmanager
     speichern** (wird selten gebraucht, aber nicht wiederherstellbar)
   - **Region:** `Europe (Zurich)` – Schweizer Datenhaltung, gutes
     Verkaufsargument
3. ~2 Minuten warten, bis das Projekt bereit ist.

## 2. Datenbank-Schema einspielen (≈ 2 Min.)

1. Linke Seitenleiste → **SQL Editor** → "New query"
2. Den kompletten Inhalt der Datei **`supabase/schema.sql`** (in diesem
   Repository) einfügen → **Run**
3. Erwartete Meldung: „Success. No rows returned"

## 3. Schlüssel kopieren (≈ 1 Min.)

Linke Seitenleiste → **Project Settings → API**:

- **Project URL** (Form: `https://xxxxxxxx.supabase.co`)
- **anon public** Key (langer String unter "Project API keys")

⚠️ Den **service_role**-Key NICHT in die App eintragen – er gehört nur
auf den MCP-Server (als Cloudflare-Secret) und in den Passwortmanager.

## 4. In die App eintragen (≈ 1 Min.)

Beide Werte in **`js/config.js`** eintragen:

```js
const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOi…';
```

…oder einfach beide Werte an Claude Code schicken – dann werden sie
eingetragen, gepusht, und die Preview aktualisiert sich automatisch.
(Der anon-Key ist ohnehin clientseitig sichtbar; geheim bleiben müssen
nur Datenbank-Passwort und service_role-Key.)

## 5. Prüfen (≈ 1 Min.)

App in **zwei verschiedenen Browsern** öffnen (oder Browser + Handy):
Eine Änderung (z. B. Kommentar) im einen erscheint im anderen nach
spätestens 30 Sekunden. ✅

## Optional danach

- **Claude-Integration live schalten:** `cd mcp && npx wrangler deploy`,
  dann Secrets setzen (siehe `mcp/README.md`) – SUPABASE_URL und als
  SUPABASE_KEY den service_role-Key.
- **Verschlüsselung aktivieren:** `DATEN_VERSCHLUESSELN = true` in
  `js/config.js` (Details/Grenzen: README, Abschnitt Datenverschlüsselung).
- **Backups:** Der kostenlose Supabase-Plan sichert die Datenbank täglich;
  zusätzlich lohnt ein gelegentlicher CSV-Export aus der Statistik.

© Dietz-Engineering · Alle Rechte vorbehalten
