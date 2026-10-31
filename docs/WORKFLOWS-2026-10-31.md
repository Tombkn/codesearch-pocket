# SignalGarden: acht Workflows für iPhone und Laptop

Referenz: CodeSearch 1.9.0, Commit `9a9dac1f21a86050073c9f7b729e33597b3e87e5`. Pocket: 584 Stationen / 45 Kapitel; native Tour: 558 / 43. Neue Strecke: Kapitel 36–43, je zwölf Stationen. Die ersten 462 nativen Lektionen bleiben in ihrer bisherigen Reihenfolge; die bisherigen 26 Pocket-Ergänzungen folgen nach den neuen Workflows.

| Kapitel | Workflow | Konkretes Ergebnis |
|---|---|---|
| 36 | Orientierung | Komponenten, Suchbereich, Entry Point und einen tatsächlichen Versuch belegen |
| 37 | Ganze Extension | SensorExt vom Lifecycle über Callback und Public API bis zum State lesen |
| 38 | Datenfluss | Palette → Request → Tick → TOP nachvollziehen und eine Farbänderung prüfen |
| 39 | State | Settings, Runtime-Felder, Momentaufnahme, Trackingverlust, Reset und Re-Init unterscheiden |
| 40 | Aufrufwege | TRIGGERS, CALL PATH, ROUTE und RECORD auf dieselbe Frage anwenden |
| 41 | Fehlersuche | Doppelten Request eingrenzen, beheben und einen zweiten Fehler in der Palette prüfen |
| 42 | Änderungen prüfen | Geänderte Schwelle vergleichen, Belege kopieren und einen zusätzlichen Writer in der Vorschau erkennen |
| 43 | Eigenständige Analyse | Ohne eingeblendete Lösung untersuchen, eigenen Bericht schreiben, Methode auf ein fremdes Projekt übertragen |

Der [vollständige Kurs](https://github.com/Tombkn/td-codesearch/blob/9a9dac1f21a86050073c9f7b729e33597b3e87e5/docs/SIGNALGARDEN_WORKFLOWS.md) enthält Auftrag, getrennte Laptop-/iPhone-Schritte, erwartete Beobachtung und Gegenprobe für jede Station. Eine Anleitung für ein fremdes Projekt ist kein automatischer Nachweis, dieses Projekt vollständig zu verstehen.

## Bedienen und wiederholen

Die große Lernansicht bleibt scrollbar, die Lesestelle bleibt beim Wechsel Lesen/Üben erhalten. Das SignalGarden-Parameterblatt hat eigene Tabs für Root, Sensor, Scenes und Palette. Eingaben bleiben beim Bearbeiten stabil; Parameteraktionen behalten ihre Scrollposition. Ein lokales Re-Init von Sensor oder Scenes setzt nur den jeweiligen Runtime-State zurück.

Die Pointer-Logik verwirft nachlaufende Clicks nach Bewegungen über zehn Pixel, Browser-Abbruch oder langem Drücken. Ein zweiter Finger und Scroll-Events brechen ausstehende Hold-Aktionen ab. Unveränderte Listen und Bedienelemente bleiben im DOM stehen. Auf Geräten mit grobem Pointer erhalten Buttons mindestens 44 Pixel Höhe/Breite; der Listenteiler erhält 24 Pixel Höhe. Die Regeln erlauben normales Browser-Scrollen und Pinch-Zoom. Das sind Implementierungen und Testbedingungen, kein gemessener Flüssigkeitsnachweis.

Nach Reload oder neuem Kapitelstart wird der Workflow am Anfang vorbereitet. Historische Häkchen bleiben erhalten; zum Weitergehen muss die aktuelle Station frisch geprüft werden. Fehlende Handgriffe werden nicht automatisch nachgespielt. Neue RECORD-Aufnahmen und Fall-IDs verhindern die Verwendung alter Versuche als neuen Nachweis. Fälle verschiedener Analysebereiche werden nicht miteinander verglichen.

## Ausgeführte Prüfungen und Grenzen

- Alle 584 Stationen wurden mit Gestenfunktionen durchlaufen: keine Fehler und keine Station, die unmittelbar nach der Vorbereitung schon bestanden war.
- Zwölf gemeinsame SignalGarden-Szenarien prüfen den JavaScript-Nachbau. Die native Seite hat dieselben zwölf Szenarien zusätzlich in TouchDesigner 2025.33230 unter Windows ausgeführt.
- Sieben gezielte Workflow-Gegenproben und fünf Fortschrittstests prüfen Scope, frische Aufnahmen, Wiederaufnahme und bestehende Lesestellen.
- Acht Pointer-Tests prüfen die Auslösung und Unterdrückung von Aktionen. 25 App-DOM-Checks prüfen echte App-Handler, Eingaben, Lesen/Üben, erhaltene DOM-Knoten und Scrollpositionen. jsdom besitzt weder Layout noch native Touch-Physik.
- Native Release-Dateien wurden in einem zweiten sauberen TouchDesigner-Prozess aus einem anderen Projektordner geladen. Zehn Quellen stimmten überein; beide Komponenten hatten 0 Errors/Warnings. [Nativer Prüfbericht](https://github.com/Tombkn/td-codesearch/blob/9a9dac1f21a86050073c9f7b729e33597b3e87e5/docs/SIGNALGARDEN_VALIDATION.md).

**Offen:** echter iPhone/Safari-Test von Scroll-Trägheit, Bildschirmtastatur, Pinch-Zoom, Offline-Neustart und durchgehend flüssiger Bedienung; Android/Chrome-Gerätetest; macOS; vollständiger manueller Durchlauf aller 96 neuen nativen Stationen. Der Browser-Connector war nicht verfügbar; die native Browsersteuerung zeigte nach Eingaben keine verlässlich geänderte Seite. Daraus wird kein Browsernachweis abgeleitet.

Kurze Geräteabnahme: In Kapitel 36 eine lange Lektion bis unten und zurück wischen; Lesen/Üben mehrfach wechseln; Tabs horizontal wischen; in SignalGarden Sensor.Value bearbeiten und Sample drücken; eine Ergebniszeile lange drücken, danach scrollen und eine andere Zeile doppelt tippen. Es darf kein unbeabsichtigter Aufruf entstehen, die Lesestelle muss erhalten bleiben und alle Aktionen müssen erreichbar sein. Dies wurde hier nicht auf einem echten iPhone ausgeführt.
