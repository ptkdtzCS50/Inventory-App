# Gerätefuhrpark – Pathologisches Institut

Web-App zur Verwaltung des Gerätefuhrparks eines Pathologischen Instituts:
Überblick über Zustand, Wartung und Störungen aller Laborgeräte (Mikrotome,
Färbeautomaten, Eindeckautomaten, Kühlschränke, Mikroskope u. a.) über mehrere
Standorte und Abteilungen hinweg.

## Starten

Die App ist eine reine Browser-Anwendung ohne Server-Abhängigkeiten:

1. Repository klonen oder herunterladen
2. `index.html` im Browser öffnen – fertig

### Preview im Web (GitHub Pages)

Das Repository enthält einen Workflow (`.github/workflows/pages.yml`), der
die App bei jedem Push automatisch als Website über **GitHub Pages**
veröffentlicht:

> https://ptkdtzcs50.github.io/Inventory-App/

Damit ist die Preview im ganzen Haus (auch am Tablet) per URL aufrufbar,
ohne dass lokal etwas installiert werden muss. Alternativ funktioniert auch
Cloudflare Pages: dort ein neues Pages-Projekt anlegen, dieses Repository
verbinden, Build-Befehl leer lassen (statische Seite) – mehr ist nicht nötig.

Beim ersten Start werden realistische Demo-Daten geladen, damit alle Funktionen
(Ampel-Status, Ausfalldauer, Statistik) sofort sichtbar sind. Eigene Geräte
können als Admin angelegt werden; die Demo-Geräte lassen sich löschen.

## Funktionen

### 1. Geräteverwaltung (Stammdaten)
Pro Gerät: Name, Typ/Kategorie, Hersteller, Modell, Seriennummer, interne
Inventarnummer, Standort, Abteilung, **Raum**, **zuständiges Team**,
Distributor mit **zwei getrennten Kontakten** – technischer Service
(Hotline für Defekte) und Vertrieb/Außendienst (für Angebote und
Beschaffung) – sowie Anschaffungsdatum, Garantieende, Wartungsintervall und
letzte Wartung. Die **nächste Wartungsfälligkeit wird automatisch berechnet**.

### 2. Statusverwaltung (Ampel)
- 🟢 **Funktionsfähig**
- 🟡 **Wartung fällig / bald fällig** (automatisch ab 30 Tage vor Fälligkeit)
- 🔴 **Defekt** – mit Zeitstempel der Meldung und **automatisch laufender
  Ausfalldauer** („defekt seit 3 Tagen")
- ⚪ **Außer Betrieb**

### 3. Übersichtsliste
Tabellarische Liste aller Geräte mit Status-Ampel, sortierbar per Klick auf die
Spaltenköpfe und filterbar nach **Standort, Abteilung, Status und
Wartungsfälligkeit**; Suchfeld für Name, Seriennummer, Inventarnummer, Raum
und Team; Dashboard-Kacheln (gesamt / funktionsfähig / Wartung fällig /
defekt) als Schnellfilter.

Zusätzlich lässt sich die Liste **gruppieren** – nach Standort, Abteilung,
Raum, Team, Funktion/Gerätetyp, Hersteller, Distributor oder Status. Jede
Gruppenüberschrift zeigt die Geräteanzahl, hebt hervor, wenn in der Gruppe
Geräte defekt sind oder Wartungen anstehen, und lässt sich **per Klick
ein- und ausklappen**.

### Eigene Felder (Admin)
Über „⚙ Eigene Felder" kann der Admin zusätzliche Stammdatenfelder
definieren (Text, Zahl oder Datum) – z. B. „Softwareversion", „Letzte STK"
oder „Kostenstelle". Sie erscheinen automatisch bei allen Geräten im
Bearbeitungsformular und in der Detailansicht. Beim Entfernen eines Felds
bleiben bereits eingetragene Werte gespeichert (werden nur ausgeblendet).

### Störungsmeldung an den Service
Bei defekten Geräten bietet die Detailansicht **„✉ Service kontaktieren"**:
Ein Klick öffnet das E-Mail-Programm mit fertig ausgefüllter
Störungsmeldung an die Service-Adresse des Distributors (Gerät, Modell,
Serien- und Inventarnummer, Standort/Raum, Defektdatum und -dauer). Der
Klick wird im Geräteverlauf dokumentiert. Ein *vollautomatischer* Versand
ohne Klick ist bewusst nicht eingebaut – dafür wäre ein Backend nötig
(siehe unten), und eine Störungsmeldung sollte vor dem Versand ohnehin kurz
geprüft werden.

### Online-Statusabfrage (vorbereitet)
Pro Gerät kann eine **Netzwerkadresse (IP/Hostname)** hinterlegt werden.
Die Abfrage „ist das Gerät gerade erreichbar?" ist in `js/monitoring.js`
vorbereitet: Sobald im Institutsnetz ein kleiner Monitoring-Dienst läuft
(API-Format ist in der Datei dokumentiert), muss dort nur
`MONITORING_ENDPOINT` gesetzt werden – die Detailansicht zeigt dann einen
„Online-Status abfragen"-Button. Direkt aus dem Browser heraus ist ein
Ping auf Laborgeräte technisch nicht möglich (Same-Origin-Policy), daher
führt an diesem kleinen Dienst kein Weg vorbei.

### 4. Verlauf & Kommentare pro Gerät
Chronologischer Verlauf (neueste zuerst) mit Autor und Zeitstempel. Jede/r kann
Updates eintragen (z. B. „Techniker kontaktiert, kommt innerhalb 24 h").
Statuswechsel und Wartungen erscheinen automatisch als Systemeinträge – so
entsteht eine **lückenlose Gerätehistorie** (hilfreich für Audits, z. B. nach
ISO 15189 / MPBetreibV).

### 5. Benachrichtigungen
Glocken-Symbol mit Zähler: Wartung fällig oder überfällig sowie Geräte, die
länger als 7 Tage defekt sind.

### 6. Nutzer & Rechte
Einfaches Login mit Namen und zwei Rollen:
- **Admin** – Geräte anlegen, bearbeiten, löschen
- **Mitarbeiter/in** – Status ändern, kommentieren

### 7. Statistik & Auswertung
- **Ausfallstatistik pro Hersteller** – Defekte, Ausfalltage, Ø Ausfalldauer;
  normalisiert auf Gerätebestand („Defekte pro Gerät") und Alter
  („Defekte pro Betriebsjahr"), damit Hersteller mit vielen oder alten Geräten
  nicht unfair abschneiden
- **Top-Ausfallgeräte** – Rangliste der Einzelgeräte nach Defekthäufigkeit und
  Stillstandszeit
- **Vergleich nach Gerätetyp** – Hersteller innerhalb derselben Kategorie
- **Defekte pro Monat** – Diagramm, filterbar nach Standort, Abteilung,
  Hersteller und Zeitraum (6/12/24 Monate oder gesamt)
- **Reparaturzeit pro Distributor** – Ø Dauer von Defektmeldung bis „wieder
  funktionsfähig"
- **Export**: alle Tabellen als CSV (Excel-kompatibel), gesamte Statistikseite
  über „Als PDF drucken"

## Technik

- Reines HTML/CSS/JavaScript, keine Build-Tools, keine externen Bibliotheken
- Responsive – auch am Tablet im Labor nutzbar
- Deutschsprachige Oberfläche, Datumsformat TT.MM.JJJJ

## Gemeinsamer Datenbestand (Supabase)

Ohne Konfiguration arbeitet die App lokal (localStorage des jeweiligen
Browsers) – Daten bleiben auf einem Rechner dauerhaft erhalten, werden aber
nicht zwischen Arbeitsplätzen geteilt.

Für den **gemeinsamen Datenbestand aller Arbeitsplätze** ist die
Cloud-Synchronisation bereits eingebaut und muss nur aktiviert werden:

1. Kostenloses Projekt auf [supabase.com](https://supabase.com) anlegen
2. Im SQL-Editor den Inhalt von `supabase/schema.sql` ausführen
3. Unter *Settings → API* die Project-URL und den `anon`-Key kopieren und
   in `js/config.js` eintragen

Danach lädt die App beim Start den gemeinsamen Stand, schreibt jede
Änderung sofort in die Cloud und übernimmt Änderungen anderer
Arbeitsplätze automatisch (Abgleich alle 30 Sekunden). Der localStorage
dient weiter als lokaler Puffer, falls die Verbindung kurz wegbricht.

**Hinweis zum Prototyp-Modell:** Der Datenbestand liegt als ein
JSON-Dokument in der Datenbank; bei gleichzeitigen Änderungen gewinnt der
zuletzt Speichernde. Der `anon`-Key erlaubt Lesen und Schreiben – er
sollte nur im Institut weitergegeben werden. Für echte Zugriffskontrolle
wäre der nächste Ausbauschritt Supabase-Auth mit personenbezogenen Logins.

## Dateistruktur

```
index.html          – App-Gerüst (Login, Übersicht, Statistik, Modals, Footer)
css/style.css       – Layout, Ampelfarben, Responsive- und Druck-Styles
js/config.js        – Supabase-Zugangsdaten (leer = rein lokaler Betrieb)
js/data.js          – Datenmodell, Speicherung, Cloud-Sync, Demo-Daten
js/monitoring.js    – vorbereitete Schnittstelle zur Online-Statusabfrage
js/stats.js         – Auswertungen (Punkt 7), SVG-Diagramm, CSV-Export
js/app.js           – Oberfläche: Login, Tabelle, Filter, Detail/Chat, Statistik
supabase/schema.sql – Datenbankschema für den gemeinsamen Datenbestand
assets/logo.svg     – Firmenlogo (Wortmarke), austauschbar gegen Originaldatei
assets/logo-mark.svg – Bildmarke für Header, austauschbar gegen Originaldatei
.github/workflows/pages.yml – automatisches Preview-Deployment (GitHub Pages)
```

Die beiden Logo-Dateien sind Platzhalter im Stil von avidiapharma.com – zum
Einsetzen des Original-Logos einfach die Dateien unter `assets/` durch die
echten ersetzen (gleiche Dateinamen), es sind keine Code-Änderungen nötig.

## Copyright

© Dietz-Engineering · Alle Rechte vorbehalten

Designed by **Dietz-Engineering** · Initiiert von **Christoph Lüttgens**
