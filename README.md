# Betreuerbuch

Handy-App (PWA) für Berufsbetreuer: Klientenakte, Fahrtenbuch, Fristen, Vergütung, Post und Schreiben.
Alle Daten liegen **verschlüsselt nur auf dem eigenen Gerät** – kein Server, kein Konto.

## Funktionen
- **Heute**: fällige Fristen, offene Vergütungsanträge, Geburtstage, Monatsstatistik, Backup-Erinnerung
- **Klienten**: Stammdaten, Gericht/Aktenzeichen, Aufgabenkreise, Krankenkasse, Bankverbindungen, Kontaktpersonen,
  Zugangsdaten (verdeckt), Notizen; Anrufen/WhatsApp/Route mit einem Tipp; Verlauf aus Kontakten, Fahrten und Dokumenten;
  „Kontakte für den Jahresbericht“
- **Fahrten**: Klient oder Ort antippen → km werden ab Wohnadresse berechnet; Export als Excel/CSV/Druck
- **Fristen**: Vorlagen (Weiterbewilligung, Widerspruchsfrist …), wiederkehrend, Export in den Handy-Kalender (.ics, nur Initialen)
- **Vergütung**: 3-Monats-Zeiträume ab Bestellung, Status fällig/beantragt/bezahlt, Warnung bei lange offenen Zeiträumen
- **Post**: Briefe fotografieren (mehrere Seiten), verschlüsselt ablegen, Frist direkt dazu anlegen
- **Schreiben**: Textvorlagen mit Platzhaltern → Kopieren, E-Mail, Teilen, Drucken
- **Sicherheit**: App-Passwort, automatische Sperre, verschlüsselte Sicherungsdatei, Passwort ändern

## Aufbau
```
index.html, styles.css         Oberfläche
js/main.js                     Start, Router, automatische Sperre
js/store.js  crypto.js  db.js  verschlüsselter Speicher (AES-256-GCM, PBKDF2 600k) in IndexedDB
js/model.js                    Fachlogik (Fristen, Vergütung, Verlauf, Vorlagen füllen)
js/geo.js                      Adresssuche (Nominatim) und Strecken (OSRM)
js/actions.js                  Dialoge: Kontakt, Post, Schreiben, Jahresbericht, Vergütung
js/export.js                   Excel/CSV/Druck, .ics
js/views/*.js                  Seiten: heute, klienten, fahrten, fristen, mehr
sw.js, manifest.webmanifest    installierbar & offline
serve.js                       lokaler Testserver: node serve.js → http://localhost:5173
```
Kein Build-Schritt. Braucht https (oder localhost), weil die Verschlüsselung die Web Crypto API nutzt.
Daten aus der ersten Version (unverschlüsselt in localStorage) werden beim Einrichten übernommen und danach gelöscht.
