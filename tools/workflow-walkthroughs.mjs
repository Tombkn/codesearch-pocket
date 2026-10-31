// Unabhängig redigierte Handgriffe für alle 96 Aufgaben. Keine erwarteten Werte setzen.
const pick = (g, name) => g.tapRow((h) => h.ctx === name && ['method', 'symbol', 'state', 'parstate', 'entry', 'record'].includes(h.kind));
const workspace = (fn) => (g) => { g.workspace(); fn(g); g.seen(); };
const method = (name) => workspace((g) => pick(g, name));
const cmd = (command) => workspace((g) => g.enter('>' + command));
const search = (word, scope = 'currentpane') => workspace((g) => { g.scope(scope); g.filter('code'); g.type(word); });
const flow = (name) => workspace((g) => g.tapRow((h) => h.path?.includes('SignalGarden') && h.path.endsWith('/' + name)));
const route = (name, key = 'Ctrl+Shift+I') => workspace((g) => { pick(g, name); g.key(key); });
const callpath = workspace((g) => { g.tab('entries'); pick(g, 'onParSubmit'); g.key('Ctrl+Enter');
  g.tapRow((h) => h.ctx === 'Submit'); g.key('Ctrl+Enter'); });
const map = (name) => workspace((g) => { g.enter('>landkarte'); pick(g, name); });
const set = (g, owner, name, value) => g.gardenPar(owner, name, value);
const pulse = (g, name = 'Submit', owner = 'root') => g.gardenPulse(owner, name);
const steps = (g, n) => { for (let i = 0; i < n; i++) pulse(g, 'Step'); };
const record = (before, action) => workspace((g) => { before?.(g); g.record('start'); action(g); g.record('stop'); });
const normal = record((g) => set(g, 'sensor', 'Value', 0.7), (g) => pulse(g));
const step = record(null, (g) => steps(g, 1));
const table = (fn = () => {}) => workspace((g) => { g.type('warm'); g.tableTap(2, 1); fn(g); });
const GROUPS = {
  orientation: [cmd('system'), workspace((g) => g.overview('ext')), method('Submit'), search('Sample'), search('Sample', 'currentflat'),
    method('Sample'), method('Sample'), method('onParSubmit'), cmd('system'), normal, flow('level'), cmd('system')],
  extension: [method('Sample'), method('__init__'), method('onInitTD'), method('onDestroyTD'), method('onParSample'), method('Sample'),
    method('Sample'), map('Sample'), method('_present'), method('ResetRuntime'),
    record(null, (g) => { for (const v of [0.7, 0.5, 0.3]) { set(g, 'sensor', 'Value', v); pulse(g, 'Sample', 'sensor'); } }), cmd('system')],
  dataflow: [flow('level'), flow('color'), method('_publish'), method('Request'), method('Resolve'), table(),
    table((g) => g.tableEdit(2, 1, '0.5')), method('Submit'), normal, step, record(null, (g) => steps(g, 3)), flow('PaletteExt')],
  state: [cmd('states'), method('_present'), method('evalValue'), method('_requests'), method('_rgb'), cmd('fall vorher'),
    record((g) => set(g, 'sensor', 'Value', 0.7), (g) => { pulse(g); steps(g, 2); }), cmd('fall halb'), cmd('vergleich'),
    record((g) => set(g, 'sensor', 'Valid', false), (g) => pulse(g)),
    workspace((g) => { pick(g, 'ResetRuntime'); pulse(g, 'Reset', 'scenes'); }),
    workspace((g) => { g.gardenReinit('scenes'); pick(g, 'onInitTD'); })],
  calls: [method('onParSubmit'), method('onParSubmit'), callpath, callpath,
    route('Request'), map('Submit'), normal,
    workspace((g) => g.tapRow((h) => h.ctx === 'Request' || (h.kind === 'record' && h.text.includes('Request')))),
    record((g) => set(g, 'root', 'Enabled', false), (g) => pulse(g)),
    record((g) => { set(g, 'root', 'Enabled', true); set(g, 'root', 'Doubledispatch', true); }, (g) => pulse(g)), method('Request'), step],
  debug: [cmd('system'), cmd('fall vor_fehler'), normal, workspace((g) => { g.enter('>fall doppelt'); g.enter('>vergleich'); }),
    method('_requests'), route('Request'), search('*Doubledispatch*'), workspace((g) => { pick(g, 'Submit'); set(g, 'root', 'Doubledispatch', false); }),
    record(null, (g) => pulse(g)), table((g) => { g.tableEdit(2, 1, 'kaputt'); pulse(g); }), method('_readColor'),
    workspace((g) => { pulse(g, 'Restore', 'palette'); g.record('start'); pulse(g); steps(g, 4); g.record('stop'); g.enter('>review'); })],
  change: [cmd('system'), method('Sample'), route('_present', 'Ctrl+I'), route('Sample'),
    record((g) => set(g, 'sensor', 'Value', 0.65), (g) => pulse(g)),
    workspace((g) => { g.enter('>fall schwelle_alt'); pulse(g, 'Reset', 'sensor'); set(g, 'sensor', 'Enter', 0.7); }),
    record(null, (g) => pulse(g)), workspace((g) => { g.enter('>fall schwelle_neu'); g.enter('>vergleich'); }), cmd('untersuchung kopieren'),
    workspace((g) => { g.enter('>beispiel vorschau'); g.enter('>vorschau'); }), method('Request'),
    record((g) => { set(g, 'sensor', 'Enter', 0.6); pulse(g, 'Reset', 'sensor'); }, (g) => { pulse(g); steps(g, 4); })],
  independent: [cmd('system'), method('onParSubmit'), method('_present'), method('Sample'), route('Sample'), method('_readColor'),
    flow('level'), normal, step, cmd('fall eigen'), (g) => g.seen(), (g) => g.seen()],
};
export const WORKFLOW_SCRIPTS = Object.fromEntries(Object.entries(GROUPS).flatMap(([workflow, scripts]) =>
  scripts.map((fn, i) => [`sg_${workflow}_${String(i + 1).padStart(2, '0')}`, fn])));
