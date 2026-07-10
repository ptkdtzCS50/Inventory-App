# Gerätefuhrpark – Pathologisches Institut

Web-App zur Verwaltung des Gerätefuhrparks eines Pathologischen Instituts:
Überblick über Zustand, Wartung und Störungen aller Laborgeräte (Mikrotome,
Färbeautomaten, Eindeckautomaten, Kühlschränke, Mikroskope u. a.) über mehrere
Standorte und Abteilungen hinweg.

## Starten

Die App ist eine reine Browser-Anwendung ohne Server-Abhängigkeiten:

1. Repository klonen oder herunterladen
2. `index.html` im Browser öffnen – fertig

Alternativ lässt sich das Repository direkt über **GitHub Pages** bereitstellen
(Settings → Pages → Branch auswählen), dann ist die App per URL im ganzen Haus
aufrufbar.

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
Gruppenüberschrift zeigt die Geräteanzahl und hebt hervor, wenn in der Gruppe
Geräte defekt sind oder Wartungen anstehen.

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

## Wichtiger Hinweis: Prototyp mit lokaler Speicherung

Die Daten werden derzeit im **localStorage des jeweiligen Browsers**
gespeichert. Das heißt:

- Auf einem Rechner/Browser bleiben alle Daten dauerhaft erhalten
- Verschiedene Rechner sehen **noch keinen gemeinsamen Datenbestand**

Für den Team-Einsatz über mehrere Arbeitsplätze wird ein Backend benötigt
(z. B. Supabase oder ein kleiner REST-Server mit Datenbank). Die Datenschicht
ist in `js/data.js` bewusst gekapselt, sodass sich `ladeDaten()` /
`speichereDaten()` ohne Änderungen an der Oberfläche gegen API-Aufrufe
austauschen lassen.

## Dateistruktur

```
index.html      – App-Gerüst (Login, Übersicht, Statistik, Modals)
css/style.css   – Layout, Ampelfarben, Responsive- und Druck-Styles
js/data.js      – Datenmodell, Speicherung, Status-/Wartungslogik, Demo-Daten
js/stats.js     – Auswertungen (Punkt 7), SVG-Diagramm, CSV-Export
js/app.js       – Oberfläche: Login, Tabelle, Filter, Detail/Chat, Statistik
```
