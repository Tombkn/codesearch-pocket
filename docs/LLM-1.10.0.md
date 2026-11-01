# LLM ANALYSE und Mitmachkurs 1.10.0

**LLM ANALYSE** verbindet deine Frage mit einem festen Belegpaket. Du wählst Verstehen, Fehler eingrenzen oder Änderung prüfen, kopierst den Auftrag in deinen vorhandenen Chat und importierst dessen JSON. Pocket verlangt keinen neuen Modellanbieter.

## Im Kurs ausprobieren

Kapitel **44–45** enthalten 16 neue LLM-Stationen. Kapitel **46** ergänzt 14 Stationen zum dauerhaften SPEC-Arbeitsplatz. Kapitel **47–50** führen in 22 Stationen durch die erweiterten Bedienabläufe. Der vollständige Kurs umfasst **636 Stationen in 52 Kapiteln**: alle 610 Laptop-Stationen plus 26 zusätzliche Abschluss- und Werkstattaufgaben.

1. Frage formulieren und Paket-ID, Revision und Abdeckung lesen.
2. Fehlenden Kontext über gültige Vorlagen nachfordern: State-/Symbol-Verzeichnisse, Source-Ausschnitte, gerichtete Calls und Events.
3. Strukturierte Aussagen prüfen und ihre Belege öffnen. Freier LLM-Kommentar bleibt sichtbar ungeprüft.
4. Falsche Paket-ID und falsche Revision selbst als Gegenprobe importieren.
5. RECORD-Ereignisse und gegenwärtige Source unterscheiden.
6. Einen Änderungsvorschlag als Diff prüfen und den tatsächlichen Prüfbericht an den Chat zurückgeben.

Jede Station nennt Ausgangspunkt, eigene Aktion, erwartetes Ergebnis, Laptop-Handgriffe, iPhone-Handgriffe und eine Gegenprobe oder Grenze. Die Prüfung verlangt neue Aktionen. Alte Häkchen stellen weder Pakete noch laufenden State wieder her; ein Kapitel-Neustart beginnt beim bekannten Ausgangspunkt.

## Bedienung

Die Lernansicht bleibt groß und separat scrollbar. **Zur Übung** führt zum nachgebildeten Projekt; **Lektion lesen** zurück zur Lesestelle. Das Analyseformular bietet eine direkt editierbare Frage und große Aktionsbuttons. Vorlagen erhalten die aktuellen Paketkennungen und werden erst nach deiner bewussten Übernahme importiert.

**Kopieren** zeigt erst nach erfolgreichem Browserzugriff eine bestätigte Geräte-Kopie. Bei fehlendem oder verweigertem Clipboard-Zugriff bleibt der exakte Text erhalten. **Text manuell kopieren → Text markieren** bietet einen eigenen Weg. Die interne Pocket-Zwischenablage und die iPhone-Zwischenablage sind getrennt; eine spätere Fehlermeldung eines alten Kopierversuchs überschreibt keinen neueren Status.

Die Versionsanzeige und alle Laptop-Quellenlinks werden beim Build aus demselben `upstream.json` erzeugt. So führen neue Kurskarten zum passenden Quellstand.

## Gewünschtes Verhalten und tatsächliche Versuche

**SPEC** hält Ziel, Grenzen und Requirements dauerhaft fest. Die 14 Stationen führen eine Änderung der Sensorgrenze durch: Baseline aufnehmen, Setting ändern, Gegenprobe ausführen und eine falsche Vorgeschichte erkennen. JSON erhält Requirements, Revisionen und Belegpakete zusammen; Markdown ist der daraus erzeugte lesbare Export für Git. Pocket speichert lokal und bietet Datei-Import und -Export. Am Laptop liegen die Dateien unter `.codesearch/specs` im Projektordner.

Ein Snapshot-Report prüft nur den angegebenen Wert. Er führt die frei formulierten Given-/When-Schritte nicht aus. Manuelle Beobachtungen bleiben `not_checked`; importierte Reports gelten als historisch dokumentiert. Der Kurs erklärt diese Grenzen anhand eigener Versuche.

Die letzte Spec-Station ordnet Requirements, Revisionen, Beleg-IDs und geprüfte Versuche den Specify/Plan/Tasks/Progress-Dateien von [td-system-kit](https://github.com/Tombkn/td-system-kit) zu. Das ist eine nachvollziehbare Übergabe; Pocket überschreibt keine GitHub-Dateien und bestätigt keine offenen Aufgaben automatisch.

## Bedienbare Zweitansichten und historische Kopien

**ZWEITANSICHT ↗ ▾** bietet die aktuelle Ansicht, Details und Code als LIVE-Fenster. Aktionen arbeiten am gemeinsamen Ziel, einschließlich Parameter, TABLE-Änderungen, Analyse und SPEC. **Groß ↗ / Klein ↙** wechselt zwischen verfügbarer Bildschirmfläche und kompakter Karte. Alle Ansichten folgen dem gewählten Look; die Code-Schrift hat einen eigenen Regler und der Codebereich eine ziehbare Kante. Die vier angepassten Fenster-Stationen erklären Laptop- und iPhone-Bedienung.

Historische Analysebelege bleiben ausdrücklich eingefroren und bekommen keine ausführbaren Reparaturaktionen. Damit verwechselt man einen früheren Befund nicht mit dem aktuellen Projekt. **Kopieren** im Kartentitel übernimmt Klartext; ausgewählte Methoden können außerdem gezielt als Code, Fundstellen oder begrenztes Analysepaket kopiert werden.

## Zusammenhängende Arbeitsplatzübungen

Die vier zusätzlichen Kapitel behandeln TABLE Undo/Redo, Mehrfachauswahl, Vollcode, bis zu vier unabhängige Suchfenster, fixierten FLOW und eine zweite Network-Ansicht. Über Rechtsklick oder langes Drücken auf **DIESE COMP** öffnet sich das COMP-Menü. Die Promotion-Übung zeigt erst die Vorschau, übernimmt dann sechs Controls am SignalGarden-Sensor und prüft Bindung, Pulse sowie Undo/Redo.

Pocket führt Promotion ausschließlich an den dokumentierten SignalGarden-Modellen aus; andere Komponenten zeigen ihre Grenze in der Vorschau. Der Laptop arbeitet am echten COMP. Die 24 Looks umfassen acht zusätzliche Graphite-Varianten; Glass-Looks verwenden dieselben lesbaren Operator- und Codefarben.

## Prüfgrenzen

Pocket analysiert und simuliert das mitgelieferte Übungsprojekt. Es greift nicht auf ein beliebiges laufendes TouchDesigner-Projekt zu. Vorschläge werden nicht als Python ausgeführt. Die Pocket-Vorschau unterstützt nur den dokumentierten Teilbereich einfacher angehängter Methoden; die native Version bietet die ausführlichere Python-Analyse.

Automatische Kurs-, Protokoll-, DOM-, Gesten- und Paketprüfungen sind reproduzierbare Logiktests. Sie belegen keine flüssige Bedienung auf einem physischen iPhone, kein Safari-Auswahlmenü und keine native Laptop-Tastaturwirkung. Die tatsächlichen TouchDesigner-Prüfungen stehen im Prüfbericht des gebundenen Laptop-Releases.

## Agenda – Begriffe & Methoden

- **Belegpaket:** unveränderliche Auswahl von Code und beobachteten Daten.
- **Revision:** Kennung eines Quelltextstands.
- **Diff:** sichtbarer Textunterschied zwischen vorhandenem und vorgeschlagenem Code.
- **DOM:** die vom Browser aufgebaute Struktur der Webseite.
- **Clipboard:** Zwischenablage für kopierte Texte.
