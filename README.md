# CodeSearch Pocket

Die komplette CodeSearch-Mitmach-Tour auf dem Handy: **462 Schritte in 35 Kapiteln** plus **14 Abschluss-Aufgaben ohne Hilfen**. Du bedienst ein nachgebautes CodeSearch-Fenster, das auf dem echten Übungsnetz rechnet. Es gibt dieselben Tabs, Spalten, Tooltips, Befehle und Prüfregeln wie in TouchDesigner.

Live: https://tombkn.github.io/codesearch-pocket/

## Auf dem Handy – komplett offline

1. Seite einmal mit Netz öffnen. Der Kurs speichert sich dabei **ganz** auf dem Handy: alle 45 Dateien, 2,4 MB, mit Bildern.
2. Oben rechts zeigt **⇩** den Stand. Steht dort **✓ offline**, ist alles da. Ein Tipp darauf öffnet die OFFLINE-Seite mit Dateizahl, Version, „Speicher schützen“ und einer Anleitung.
3. Als App: iPhone (Safari) Teilen → **Zum Home-Bildschirm**. Android (Chrome) Menü → **App installieren**.
4. Test: Flugmodus an, App öffnen. Kurs, Fenster, TD-Seite, Atlas und Bilder laufen weiter. Der Fortschritt bleibt auf dem Gerät.

**Eine Datei zum Mitnehmen:** [`CodeSearch-Pocket-offline.html`](CodeSearch-Pocket-offline.html) (2,7 MB) enthält den ganzen Kurs, also JS, CSS, Daten und Bilder, und läuft ohne Server. Android: mit Chrome aus den Downloads öffnen. PC: Doppelklick. Das iPhone zeigt HTML-Dateien in der Dateien-App nur als Vorschau ohne Bedienung, dort also die Home-Bildschirm-App nehmen.

Fortschritt wechseln (z. B. von der Datei in die App): OFFLINE → **Fortschritt sichern** und am anderen Ort **Fortschritt laden**.

## So ist es aufgebaut

| Bereich | Was es ist |
|---|---|
| Fenster oben | CodeSearch: SEARCH, USES, USED BY, IMPACT, ERRORS · FLOW, TABLE, READ ORDER · STRUCTURE (+ LANDKARTE, SYSTEM), TRIGGERS, CALL PATH (+ ROUTE), RECORD (+ WARUM), AUDIT |
| Karte unten | Mitmach-Tour: JETZT DU, **AM HANDY** (übersetzt Maus und Tasten), DARAUF ACHTEN, Prüfen, Bedeutung, Grenzen, Begriffe |
| **TD** | TouchDesigner-Seite: NETZ (Ops, Kabel, versteckte Kanten), PARAMETER (BranchLab, StateLab, Farbmischer, CodeSearch), TIMELINE |
| **⌨** | Tastenleiste: STRG / ALT / ⇧ einmal antippen = gedrückt halten; die Tasten der aktuellen Station leuchten |
| **KURS** | Kapitelkarte mit Fortschritt |
| **ATLAS** | Spickzettel (welche Frage → welcher Tab), Doku, Bilder des echten Fensters und von FlowLens, alle Begriffe |

Gesten: Zeile antippen = markieren · doppelt tippen = Enter · lange drücken = Rechtsklick · ART-Zelle antippen = Tooltip.

## Was echt ist und was simuliert

- **Echt aus der Quelle:** das Übungsnetz (alle Ops, Parameter, Expressions, Binds, Exports, Kabel, DAT-Texte und Tabellen aus `CodeSearch_Tutorial.tdn`). Dazu die Code-Analyse: Methoden, Aufrufe, State-Lese- und Schreibstellen, Zweige und LANDKARTE-Fakten aus den TD-freien Teilen von `CodeModelExt.py`. Die Op-Verweise im Code kommen aus `_op_refs_by_row` von `CodeSearchExt.py`. Alle Beschriftungen, Tooltips und Hilfetexte stammen ebenfalls aus `CodeSearchExt.py`, die Parameter von CodeSearch aus `CodeSearch.tdn`.
- **Nachgebaut:** BranchLab, ColorEngine, Farbmischer und StateLab laufen als Simulation, Zeile für Zeile wie ihr Python-Code. Fire, Route, Palette, Doublefire usw. haben echte Wirkungen und landen in RECORD.
- **Simuliert und so beschriftet:** Cook-Zeiten und RECORD-Dauern. Am Handy gibt es keinen Cook.

## Prüfen ist ehrlich

`Prüfen` wertet dieselben Regeln aus wie `TourExt.Snapshot` + `checks.evaluate` in TD, inklusive Pythons `str(dict)` für `selected`. Es setzt nie selbst einen Wert.

`tools/verify.mjs` geht alle 476 Schritte der Reihe nach durch, wie ein Mensch:

1. Station vorbereiten. Prüfen darf noch **nicht** bestehen.
2. Nur Handgriffe aus `tools/walkthroughs.mjs`: Tippen, Taste, Feld, Parameter. Dieselben Gesten benutzt die App (`js/core/gestures.js`).
3. Danach muss Prüfen bestehen.

Stand: **476/476 bestanden, 0 Fehler.** 5 Schritte bestehen schon ohne Handgriff, genau wie in TD, weil ihre Originalregel nach der Vorbereitung bereits erfüllt ist: #124, #149, #397, #408, #456.

`tools/smoke.mjs` baut für jede Station jeden Tab und für jede Zeile DETAIL, Kopier-Menü und Adresse. Stand: 294 Ansichten, 3.131 Zeilen, 0 Abstürze.

## Korrekturen gegenüber dem TD-Kurs

`tools/course_patches.json`, je mit Grund:

- `n_keys_record` (#462): bekommt `reset_lab`. Seit #379 bleibt Enabled aus. Die neue Aufnahme hätte dann gleich viele Aufrufe wie die letzte, und die Regel „mehr als vorher“ könnte nie bestehen. Derselbe Fehler steckt im TD-Kurs.

## Lokal starten

```sh
python -m http.server 4173
```

Dann `http://127.0.0.1:4173` öffnen.

## Quelle neu bauen

Die Eingaben liegen eingefroren in `source/` (nicht im Repo, siehe `source/FROZEN.sha256`): `lessons.json`, `CodeSearch_Tutorial.tdn`, `CodeSearch.tdn`, `CodeModelExt.py`, `CodeSearchExt.py`, `marker_catalogue.json`, Doku.

```sh
python tools/build_data.py     # data/*.json
node tools/verify.mjs          # 476/476 mit echten Handgriffen
node tools/smoke.mjs           # alle Ansichten ohne Absturz
python tools/build_offline.py  # offline.json, sw.js, ?v= in index.html, CodeSearch-Pocket-offline.html
```

`build_offline.py` muss nach **jeder** Änderung an `js/`, `css/`, `img/` oder `data/` laufen. Die Version ist ein Hash über alle Inhalte. Ändert sie sich, holt der Service Worker beim nächsten Online-Besuch den neuen Stand komplett und löscht den alten.

## Aufbau des Codes

```
js/core/   Logik ohne DOM (auch von verify/smoke benutzt)
  net.js        Netz + Code-Modell, Aufrufgraph
  lab.js        BranchLab, ColorEngine, Farbmischer, StateLab als Simulation
  cs.js         CodeSearch-Fenster als Zustandsmaschine
  views/*.js    Zeilen je Tab (SEARCH … AUDIT, ROUTE, WARUM, State-Atlas)
  tour.js       Vorbereitung, Snapshot, Prüfregeln wie TourExt
  gestures.js   jeder Handgriff als Funktion (App und verify rufen nur diese)
  phone.js      Desktop-Handgriffe → AM HANDY
js/ui/     Zeichnen: Fenster, Tour-Karte, Ebenen (TD, Kurs, Atlas, FlowLens, Popups, Offline)
  offline.js    Speicherstand prüfen, Fehlendes nachladen, Speicher schützen, Installieren
sw.js      Service Worker (erzeugt): speichert jede Datei aus offline.json, liefert ohne Netz aus dem Speicher
tools/     build_data.py, build_offline.py, verify.mjs, smoke.mjs, walkthroughs.mjs, abschluss.json, course_patches.json
```
