// Öffentliche Bedienaktionen, keine direkten Writes in Spec-/Report-State.
const finish = (action) => (g) => { g.enter('>spec'); action(g); g.seen(); };
const field = (g, name, value) => g.enter(`>spec setzen ${name} ${value}`);
function assertion(g, expected) {
  const item = g.specStates().find((state) => state.kind === 'attribute' && state.name.endsWith('SensorExt._present'));
  if (!item) throw new Error('SensorExt._present fehlt im tatsächlichen Spec-Scope');
  g.enter('>spec zustand ' + item.id);
  g.enter('>spec erwartet ' + expected);
}
function sample(g, value, reset = false) {
  g.gardenPar('sensor', 'Value', value);
  if (reset) g.gardenPulse('sensor', 'Reset');
  g.gardenPulse('sensor', 'Sample');
}
function requirement(g, title, given, when, then, counterexample) {
  g.enter('>spec anforderung ' + title);
  for (const [key, value] of Object.entries({given, when, then, counterexample})) field(g, key, value);
}

export const SPEC_SCRIPTS = {
  spec_01: (g) => {
    g.workspace(); g.enter('>spec neu Sensorgrenze nachvollziehbar ändern');
    field(g, 'goal', 'Eine neue Anwesenheit soll erst ab Value 0.7 beginnen.');
    field(g, 'constraints', 'Enter soll 0.7 sein; Exit bleibt 0.4.');
    field(g, 'non_goals', 'Keine Änderungen an Szenen, Farben oder Sample-API.');
    g.seen();
  },
  spec_02: finish((g) => requirement(g, 'Unterhalb der neuen Grenze', 'Sensor nach Reset, Valid=True.',
    'Value=0.65 setzen und genau einmal Sample drücken.', 'Present bleibt False.',
    'Nach Reset bei Value=0.75 wird Present True.')),
  spec_03: finish((g) => assertion(g, 'false')),
  spec_04: finish((g) => { g.enter('>spec speichern'); g.enter('>spec auftrag'); }),
  spec_05: finish((g) => { g.gardenPar('sensor', 'Valid', true); sample(g, 0.65, true); g.enter('>spec pruefen'); }),
  spec_06: finish((g) => { g.gardenPar('sensor', 'Enter', 0.7); sample(g, 0.65, true); g.enter('>spec pruefen'); }),
  spec_07: finish((g) => {
    requirement(g, 'Oberhalb der neuen Grenze', 'Sensor nach Reset, Valid=True, Enter=0.7.',
      'Value=0.75 und einmal Sample.', 'Present=True.', 'Bei 0.65 nach Reset bleibt Present=False.');
    assertion(g, 'true'); sample(g, 0.75, true); g.enter('>spec pruefen');
  }),
  spec_08: finish((g) => {
    requirement(g, 'Zwischenbereich hält Anwesenheit', 'Present=True nach gültigem Sample bei Value=0.75; Enter=0.7 und Exit=0.4.',
      'Value=0.5 und einmal Sample, ohne Reset.', 'Present bleibt True.', 'Nach Reset bei Value=0.5 bleibt Present False.');
    assertion(g, 'true'); sample(g, 0.5); g.enter('>spec pruefen');
  }),
  spec_09: finish((g) => { sample(g, 0.5, true); g.enter('>spec pruefen'); }),
  spec_10: finish((g) => field(g, 'given', 'Zuerst gültiges Sample bei 0.75, Present=True sichtbar prüfen; danach kein Reset vor dem 0.5-Sample.')),
  spec_11: finish((g) => { sample(g, 0.75, true); sample(g, 0.5); g.enter('>spec pruefen'); }),
  spec_12: finish((g) => {
    g.specObservation('Reset; Value0.75→Sample; PresentTrue gelesen; Value0.5→Sample ohne Reset.',
      'Present blieb True; nur Tutorial-Sensor geprüft, keine echte Hardware.');
    g.enter('>spec speichern');
  }),
  spec_13: finish((g) => { g.enter('>spec exportieren'); g.enter('>spec importieren'); }),
  spec_14: finish((g) => { g.enter('>spec markdown'); g.enter('>spec auftrag'); }),
};
