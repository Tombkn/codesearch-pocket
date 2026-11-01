// Uebersetzt Desktop-Handgriffe aus dem Lektionstext in Handy-Handgriffe ("AM HANDY") und nennt die Tasten,
// die die Tastenleiste hervorheben soll. Der Originaltext bleibt unveraendert - so lernt man die echten Kuerzel.

const KEY_ALIASES = [
  [/Strg\s*\+\s*Umschalt\s*\+\s*I|Ctrl\s*\+\s*Shift\s*\+\s*I/i, "Ctrl+Shift+I"],
  [/Alt\s*\+\s*Shift\s*\+\s*A/i, "Alt+Shift+A"],
  [/Alt\s*\+\s*Shift\s*\+\s*K/i, "Alt+Shift+K"],
  [/Ctrl\s*\+\s*Shift\s*\+\s*K|Strg\s*\+\s*Umschalt\s*\+\s*K/i, "Ctrl+Shift+K"],
  [/Ctrl\s*\+\s*Alt\s*\+\s*Links|Strg\s*\+\s*Alt\s*\+\s*←/i, "Ctrl+Alt+Left"],
  [/Ctrl\s*\+\s*Alt\s*\+\s*Rechts|Strg\s*\+\s*Alt\s*\+\s*→/i, "Ctrl+Alt+Right"],
  [/Alt\s*\+\s*←|Alt\s*\+\s*Pfeil links/i, "Alt+Left"],
  [/Alt\s*\+\s*→/i, "Alt+Right"],
  [/Ctrl\s*\+\s*Rechts|Strg\s*\+\s*→/i, "Ctrl+Right"],
  [/Ctrl\s*\+\s*Enter|Strg\s*\+\s*Enter/i, "Ctrl+Enter"],
  [/Ctrl\s*\+\s*I\b|Strg\s*\+\s*I\b/, "Ctrl+I"],
  [/Ctrl\s*\+\s*P\b|Strg\s*\+\s*P\b/, "Ctrl+P"],
  [/Ctrl\s*\+\s*F\b|Strg\s*\+\s*F\b/, "Ctrl+F"],
  [/Ctrl\s*\+\s*C\b|Strg\s*\+\s*C\b/, "Ctrl+C"],
  [/Ctrl\s*\+\s*R\b|Strg\s*\+\s*R\b/, "Ctrl+R"],
  [/Ctrl\s*\+\s*G\b|Strg\s*\+\s*G\b/, "Ctrl+G"],
  [/Ctrl\s*\+\s*Shift\s*\+\s*Z|Strg\s*\+\s*Umschalt\s*\+\s*Z/i, "Ctrl+Shift+Z"],
  [/Ctrl\s*\+\s*Y\b|Strg\s*\+\s*Y\b/, "Ctrl+Y"],
  [/Ctrl\s*\+\s*Z\b|Strg\s*\+\s*Z\b/, "Ctrl+Z"],
  [/Ctrl\s*\+\s*Plus|Strg\s*\+\s*Plus/i, "Ctrl+Plus"],
  [/Alt\s*\+\s*0/, "Alt+0"],
  [/Alt\s*\+\s*P\b/, "Alt+P"],
  [/Alt\s*\+\s*F\b/, "Alt+F"],
  [/Alt\s*\+\s*D\b/, "Alt+D"],
  [/\bF6\b/, "F6"],
  [/\bEsc\b/, "Esc"],
  [/(?<!Ctrl\s*\+\s*|Strg\s*\+\s*|\bohne\s)\bEnter\b/, "Enter"],
  [/\bCtrl\b(?!\s*\+)|\bStrg\b(?!\s*\+)/, "STRG"],
  [/[←→]/, "Left"],
  [/[↑↓]/, "Down"],
];

export function keysFor(text) {
  const out = [];
  const source = String(text || "");
  for (const [rx, key] of KEY_ALIASES) {
    if (rx.test(source) && !out.includes(key)) out.push(key);
  }
  if (out.includes("Left") && !out.includes("Right")) out.push("Right");
  if (out.includes("Down")) out.push("Up");
  return out;
}

export function phoneSteps(lesson) {
  if (lesson.phone_steps) return lesson.phone_steps;
  const text = String(lesson.action || "");
  const steps = [];
  const add = (s) => { if (!steps.includes(s)) steps.push(s); };
  const tabHelp = lesson.id === 'help' || (/\bAlt\b/i.test(text) && /\bTab\b|Tab-Hilfe|eingeblendete Hilfe/i.test(text));
  if (/Rechtsklick|Kontextmen/i.test(text)) add("Rechtsklick = die Zeile lange gedrückt halten → Menü.");
  if (/Doppelklick|Doppelklicke/i.test(text)) add("Doppelklick = zweimal schnell tippen.");
  if (/Strg\s*\+\s*Alt\s*\+\s*Klick|Strg\+Alt und klicke|Halte Strg\+Alt/i.test(text)) add("Strg+Alt+Klick = in der Tastenleiste STRG und ALT antippen, dann das Wort im Code antippen.");
  else if (/(Ctrl|Strg)\s*\+\s*Klick|Halte Strg und klicke/i.test(text)) add("Strg+Klick = in der Tastenleiste STRG antippen, dann tippen.");
  if (/Alt\s*\+\s*Klick/i.test(text)) add("Alt+Klick = in der Tastenleiste ALT antippen, dann die Zeile tippen.");
  if (tabHelp) add("Tab-Hilfe am iPhone: den genannten Tab lange gedrückt halten. Mit Maus und Tastatur: Maus zuerst über den Tab, dann Alt allein drücken.");
  const keys = keysFor(text).filter((k) => !["STRG", "Left", "Right", "Down", "Up"].includes(k));
  if (keys.length) add(`Tasten: ⌨ öffnet die Tastenleiste – ${keys.join(" · ")} (hervorgehoben).`);
  if (/[←→↑↓]|Pfeiltasten/.test(text)) add("Pfeile: in der Tastenleiste ← → ↑ ↓.");
  if (/Netzwerk|TD-Netz|Network Editor|TD-Hauptfenster|im Netz /i.test(text)) add("TD-Netzwerk = Knopf TD oben links → NETZ: Op antippen markiert ihn, Doppeltippen öffnet einen COMP.");
  if (/Timeline|Play\b/i.test(text)) add("Timeline: TD → TIMELINE → ▶ PLAY.");
  if (/Arbeitsplatz/.test(text)) add("„Arbeitsplatz“ = Knopf direkt unter JETZT DU: richtet CodeSearch und das Übungsnetz für diese Station ein.");
  if (/Lab-Parameter/i.test(text)) add("„Lab-Parameter“ = Knopf auf dieser Karte (öffnet die Parameter von BranchLab bzw. StateLab).");
  const firePress = /(dr(ü|ue)cke|puls|Pulse)[^.]{0,40}(?<!onPar)\bFire\b|(?<!onPar)\bFire\b[^.]{0,25}(dr(ü|ue)cken|pulsen|STOP)/i;
  if (firePress.test(text) && !/Lab-Parameter/i.test(text)) add("Fire pulsen = Karte → Lab-Parameter → FIRE (oder TD → PARAMETER).");
  if (firePress.test(text) && /Lab-Parameter/i.test(text)) add("Dort FIRE antippen; mit ✕ zurück zu CodeSearch.");
  if (/CS-Parameter|CodeSearch-Parameter|Parametern|Schalte .* (ein|aus)|Setze (Maxresults|Maxindexage|Recordseconds)/i.test(text)) add("CodeSearch-Einstellungen = Knopf „CS-Parameter“ auf der Karte.");
  if (!tabHelp && /Tooltip|Maus über|Fahre mit der Maus|zeige auf|Zeige auf/i.test(text)) add("Tooltip = die ART-Zelle (links in der Zeile) antippen.");
  if (/Griff|Verschiebe|Maximieren|Minimieren|ziehe/i.test(text)) add("Fenster: — ▢ ✕ oben rechts im CodeSearch-Titel; der Griff zwischen Liste und Detail lässt sich ziehen.");
  if (/[Tt]ippe\b|\btippe\b|ins Feld|in das .*Feld|Suchfeld/.test(text)) add("Tippen = ins Feld oben im CodeSearch-Fenster. >Befehle mit ⏎ bestätigen; Suchwörter ohne ⏎.");
  if (/Markiere|markiere|Waehle|Wähle|wähle|klicke/.test(text) && !steps.length) add("Markieren/Klicken = Zeile antippen.");
  if (/Codex/.test(text)) add("„Codex-Aufgabe kopieren“ legt den Auftrag in die Zwischenablage des Handys.");
  if (/FlowLens|FLOWLENS/.test(text)) add("FLOWLENS ↗ steht in der Kontextleiste unter den Tabs (bei FLOW und den Code-Tabs).");
  if (/BEARBEITEN|UEBERNEHMEN|ÜBERNEHMEN/.test(text)) add("BEARBEITEN steht oben im DETAIL einer Codezeile; im Editor ÜBERNEHMEN oder ABBRECHEN.");
  if (/\bLOOK\b/.test(text)) add("LOOK oben im Titel antippen → einen Look aus Dunkel, Hell oder Hoher Kontrast wählen. Die Farbproben helfen beim Vergleichen.");
  if (/Gesehen/.test(text)) add("„Gesehen“ erst, wenn du es wirklich gelesen hast – dann „Prüfen“.");
  return steps;
}
