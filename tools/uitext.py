"""Beschriftungen, Tooltips und Hilfetexte aus dem echten CodeSearchExt.py holen.

Nur Modul-Konstanten (Zuweisungen auf oberster Ebene) werden ausgefuehrt, jede einzeln: braucht eine TD,
faellt sie still weg. So stehen am Handy dieselben Woerter wie im Original-Fenster.
"""
from __future__ import annotations

import ast
import json
import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "source" / "CodeSearchExt.py"

WANTED = (
    'TAB_LABELS', 'GROUP_ORDER', 'GROUP_LABELS', 'GROUP_TITLES', 'GROUP_OF_MODE', 'GROUP_HELP', 'WINDOW_HELP',
    'GUIDE_HELP', 'HELP_FOOTER', 'MODE_SEES', 'MODE_NEEDS', 'MODE_KEYS', 'MODE_HINTS', 'MODE_HELP', 'HEADER_HELP',
    'KIND_LABELS', 'KIND_HELP', 'DETAIL_HELP', 'SECTION_HELP', 'CONF_HELP', 'HITKIND_HELP', 'CAT_ORDER', 'CAT_LABEL',
    'CAT_TITLE', 'CAT_SECTION_HELP', 'CAT_CHIP', 'CAT_HELP', 'MAP_METHOD_ORDER', 'MAP_SECTION_REST', 'FILTERS',
    'FILTER_LABELS', 'FILTER_HEADS', 'OP_FAMILIES', 'OP_FAMILY_LABELS', 'OP_ADDRESSES', 'OP_ADDRESS_LABELS',
    'OP_ADDRESS_HELP', 'COMMANDS', 'ENTRY_HELP', 'ERRORS_HELP', 'TABLE_HELP', 'WHY_KIND_HELP', 'ROUTE_ORIGIN_HELP',
    'OVERVIEW_CHIP_HELP', 'QUICK_HEADERS', 'QUICK_PLACEHOLDER', 'TABLE_COL_HELP', 'IMPACT_VIA_TEXT', 'PAR_REF_HELP',
    'ACTION_HELP_TAB', 'ACTION_HELP_ANY', 'REF_GROUP_LOCAL', 'REF_GROUP_OUTSIDE', 'REF_GROUP_INNER', 'MODES',
    'TAB_CODE_MODES', 'TAB_OP_MODES', 'TAB_ALWAYS_ON', 'WATCH_OFF_NOTE', 'TOGGLE_OFF_NOTE', 'VIEW_ONLY_NOTE',
)


def _plain(value):
    """In JSON-taugliche Form bringen (Tupel -> Listen, Sets -> sortierte Listen, Zahlen-Tupel bleiben)."""
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, (set, frozenset)):
        return sorted(_plain(v) for v in value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def extract() -> dict:
    tree = ast.parse(SRC.read_text(encoding='utf-8'))
    ns: dict = {'re': re, '__builtins__': __builtins__}
    exec('import re, math, json, os, sys\nfrom typing import Optional', ns)
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.Assign, ast.AnnAssign, ast.AugAssign, ast.FunctionDef)):
            mod = ast.Module(body=[node], type_ignores=[])
            try:
                exec(compile(mod, str(SRC), 'exec'), ns)
            except Exception:  # noqa: BLE001 - eine Konstante, die TD braucht, fehlt dann einfach
                continue
    return {name: _plain(ns[name]) for name in WANTED if name in ns}


if __name__ == '__main__':
    data = extract()
    missing = [n for n in WANTED if n not in data]
    print(json.dumps({'found': len(data), 'missing': missing}, ensure_ascii=False))
