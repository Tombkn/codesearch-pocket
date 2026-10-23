# CodeSearch Pocket

Der vollständige CodeSearch-Kurs auf dem Handy: **459 Schritte in 34 Kapiteln**, dasselbe Fenster (Suche, Liste, Detail, Status), dasselbe StateLab, dieselben Prüfregeln.

Stand der Quelle: `codesearch_lab` vom 23.10.2026, einschließlich State-Atlas und der sieben LLM-Werkzeuge.

## Auf dem Handy

1. Seite öffnen (GitHub Pages-Adresse).
2. iPhone: Teilen → **Zum Home-Bildschirm**.
3. Android: Menü → **App installieren** / Zum Startbildschirm.

Danach läuft der Kurs auch offline.

## Bedienung

- Unten die Karte **JETZT DU**. Hochziehen für Warum, Grenze, Glossar und Prüfung.
- Im Fenster die echte Geste: Tab wählen, Zeile antippen, `>states` tippen, Fire drücken.
- **Gesehen** für Lexikon-Karten. **Prüfen** wertet die Originalregeln aus.
- **KURS** ist die Kapitelkarte. **ATLAS** sind die sieben Werkzeuge plus State-Atlas-Text.

Der Fortschritt bleibt auf diesem Gerät.

## Lokal

```sh
python -m http.server 4173
```

Dann `http://127.0.0.1:4173` öffnen.

## Quelle neu packen

```sh
python tools/build_data.py
node tools/verify.mjs
```

`verify` muss `459/459` liefern.
