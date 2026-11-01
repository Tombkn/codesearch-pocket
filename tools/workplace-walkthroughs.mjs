// Bedienfolgen für die 22 Arbeitsplatz-Stationen; nur öffentliche Aktionen.
// Scrollposition, Trennkante und Touch-Fokus benötigen zusätzlich einen Browser-/Gerätetest.
const method = (name) => (hit) => hit.kind === 'method' && hit.ctx === name;
const followStation = (hit) => hit.kind === 'chain' && hit.dist > 0;
const observed = (action) => (g) => { action(g); g.seen(); };
const promotionPreview = (g) => {
  g.compMenu();
  g.menu('Parameter nach oben');
};

export const WORKPLACE_SCRIPTS = {
  workspace_01: observed((g) => {
    g.workspace(); g.tableTap(1, 1); g.tableEdit(1, 1, '0.42');
    g.cs.floatList();
  }),
  workspace_02: observed((g) => g.key('Ctrl+Z')),
  workspace_03: observed((g) => g.key('Ctrl+Y')),
  workspace_04: observed((g) => {
    g.workspace(); g.netEnter('BranchLab'); g.tab('trace'); g.context('comp');
  }),
  workspace_05: observed((g) => { g.tab('refs'); g.context('comp'); }),
  workspace_06: observed((g) => {
    g.workspace();
    g.tapRow(method('Fire')); g.tapRow(method('Notify'), {ctrl: true});
    g.tapRow(method('Fire'), {ctrl: true}); g.tapRow(method('Fire'), {ctrl: true});
    g.key('Ctrl+C');
  }),
  workspace_07: observed((g) => {
    g.rowMenu(method('Fire')); g.menu('Quellcode der Auswahl kopieren');
  }),
  workspace_08: observed((g) => {
    g.tapRow(method('Fire')); g.cs.setCodeFull(true); g.cs.setCodeZoom(1.5);
    g.cs.floatCopy('details');
  }),
  workspace_09: observed((g) => {
    g.key('Ctrl+P'); g.quickType('Sample'); g.cs.quickScope('comp:SignalGarden');
  }),
  workspace_10: observed((g) => {
    g.cs.quickOpen(true); g.quickType('Fire'); g.cs.quickScope('comp:StateLab');
    g.cs.quickOpen(true); g.quickType('gain'); g.cs.quickScope('comp:BranchLab');
    // Ein weiteres Fenster (Limit ist zehn) darf keine bestehende Frage ersetzen; danach wieder schließen.
    const before = g.cs.state.searchWindows.filter((item) => item.open).map((item) => item.id);
    const extra = g.cs.quickOpen(true);
    if (!extra || before.includes(extra.id)) throw new Error('Weiteres Suchfenster hat ein bestehendes ersetzt.');
    g.cs.quickClose(extra.id);
  }),
  workspace_11: observed((g) => {
    const sample = g.cs.state.searchWindows.find((item) => item.open && item.query === 'Sample');
    const other = g.cs.state.searchWindows.find((item) => item.open && item.id !== sample?.id);
    if (!sample || !other) throw new Error('Die vorherigen Zusatzsuchen fehlen.');
    g.cs.quickActivate(sample.id); g.cs.quickOption('regex', true); g.quickType('([)');
    if (!sample.error) throw new Error('Ungültiges Regex-Muster erzeugt keine Fehlermeldung.');
    g.cs.quickActivate(other.id);
    g.cs.quickActivate(sample.id); g.quickType('Sample|Fire');
  }),
  workspace_12: observed((g) => {
    for (const search of g.cs.state.searchWindows.filter((item) => item.open)) {
      g.cs.quickActivate(search.id); g.key('Esc');
    }
  }),
  workspace_13: observed((g) => {
    g.cs.flowPin(true); g.tapRow(followStation); g.netEnter('SignalGarden');
  }),
  workspace_14: observed((g) => {
    g.rowMenu(followStation); g.menu('RECHTS IM ZWEITEN NETZWERK ÖFFNEN');
    g.cs.secondaryNetwork('enter', 'SignalGarden/Sensor');
    g.cs.secondaryNetwork('select', 'SignalGarden/Sensor/SensorExt');
  }),
  workspace_15: observed((g) => {
    g.cs.flowFilter('direction', 'up'); g.cs.flowFilter('direction', 'down');
    g.cs.flowFilter('family', 'top'); g.cs.flowFilter('family', 'all');
  }),
  workspace_16: observed((g) => { g.cs.flowRefresh(); g.enter('>story'); }),
  workspace_17: observed((g) => { promotionPreview(g); g.key('Esc'); }),
  workspace_18: observed((g) => {
    promotionPreview(g); g.enter();
    g.netEnter('SignalGarden'); g.compMenu(); g.menu('Parameter ansehen');
    g.netEnter('SignalGarden/Sensor');
  }),
  workspace_19: observed((g) => {
    g.netEnter('SignalGarden'); g.gardenPar('root', 'Value', 0.83);
    g.netEnter('SignalGarden/Sensor');
  }),
  workspace_20: observed((g) => { g.key('Ctrl+Z'); g.key('Ctrl+Z'); }),
  workspace_21: observed((g) => { g.key('Ctrl+Y'); promotionPreview(g); g.key('Esc'); }),
  workspace_22: observed((g) => {
    for (const label of ['USES', 'USED BY', 'FLOW', 'USES']) {
      g.compMenu(); g.menu(label);
    }
    g.compMenu(); g.menu('COMP-Pfad kopieren');
  }),
};
