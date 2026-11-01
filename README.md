# CodeSearch Pocket

Ein deutscher Mitmach-Kurs für CodeSearch auf dem Handy: **636 Schritte in 52 Kapiteln**, ein bedienbares Übungsnetz und **Laptop-Anleitungen für alle Kapitel**. Quellenstand: **CodeSearch 1.10.0, Commit [2624930](https://github.com/Tombkn/td-codesearch/tree/2624930732c828ae93234887e1abe2a395ae549e)**, abgeglichen am 01.11.2026.

[Veröffentlichte Handyseite](https://tombkn.github.io/codesearch-pocket/)

**Neu in 1.10.0: Arbeitsplatz.** Bis zu zehn unabhängige Suchfenster (Ctrl+F), Überblick ohne Suchtext (OPERATOREN / EXTENSIONS), COMP-Zeilenmenü mit DARIN je Familie und Parameter nach oben, Shift+Rad waagerecht und Strg+Rad-Zoom, Suchfelder in jedem der 24 Looks abgesetzt, Zweitfenster mit 25–250 % Zoom; die Laptop-Fassung bringt zusätzlich REKURSIV-Tiefe, Fenster-Andocken, klickbare Info-Zeile und TRIGGERS-Aktionen. **Kapitel 46–49** üben den Arbeitsplatz in 22 Stationen.

**Neu in 1.10.0: LLM ANALYSE.** Frage und Ziel wählen, ein festes Belegpaket in deinen Chat kopieren, fehlenden Kontext nachfordern und Antworten oder Änderungsvorschläge nachvollziehbar prüfen. **Kapitel 44–45** üben den vollständigen Ablauf in **16 Mitmach-Stationen**, jeweils mit Laptop- und iPhone-Anleitung. Paket-ID und Revision verhindern vertauschte Belege; freier LLM-Kommentar bleibt ausdrücklich ungeprüft. [Bedienung, Übungen und Grenzen](docs/LLM-1.10.0.md).

**SPEC** hält gewünschtes Verhalten und dokumentierte Versuche dauerhaft fest: lokale Speicherung, portable JSON-Dateien, Markdown-Export und begrenzte Snapshot-Vergleiche. **Kapitel 46 mit 14 Stationen** führt durch eine echte Settings-Änderung im nachgebildeten SignalGarden. Importierte Reports werden nicht als neu ausgeführte Tests ausgegeben. [Vollständiger Ablauf](https://github.com/Tombkn/td-codesearch/blob/main/docs/SPEC-WORKSPACE.md).

**Lesekopien** übernehmen den gewählten Look und halten Code, Listen, Details, Fehlerberichte, Analyse oder Spec zum Vergleichen fest. **Groß ↗ / Klein ↙** wechselt die Größe; Inhalt und Lesestelle bleiben erhalten. Vier bestehende Kursstationen erklären die Bedienung am Laptop und iPhone. **NUR / REKURSIV** folgen jetzt dem aktuellen Network; ein ausdrücklich gewählter **IN**-Bereich bleibt gebunden.

**Neu in der Oberfläche:** DAT-farbige Extension-Menüs, 16 direkt auswählbare Looks, Blau/Violett statt gelben UI-Markern und klar umrandete **AUSWAHL / DIESE COMP**-Buttons. FlowLens öffnet den gewählten Bereich; **?** enthält alle 27 nativen Shortcutgruppen. [Bedienung und Prüfgrenzen](docs/INTERFACE-1.9.1.md).

## Lernen und üben

**Neu: SignalGarden, Kapitel 36–43.** Acht vollständige Workflows mit je zwölf Stationen an einer interaktiven Lichtinstallation. Root, Sensor, Scenes und Palette arbeiten als vier Extensions zusammen. Du verfolgst Eingaben bis zur Farbe, prüfst Hysterese, doppelte Aufrufe, kaputte Tabellendaten und laufenden State. Jede Station enthält konkrete Laptop- und iPhone-Schritte, erwartete Beobachtung und eine Gegenprobe oder Grenze. [Alle 96 Stationen lesen](https://github.com/Tombkn/td-codesearch/blob/b5ebfe3b54f588eb990586a5bb8a446bed52c691/docs/SIGNALGARDEN_WORKFLOWS.md) · [Prüfbericht](docs/WORKFLOWS-2026-10-31.md).

Die acht Themen: Orientierung → komplette Extension → Datenfluss → State → Aufrufwege → Fehlersuche → Änderungen prüfen → eigenständige Projektanalyse. Beim erneuten Kapitelstart oder Laden beginnt ein Workflow mit bekannten Ausgangswerten. Alte Häkchen bleiben sichtbar; „Weiter“ braucht in diesem Durchlauf erneut „Prüfen“. Bewusstes Überspringen bleibt möglich.

1. Die **Lernansicht** öffnet sich groß. **Aa Größer** schaltet von 17 auf 20 Pixel Leseschrift; die Wahl bleibt lokal gespeichert. Die Karte trennt **Verstehen → selbst ausprobieren → daran erkennst du es**. Vertiefungen und zusätzliche Werkzeuge sind aufklappbar.
2. **Zur Übung →** oder **Jetzt selbst ausprobieren →** wechselt ins nachgebildete CodeSearch. **Lektion lesen** bringt dich an deine Lesestelle zurück. Eine neue Lektion beginnt oben. Offene Such- und Lesefenster verschwinden während des Lesens aus dem Weg und bleiben für die Übung erhalten.
3. **Prüfen** liest den Zustand der Simulation. Es führt den geforderten Handgriff nicht für dich aus. Ein Fehlversuch bietet einen Hinweis und den Rückweg zum eigenen Versuch. Die einzelnen Prüfbedingungen lassen sich zusätzlich aufklappen.
4. **Am Laptop anwenden** erklärt pro Kapitel einen konkreten Fall: vorher → Aktion → nachher, drei Arbeitsschritte, sichtbare Prüfung und Grenze.
5. **ATLAS → AM LAPTOP** enthält acht Schritte für Installation, tatsächliche Projektpfade, erste Aufnahmen, Re-Init und Save/Reload sowie den kompletten Kapitelplan.

**KURS** öffnet die Kapitel. **TD** enthält Übungsnetz, Parameter und Timeline. **⌨** öffnet die Tastenleiste. Zeile antippen = markieren; doppelt tippen = Enter; lange drücken = Kontextmenü. Die Lektionskarte übersetzt die Laptop-Handgriffe in „AM HANDY“.

Alle 462 bisherigen TD-Lektionen bleiben mit stabilen IDs erhalten. Dazu kommen 96 SignalGarden-Stationen, 16 Stationen zur geführten LLM-Analyse, 14 Spec-Stationen sowie 14 Abschlussaufgaben ohne Hilfen und zwölf Werkstattfälle: State-Verlauf, ungültige/aktuelle/veraltete JSON-Pakete, belegte/unbekannte/widersprochene Aussagen, begrenzte Vorschau und eine isolierte Testkopie.

## Neue Funktionen praktisch beurteilen

- **USES / USED BY:** Quelle und Leser sind wie in der aktuellen Laptop-Version getrennt. Wächter und ausgehende Kabel stehen in USED BY.
- **State-Atlas:** bekannte StateLab-Werte, Speicherorte und Lebensdauer. `>states beobachten`, `>states stoppen`, `>states verlauf` erfassen bis zu 30 Stichproben im Sekundenabstand. Ein Hintergrundtab kann Timer verzögern.
- **JSON bearbeiten:** Der Knopf neben dem Suchfeld und auf passenden Lektionskarten öffnet die Pocket-Zwischenablage. Übernehmen führt keinen Code aus. Anschließend `>nachfrage`, `>antwort` oder `>vorschau` verwenden.
- **Nachfrage und Aussagen:** JSON-Struktur, Source-Revision, IDs und Fundstellen werden tatsächlich ausgewertet. Fehler erzeugen keine feste Erfolgsmeldung. `unknown` bedeutet: Die Belege reichen nicht.
- **Vorschau:** Pocket unterstützt einen ausdrücklich begrenzten Bereich angehängter einfacher Methoden. Beliebige Python-Änderungen brauchen die native TD-Prüfung; die App behauptet dafür keine vollständige Analyse.
- **Minimalfall:** Eine eigene StateLab-Simulationsinstanz übernimmt ihren Ausgangszustand. Der Test führt dort Reset/Fire aus und kontrolliert das unveränderte Original. Das ist keine neu erzeugte TD-Komponente.

## Was die Prüfungen belegen

| Nachweis | Bedeutung | Grenze |
|---|---|---|
| Im Modell geprüft | Die Regeln passen zum aktuellen Pocket-Zustand. | Kein echter TD-Lauf und kein Verständnisnachweis. |
| Selbst bestätigt | Du hast die geforderte Beobachtung bestätigt. | Die App kann das Lesen nicht überprüfen. |
| Laptop-Leitfaden | Konkrete Schritte und erwartete Beobachtung im realen Projekt. | Wird nicht automatisch aus Pocket-Häkchen als bestanden markiert. |

Fünf bisher vorerfüllte Regeln sind korrigiert: Kopieraufgaben verlangen eine neue Kopie aus dem passenden Fenster, FlowLens eine neue Auswahl mit anschließendem Wechsel zum Arbeitsplatz. Reine Lesestationen verlangen die ausdrücklich benannte Selbstbestätigung. Der Kurstest schlägt fehl, wenn eine Station schon unmittelbar nach der Vorbereitung besteht. Bereits gespeicherte Häkchen bleiben erhalten; zum erneuten Prüfen kannst du die Station wieder öffnen.

Code und Netz stammen aus den gepinnten TD-Quellen. Lab-Abläufe laufen in JavaScript. Cook-Zeiten, echte TOP-Bilder, Betriebssystem-Fokus, externe KI-Aufrufe und der Projektneustart werden **nicht** durch Pocket nachgewiesen. Bildfälle enthalten modellierte Werte. State-Fundstellen werden beim Build mit dem originalen, TD-freien StateAtlas-Analyzer erzeugt und nur bei passender Source-Revision verwendet.

## Offline

Die Seite einmal mit Internet öffnen. **⇩ / ✓ offline** zeigt, ob alle benötigten Dateien gespeichert sind. Dort findest du Installation, Fortschritt sichern/laden und erneutes Nachladen. Nach einer veröffentlichten Aktualisierung die Seite online neu laden und den Versionsstand kontrollieren.

[CodeSearch-Pocket-offline.html](CodeSearch-Pocket-offline.html) enthält Code, Daten und Bilder zusammen. Für die installierte Handyseite gilt der Service Worker. Der konkrete Dateizugriff und Offline-Start müssen auf dem jeweiligen Gerät geprüft werden.

## Lokal starten und prüfen

```sh
python -m http.server 4173
```

Dann `http://127.0.0.1:4173` öffnen. Entwicklungstests:

```sh
npm ci
npm test
```

- `verify.mjs`: alle 636 Stationen über Gestenfunktionen; **kein Browser-Touchtest**.
- `progress-tests.mjs` und `workflow-tests.mjs`: alte Lesestellen/Häkchen, frische Aufnahmen, Scope-Gegenprobe, isolierte Fallvergleiche und Wiederaufnahme.
- `signalgarden-tests.mjs`: zwölf gemeinsame Szenarien mit derselben Erwartungsdatei wie die Python- und nativen TD-Tests.
- `gesture-tests.mjs`: acht Gegenproben für Tap, Double-Tap, Hold, horizontales/vertikales Wischen, Pointer-Abbruch, zweiten Finger, Scroll-Events und nachlaufende Clicks. **Synthetische Ereignisse, keine Messung der iPhone-Flüssigkeit.**
- `parity-tests.mjs`: Gegenfälle für Protokolle, Quellen, Mutation und Testkopien.
- `analysis-tests.mjs` und `analysis-course-tests.mjs`: Paketbindung, Folgeanfragen, Status und alle 16 neuen Stationen mit Gegenproben.
- `spec-tests.mjs`, `spec-ui-tests.mjs` und `spec-course-tests.mjs`: portable Specs, unverwechselbare Requirements, historische Reports, Dialoge und alle 14 Spec-Stationen.
- `float-tests.mjs`: LIVE-Ansichten und historische Belege, Look-Wechsel, eigener Zoom, Groß/Klein, Fokus und Rückkehr zur Hauptansicht.
- `workplace-course-tests.mjs`: 22 zusammenhängende Arbeitsplatzstationen plus Gegenproben für Suchen, FLOW, Promotion, Mehrfachauswahl und Undo/Redo.
- `browser-layout-tests.py`: echte Headless-Browser WebKit/Chromium, kleine Viewports, Scrollflächen, Regler und Menüs; keine physischen iPhone-Swipes. Benötigt lokal installiertes Playwright und Browser.
- `smoke.mjs`: Aufbau der Ansichten, Detailfelder und Kopiermenüs.
- `ui-tests.mjs`: DOM-Integration der echten App-Handler mit jsdom; Lesen/Üben, Lesestelle, Schriftgröße, Rückmeldung, JSON-Eingabe, überlagernde Fenster und Kapitelwechsel. **jsdom besitzt keine Layout- oder Touch-Engine.**
- `ui-upgrade-tests.mjs`: Extension-Menüs, Alt-Hilfe, Shortcutkatalog und Textkontraste aller 24 Looks einschließlich der Kontext-Buttons.
- `viewport-tests.mjs`: simulierte Ereignisse für Bildschirmtastatur, Drehung, Pinch-Zoom und Browser ohne VisualViewport. **Kein Safari-Gerätetest.**
- `package-tests.mjs`: Start und Grundbedienung der erzeugten Einzeldatei im DOM-Test; enthaltene Dateien und Versionskennung.

Die Prüfung auf einem echten Android/Chrome und iPhone/Safari bleibt eine eigene Abnahme. Sie wurde bei diesen Updates nicht ausgeführt. Der Computer-Use-Zugang war bei der ersten Prüfung wegen fehlender URL-Policy-Unterstützung blockiert; beim iPhone-Nachtrag war der Browserhost nicht verfügbar. [Quellenabgleich und Gerätetest](docs/AUDIT-2026-10-31.md) · [iPhone-Anpassungen und Prüfgrenzen](docs/IPHONE-2026-10-31.md)

## Quellen reproduzierbar bauen

`upstream.json` enthält Commit und SHA-256-Hashes der 38 Build-Eingaben. `source/` bleibt lokal; eine neue Revision erhält einen eigenen Unterordner. Aus einem Clone von `Tombkn/td-codesearch`:

```sh
python -m pip install -r requirements-build.txt
python tools/upstream.py --repo ../td-codesearch --ref 2624930732c828ae93234887e1abe2a395ae549e --version 1.10.0 --checked 2026-11-01 --freeze
python tools/build_data.py
python tools/build_offline.py
npm test
```

Für einen erneuten Aktualitätscheck zunächst im **TD-Clone** `git fetch origin`, dann im **Pocket-Clone**:

```sh
python tools/upstream.py --repo ../td-codesearch --ref origin/main
```

Der Check meldet einen geänderten Commit, neue Eingaben, fehlende Lektionen und unerklärte Inhaltsabweichungen. Er aktualisiert weder den Kurs noch bestätigt er automatisch fachliche Vollständigkeit. Eine neue Quelle verlangt weiterhin Prüfung von Verhalten, Lernkarten und Gerätetest.

`tools/course_patches.json` dokumentiert Kurskorrekturen. Der RECORD-Reset ist inzwischen auch im Laptop-Kurs behoben. Die Wächter-Lektion enthält noch eine veraltete USES-Anweisung; Pocket korrigiert Anweisung und Prüfziel zusammen.

Nach jeder Änderung an `js/`, `css/`, `img/`, `data/` oder `index.html` muss `python tools/build_offline.py` laufen. Sonst stimmen Seite, Offlinecache und Einzeldatei nicht überein.
