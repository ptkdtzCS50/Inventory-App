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
Beschaffung) – sowie Anschaffungsdatum und Garantieende.

**Prüfarten nach MPBetreibV:** Jedes Gerät kann mehrere Prüfzyklen mit
eigenem Intervall haben – Herstellerwartung, sicherheitstechnische
Kontrolle (STK), messtechnische Kontrolle (MTK), Validierung oder frei
benannte Prüfarten. Jede Fälligkeit wird automatisch berechnet; in der
Detailansicht lässt sich jede Prüfung einzeln als „durchgeführt"
abhaken (mit Systemeintrag im Verlauf). Die Ampel wird gelb, sobald
irgendeine Prüfung fällig wird.

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

### 5. Benachrichtigungen, Kalender & Erinnerungen
Glocken-Symbol mit Zähler: fällige/überfällige Prüfungen (je Prüfart) sowie
Geräte, die länger als 7 Tage defekt sind.

Die **Kalender-Ansicht** listet alle anstehenden Prüfungen der nächsten
12 Monate – überfällige zuerst, dann nach Monat gruppiert, filterbar nach
Standort, Abteilung und Prüfart. Dazu:
- **Outlook-Export (ICS):** alle Fälligkeiten als Kalenderdatei mit
  Erinnerung 7 Tage vor Termin – importierbar in Outlook und jeden anderen
  Kalender
- **Erinnerungs-E-Mail:** ein Klick erstellt eine fertige E-Mail mit allen
  überfälligen und in 30 Tagen fälligen Prüfungen (z. B. an die
  Teamleitung). Ein vollautomatischer wöchentlicher Versand braucht ein
  Backend und ist als Ausbauschritt vorgesehen.

### Dokumente pro Gerät
In der Detailansicht lassen sich Dokumente hinterlegen – kategorisiert als
Bedienungsanleitung, Arbeitsanweisung (SOP), Wartungsbericht, Zertifikat
oder Sonstiges:
- **Links** (empfohlen): Verweis auf Netzlaufwerk, Intranet oder DMS –
  ohne Größenlimit
- **Datei-Upload** bis 2 MB direkt in der App (localStorage-Prototyp);
  größere Dateien bitte verlinken – echte Uploads ohne Limit folgen mit
  dem Supabase-Backend (Storage)

Zusammen mit den QR-Etiketten wird das Gerät damit zum Einstiegspunkt:
Scan am Gerät → Anleitung/SOP sofort auf dem Handy.

### Belegungs-/Auslastungskalender
Jedes Gerät hat einen Reservierungsbereich in der Detailansicht:
Zeitraum (von/bis), Zweck – der Name kommt vom angemeldeten Nutzer.
**Konfliktprüfung inklusive:** Überschneidet sich eine neue Reservierung
mit einer bestehenden, wird sie mit Hinweis auf den Konflikt abgelehnt.
Stornieren kann die eigene Reservierung jeder selbst, fremde nur der Admin;
alles wird im Geräteverlauf protokolliert.

Der Tab **„Belegung"** zeigt alle Reservierungen der nächsten 14 Tage –
nach Tag gruppiert, filterbar nach Standort und Abteilung, mit
„läuft"-Markierung für aktuell aktive Belegungen.

### QR-Code-Etiketten
„🏷 QR-Etiketten" erzeugt einen druckbaren Etikettenbogen für die aktuell
gefilterte Geräteliste (QR-Code + Name, Modell, Inventar-/Seriennummer,
Standort/Raum). Am Gerät angebracht, öffnet der Scan mit dem Handy direkt
die Detailseite – Defekt melden oder Kommentar schreiben ohne Suchen.
(QR-Erzeugung lokal über die MIT-lizenzierte Bibliothek
`js/vendor/qrcode.js`, keine externen Dienste.)

### 6. Nutzer & Rechte
Einfaches Login mit Namen und zwei Rollen:
- **Admin** – Geräte anlegen, bearbeiten, löschen
- **Mitarbeiter/in** – Status ändern, kommentieren

Zusätzlich schützt ein **Master-Passwort** den Zugang zur Seite: Es wird
pro Gerät/Browser einmal abgefragt und dann gemerkt. Im Code liegt nur der
SHA-256-Hash (Passwort ändern: siehe Anleitung in `js/config.js`; Feld leer
lassen schaltet die Abfrage ab). Wichtig zur Einordnung: Das ist ein
Sichtschutz für die öffentliche Preview, keine echte Zugriffskontrolle –
die käme mit Supabase-Auth als Ausbauschritt.

### 7. Statistik & Auswertung
- **Reparaturkosten:** Beim Abschließen einer Reparatur können die Kosten
  erfasst werden; sie erscheinen pro Gerät, pro Hersteller und als Summe im
  Zeitraum – das zentrale Argument für Beschaffungsanträge
  („4 Ausfälle, 23 Stillstandstage, 6.800 € in 2 Jahren")
- **Ausfallstatistik pro Hersteller** – Defekte, Ausfalltage, Ø Ausfalldauer;
  normalisiert auf Gerätebestand („Defekte pro Gerät") und Alter
  („Defekte pro Betriebsjahr"), damit Hersteller mit vielen oder alten Geräten
  nicht unfair abschneiden
- **Ausfallquote nach Standort / Abteilung / Team / Raum** (umschaltbar) –
  gleiche Normalisierung; auffällig hohe Quoten an einem Standort können auf
  Bedienungsprobleme oder Schulungsbedarf hindeuten
- **Top-Ausfallgeräte** – Rangliste der Einzelgeräte nach Defekthäufigkeit und
  Stillstandszeit
- **Vergleich nach Gerätetyp** – Hersteller innerhalb derselben Kategorie
- **Defekte pro Monat** – Diagramm, filterbar nach Standort, Abteilung,
  Hersteller und Zeitraum (6/12/24 Monate oder gesamt)
- **Reparaturzeit pro Distributor** – Ø Dauer von Defektmeldung bis „wieder
  funktionsfähig"
- **Export**: alle Tabellen als CSV (Excel-kompatibel), gesamte Statistikseite
  über „Als PDF drucken"

## Sprachen & Währung

Die Oberfläche ist **viersprachig**: Deutsch, English, Français, Italiano.
Die Sprache wird über den Umschalter im Header (oder auf der Login-Karte)
gewählt, pro Gerät gemerkt und beim ersten Besuch aus der Browsersprache
vorbelegt. Alle Ansichten, Dialoge, E-Mail-Vorlagen und CSV-Kopfzeilen sind
übersetzt; erfasste Daten (Gerätenamen, Verlaufseinträge) bleiben in der
Sprache, in der sie geschrieben wurden. Übersetzungen liegen zentral in
`js/i18n.js`.

Die **Hauswährung ist CHF** (Schweizer Zahlenformat, z. B. CHF 1'250.00) –
zentral einstellbar über `WAEHRUNG` in `js/config.js`.

## Technik

- Reines HTML/CSS/JavaScript, keine Build-Tools, keine externen Dienste
- Responsive – auch am Tablet im Labor nutzbar
- Datumsformat TT.MM.JJJJ

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

## Claude-Integration (MCP)

Im Ordner `mcp/` liegt ein fertiger **MCP-Server**, der die App mit der
Claude-App verbindet: Anwender fügen die Server-URL in Claude unter
*Einstellungen → Connectors* hinzu und arbeiten mit ihrem normalen
Claude-Konto — ohne API-Tokens. Claude kann dann Geräte suchen und
anlegen, fehlende Stammdaten finden, Wartungspläne vorbereiten, Defekte
melden, Störungsmeldungen an Servicepartner entwerfen und Statistiken
abfragen. Details und Deployment (Cloudflare Workers oder eigener
Node-Server): siehe `mcp/README.md`.

## Lizenzierung

Die App ist **proprietäre Software von Dietz-Engineering** (siehe
`LICENSE`) und prüft beim Start einen signierten Lizenzschlüssel:

- Der Schlüssel enthält Kunde, Edition, **Gerätelimit** und **Ablaufdatum**
  und ist mit dem privaten ECDSA-Schlüssel von Dietz-Engineering signiert.
- Die App prüft die Signatur mit dem eingebetteten öffentlichen Schlüssel –
  manipulierte Schlüssel fallen durch, die App läuft dann als
  **Demo-Version** (Hinweis im Footer, ansonsten voll nutzbar).
- Gültige Lizenz: Footer zeigt Kunde/Edition/Laufzeit; 30 Tage vor Ablauf
  erscheint eine Warnung; das Gerätelimit wird beim Anlegen neuer Geräte
  durchgesetzt.
- Lizenzen erzeugt Dietz-Engineering mit `tools/lizenz-generator.mjs`
  (Schlüsselpaar erzeugen, Lizenz signieren). **Der private Schlüssel darf
  niemals ins Repository oder zum Kunden gelangen.**

Ehrliche Einordnung: Die Prüfung läuft clientseitig und ist ein
Lizenz-Gate wie bei klassischer Desktop-Software – rechtlich bindend ist
der Lizenzvertrag, technisch verhindert das Gate beiläufige Weiternutzung.

## Datenverschlüsselung (vorbereitet)

Mit `DATEN_VERSCHLUESSELN = true` in `js/config.js` wird der komplette
Datenbestand **AES-256-GCM-verschlüsselt** gespeichert – im localStorage
und in der Cloud (Supabase sieht dann nur Chiffretext, „Zero-Knowledge").

- Schlüsselableitung aus dem Master-Passwort per PBKDF2-SHA-256
  (210'000 Iterationen); das Passwort wird dann **einmal pro
  Browser-Sitzung** abgefragt (statt einmal pro Gerät).
- Der Sitzungsschlüssel liegt in der sessionStorage und verschwindet beim
  Schließen des Tabs.
- Grenzen: Wer das Master-Passwort kennt, kann die Daten lesen. Das
  PBKDF2-Salt ist installationsübergreifend fix, damit alle Arbeitsplätze
  denselben Schlüssel ableiten (nötig für den gemeinsamen
  Cloud-Datenbestand) – beim Ausbau mit Supabase-Auth wandert das Salt
  pro Mandant in die Datenbank.
- **Wichtig:** Geht das Master-Passwort verloren, sind verschlüsselte
  Daten nicht wiederherstellbar.

In der öffentlichen Demo ist die Verschlüsselung bewusst ausgeschaltet.

## Copyright

© Dietz-Engineering · Alle Rechte vorbehalten (proprietär, siehe `LICENSE`)

Designed by **Dietz-Engineering** · Initiiert von **Christoph Lüttgens**
