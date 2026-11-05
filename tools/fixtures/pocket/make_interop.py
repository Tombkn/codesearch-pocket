"""Baut Interop-Pakete mit dem ECHTEN Python-Exporter (td-codesearch, nur gelesen) fuer den Pocket-Test.

Warum: der JS-Paketbauer in tools/projects-core-tests.mjs bildet den Exporter nur nach. Genau dort lagen die Fehler
der ersten Bauwelle (Extension-COMP, dynamischer Verweis, Platzhalter, gekuerzte Tabelle, uebergrosse Expression):
die JS-Vektoren waren gruen, echte Pakete wurden abgelehnt. Diese Dateien kommen aus cs_pocket_export.build_package
(und fuer die Analyse aus cs_pocket_analysis.analyze), sind also echte Exporter-Ausgabe.

Eigentuemer der gemeinsamen Testvektoren bleibt td-codesearch (Vertrag 16, tests/fixtures/pocket). Diese Sammlung
ergaenzt sie um Faelle, die dort noch fehlen; sie wird nicht von Hand bearbeitet.

Alle Inhalte sind synthetisch: keine Projektquellen, keine echten Tokens (der Geheimnis-Fall nutzt den Kanarienwert
"ghp_" + 36 x "A", der im Paket ausgelassen wird).

Aufruf:  python -I -B tools/fixtures/pocket/make_interop.py [--td-codesearch PFAD] [--write]
Ohne --write wird nur neu gebaut und mit den Dateien verglichen (Drift-Pruefung).
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType

HERE = Path(__file__).resolve().parent
OUT = HERE / 'py-interop'
DEFAULT_TD_CODESEARCH = HERE.parents[3] / 'td-codesearch'
CANARY = 'ghp_' + 'A' * 36                     # token-foermig, aber kein echtes Token (Vertrag 8, Kanarien-Test)
ROOT = '/project1/Interop'


def load(td_codesearch: Path) -> tuple:
    """Exporter, Vektor-Helfer und Analyse nur lesend laden (kein Schreiben in td-codesearch)."""
    src = td_codesearch / 'src'
    fixtures = td_codesearch / 'tests' / 'fixtures' / 'pocket'
    for path in (src, fixtures):
        if not path.is_dir():
            raise SystemExit('td-codesearch nicht gefunden: ' + str(path))
    sys.path.insert(0, str(src))
    sys.path.insert(0, str(fixtures))
    import cs_pocket_export as pe              # noqa: E402  (Pfad erst zur Laufzeit bekannt)
    import make_vectors as mv                  # noqa: E402
    spec = importlib.util.spec_from_file_location('cs_pocket_analysis', src / 'cs_pocket_analysis.py')
    pa: ModuleType = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pa)
    texts = tuple((src / name).read_text(encoding='utf-8')
                  for name in ('CodeModelExt.py', 'CodeSearchExt.py', 'stateatlas/cs_core.py'))
    analyzers = pa.load_analyzers(*texts)
    # Der echte Aufloeser fuer dynamische Kandidaten (4.12: code mit name "" plus dynamic/reason); er braucht dafuer
    # kein TD-Objekt. Feste Ziele bleiben synthetisch (siehe case_real_analysis).
    spec = importlib.util.spec_from_file_location('cs_pocket_capture', src / 'cs_pocket_capture.py')
    pa.capture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pa.capture)
    return pe, mv, pa, analyzers, src


def ext_ref(owner: str, slot: int, text: str, target: str) -> dict:
    return {'from': {'op': owner, 'source': None, 'line': None, 'par': 'ext%dobject' % slot}, 'kind': 'ext-object',
            'text': text, 'target': {'op': target}, 'certainty': 'captured', 'code': None}


def extension(mv, comp: str, dat: str, cls: str, text: str) -> tuple:
    """COMP mit einer Extension, wie TD sie liest: object/name/promote als {value} (Exporter _known)."""
    obj = "op('./%s').module.%s(me)" % (dat.rsplit('/', 1)[-1], cls)
    extra = {'extensions': [{'slot': 0, 'object': {'value': obj}, 'name': {'value': cls},
                             'promote': {'value': True}}]}
    return extra, mv.text_source(dat, text), ext_ref(comp, 0, obj, dat)


REAL_CODE = '''class Alpha:
    def __init__(self, ownerComp):
        self.ownerComp = ownerComp
        self.value = 1

    def Go(self):
        self.Step()
        op('engine').Run()
        op.Global.Ping()
        parent().Notify()

    def Step(self):
        return op(self.name).Run()


class Beta:
    def __init__(self, ownerComp):
        self.value = 2

    def Step(self):
        return self.value


def free(a, b=3):
    return a
'''
ENGINE_CODE = 'class Engine:\n    def Run(self):\n        return 1\n'
GLOB_CODE = 'class Glob:\n    def Ping(self):\n        return 2\n'
ROOT_CODE = 'class Root:\n    def Notify(self):\n        return 3\n'


def case_extension(pe, mv, pa, analyzers) -> tuple:
    raw = mv.raw_capture(ROOT)
    extra, source, ref = extension(mv, '', 'Ext1', 'Ext1', 'class Ext1:\n    def __init__(self, ownerComp):\n'
                                   '        self.ownerComp = ownerComp\n')
    raw['operators'][0].update(extra, children=1)
    raw['operators'].append(mv.op(ROOT, 'Ext1', 'textDAT', 'DAT'))
    raw['codeSources'].append(source)
    return raw, {'entries': []}, [ref], 'COMP mit Extension: object/name/promote als {value} (promote bool)'


def case_markers(pe, mv, pa, analyzers) -> tuple:
    raw = mv.raw_capture(ROOT)
    root_op = raw['operators'][0]
    root_op.update(children=3, comment='token ' + CANARY,
                   shortcuts={'parent': {'value': CANARY}, 'global': {'unknown': 'mode-expression',
                                                                       'expr': "me.par.Name.eval()"}})
    raw['operators'].append(mv.op(ROOT, 'big', 'nullTOP', 'TOP', comment='x' * 70000))
    raw['operators'].append(mv.op(ROOT, 'plain', 'nullTOP', 'TOP', comment='sichtbar'))
    raw['operators'].append(mv.op(ROOT, 'inner', 'baseCOMP', 'COMP', True,
                                  extensions=[{'slot': 0, 'object': {'unknown': 'mode-expression',
                                                                     'expr': "op('./X').module.X(me)"},
                                               'name': {'value': ''}, 'promote': {'value': False}}]))
    raw['annotations'] = [{'rel': 'notiz', 'parent': '', 'name': 'notiz', 'mode': 'annotate', 'title': CANARY,
                           'body': 'y' * 70000, 'node': {'x': 0, 'y': 0, 'w': 400, 'h': 200}, 'color': None,
                           'enclosed': ['plain']}]
    return raw, {'entries': []}, [], ('Platzhalter: comment {omitted:"secret"}/{unknown:"size"}, Shortcut geheim/'
                                       'Expression, Ext-Objekt als Expression, Annotation title geheim, body zu lang')


def case_table_truncated(pe, mv, pa, analyzers) -> tuple:
    raw = mv.raw_capture(ROOT)
    raw['operators'][0]['children'] = 1
    raw['operators'].append(mv.op(ROOT, 'table1', 'tableDAT', 'DAT'))
    table = [['key', 'value'], ['lang', 'z' * 65600], ['kurz', 'ok']]
    raw['codeSources'].append({'op': 'table1', 'datType': 'tableDAT', 'language': 'table', 'languageFrom': 'role',
                               'roles': [], 'status': 'exact', 'text': None, 'table': table, 'file': None})
    return raw, {'entries': []}, [], 'Tabelle mit Zelle > 65 536 Zeichen: status truncated + truncation'


def case_expr_size(pe, mv, pa, analyzers) -> tuple:
    raw = mv.raw_capture(ROOT)
    raw['parameters'] = [
        mv.par('', 'Long', {'t': 'unknown', 'reason': 'mode-expression'}, mode='expression', custom=True,
               expr='1+' * 33000 + '1', default={'t': 'str', 'v': ''}),
        mv.par('', 'Huge', {'t': 'str', 'v': 'w' * 70000}, custom=True, default={'t': 'str', 'v': ''}),
    ]
    return raw, {'entries': []}, [], 'Expression und Wert > 65 536 Zeichen: expr null + omitted "size", value unknown/size'


def case_real_analysis(pe, mv, pa, analyzers) -> tuple:
    """Echte Analyse (cs_pocket_analysis) fuer zwei Klassen + Modulfunktion; Verweise aus deren Kandidaten."""
    raw = mv.raw_capture(ROOT)
    root_extra, root_source, root_ref = extension(mv, '', 'RootExt', 'Root', ROOT_CODE)
    raw['operators'][0].update(root_extra, children=4)
    engine_extra, engine_source, engine_ref = extension(mv, 'engine', 'engine/EngineExt', 'Engine', ENGINE_CODE)
    glob_extra, glob_source, glob_ref = extension(mv, 'glob', 'glob/GlobExt', 'Glob', GLOB_CODE)
    raw['operators'] += [
        mv.op(ROOT, 'RootExt', 'textDAT', 'DAT'),
        mv.op(ROOT, 'code', 'textDAT', 'DAT'),
        mv.op(ROOT, 'engine', 'baseCOMP', 'COMP', True, children=1, **engine_extra),
        mv.op(ROOT, 'engine/EngineExt', 'textDAT', 'DAT'),
        mv.op(ROOT, 'glob', 'baseCOMP', 'COMP', True, children=1, **glob_extra),
        mv.op(ROOT, 'glob/GlobExt', 'textDAT', 'DAT'),
    ]
    raw['codeSources'] += [root_source, mv.text_source('code', REAL_CODE), engine_source, glob_source]
    sources = [{'key': s['op'], 'op': s['op'], 'text': s['text'], 'language': 'python', 'status': 'exact'}
               for s in raw['codeSources']]
    result = pa.analyze(sources, [], analyzers)
    # Feste Ziele synthetisch (alle im Root), dynamische ueber den echten Aufloeser: der schlaegt sie nie nach und
    # setzt code {art, receiver, name:"", dynamic:true, reason} (Vertrag 4.12, code bei code-* Pflicht).
    targets = {"op('engine')": ({'op': 'engine'}, 'static'), 'op.Global': ({'op': 'glob'}, 'static'),
               'parent()': ({'op': ''}, 'static')}
    refs = [root_ref, engine_ref, glob_ref]
    dynamic = [cand for cand in result['refCandidates'] if cand.get('dynamic')]
    refs += resolved(pa.capture, raw, dynamic)
    for cand in result['refCandidates']:
        if cand.get('dynamic') or cand['text'] not in targets:
            continue
        target, certainty = targets[cand['text']]
        refs.append({'from': cand['from'], 'kind': cand['kind'], 'text': cand['text'], 'target': target,
                     'certainty': certainty, 'code': cand['code']})
    return raw, {'entries': result['entries']}, refs, ('Echte Analyse: self, op(), op.Global, parent(), '
                                                        'op(<Ausdruck>), zwei __init__, StateAtlas')


class _DetachedRoot:
    """Root ohne TD: dynamische Kandidaten loest resolve_candidates ohne Nachschlag auf."""

    def op(self, _rel):
        return None


def resolved(capture, raw: dict, candidates: list) -> list:
    generator = capture.resolve_candidates(raw, candidates, root=_DetachedRoot())
    while True:
        try:
            next(generator)
        except StopIteration as stop:
            return stop.value


CASES = {
    'extension': case_extension,
    'markers': case_markers,
    'table-truncated': case_table_truncated,
    'expr-size': case_expr_size,
    'real-analysis': case_real_analysis,
}


def build(td_codesearch: Path) -> tuple:
    pe, mv, pa, analyzers, src = load(td_codesearch)
    files = []
    for index, (name, make) in enumerate(CASES.items()):
        raw, analysis, refs, note = make(pe, mv, pa, analyzers)
        project_id = 'psp_%032x' % (0xa000 + index)
        built = pe.build_package(copy.deepcopy(raw), analysis, refs, mv.meta(project_id, 'Interop ' + name))
        data = built['bytes']
        check = pe.validate_bytes(data)
        if not check['ok']:
            raise SystemExit('Python lehnt %s ab: %s' % (name, check['errors'][:3]))
        if CANARY.encode('utf-8') in data:
            raise SystemExit('Kanarienwert im Paket %s' % name)
        entry_errors = [item for item in check.get('entryErrors', [])]
        files.append({'file': name + '.json', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                      'expect': {'valid': True, 'ignored': check.get('ignored', []), 'entryErrors': len(entry_errors)},
                      'note': note, 'data': data})
    exporter = (src / 'cs_pocket_export.py').read_bytes()
    lock = {'format': 'codesearch.pocket.vectors', 'version': 1,
            'owner': 'codesearch-pocket tools/fixtures/pocket/make_interop.py (echter Python-Exporter, synthetisch)',
            'exporterSha256': hashlib.sha256(exporter).hexdigest(),
            'files': [{key: value for key, value in item.items() if key != 'data'} for item in files]}
    return files, lock


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--td-codesearch', type=Path, default=DEFAULT_TD_CODESEARCH)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    files, lock = build(args.td_codesearch.resolve())
    lock_text = json.dumps(lock, indent=1, ensure_ascii=True) + '\n'
    if args.write:
        OUT.mkdir(exist_ok=True)
        for item in files:
            (OUT / item['file']).write_bytes(item['data'])
        (OUT / 'vectors.lock.json').write_bytes(lock_text.encode('utf-8'))
        print(json.dumps({'written': len(files), 'dir': str(OUT)}))
        return 0
    drift = [item['file'] for item in files
             if not (OUT / item['file']).is_file() or (OUT / item['file']).read_bytes() != item['data']]
    print(json.dumps({'checked': len(files), 'drift': drift}))
    return 1 if drift else 0


if __name__ == '__main__':
    raise SystemExit(main())
