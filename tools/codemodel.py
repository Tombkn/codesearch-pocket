"""Die TD-freien Teile von CodeModelExt laden (wie td-codesearch/tests/run_tests.py) und auf DAT-Texte anwenden.

So stammen Methoden, Aufrufe, State-Schreiber und LANDKARTE-Fakten im Handy-Kurs aus der echten CodeSearch-Analyse.
"""
from __future__ import annotations

import ast
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "source" / "CodeModelExt.py"

MODULE_FUNCS = (
    '_snippet', '_top_level', '_analyze_source', '_scan_class', '_scan_scope', '_first_doc_line', '_is_property',
    '_has_effect', '_calls_text', '_scan_call', '_add_dynamic', '_scan_run', '_scan_attribute', '_scan_self_attribute',
    '_is_mutation', '_scan_dispatch', '_ast_snip', '_outer_if', '_branch_info', '_annotate_sites', '_track_alias_assign',
    '_track_alias_name', '_receiver', '_attribute_receiver', '_call_receiver', '_parent_receiver', '_alias_receiver',
    '_is_guessable', '_callback_body', '_parent_levels', '_new_site', '_run_string_calls', '_collect_module_state',
    '_decorator_text', '_scan_stored_item', '_op_of_receiver', '_track_receiver_alias', '_apply_receiver_aliases',
    '_chooser_of', '_arg_shape', '_call_arg_shapes', '_attr_chain', '_def_params', '_param_shape', '_name_dispatcher',
    '_return_chain', '_member_route_facts', '_string_lines', '_bound_shape', '_literal_sources',
)
METHODS = {'_landkarte_tree', '_landkarte_facts', '_par_label', '_return_label', '_side_effect_label'}


class FakeDat:
    def __init__(self, path: str, text: str):
        self.path = path
        self.text = text


def load():
    """Gibt (ns, M) zurueck: Modul-Namensraum und die Stub-Klasse mit den Landkarte-Methoden."""
    src = SRC.read_text(encoding='utf-8')
    tree = ast.parse(src)
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'CodeModelExt')
    methods = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in METHODS]
    # Alle Modul-Funktionen; Zuweisungen nur, wenn sie keine TD-Globals (me, op, parent, mod) beim Import brauchen
    td_names = {'me', 'op', 'parent', 'mod', 'ui', 'project', 'app'}

    def needs_td(node) -> bool:
        return any(isinstance(n, ast.Name) and n.id in td_names for n in ast.walk(node))

    top = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom, ast.FunctionDef))
           or (isinstance(n, (ast.Assign, ast.AnnAssign)) and not needs_td(n))]
    mod = ast.Module(body=top + [ast.ClassDef(name='M', bases=[], keywords=[], body=methods, decorator_list=[])],
                     type_ignores=[])
    ast.fix_missing_locations(mod)

    class _TdError(Exception):
        pass

    ns = {'debug': lambda *a, **k: None, 'DAT': object, 'COMP': object, 'OP': object, 'op': lambda p: None,
          'Optional': None, 'tdError': _TdError, 'td': None, 'run': None}
    exec(compile(mod, str(SRC), 'exec'), ns)
    M = ns['M']
    M._dat_text = staticmethod(lambda dat: dat.text)
    return ns, M


def facts(M, dat: FakeDat, class_id: str, name: str, line: int, kind: str = 'method') -> dict:
    m = M()
    m._lk_tree_cache = {}
    m._lk_texts = None
    return m._landkarte_facts(dat, {'line': line, 'kind': kind, 'class_id': class_id, 'name': name})
