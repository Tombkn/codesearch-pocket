"""Feste Op-Verweise in Code und Expressions mit den echten CodeSearch-Funktionen finden.

Wie td-codesearch/tests/test_used_by_refs.py: nur die reinen Funktionen aus CodeSearchExt.py laufen.
Ob ein Verweis wirklich auf den markierten Op zeigt, entscheidet danach build_data (relativer Pfad -> Op).
"""
from __future__ import annotations

import ast
import json
from pathlib import Path
from typing import Optional

SRC = Path(__file__).resolve().parents[1] / "source" / "CodeSearchExt.py"
NAMES = {'OP_CALL_NAMES', 'SHORTCUT_HOLDERS', 'PARSE_ERRORS', 'BOM_CHAR', '_str_argument', '_parent_levels',
         '_op_refs_in_tree', '_op_refs_by_row', '_op_refs_in_expr', '_ref_name', '_node_text', '_ref_label',
         '_row_key', '_parse_ready', '_is_json_document'}


def load() -> dict:
    tree = ast.parse(SRC.read_text(encoding='utf-8'))
    pieces = []
    for node in tree.body:
        names = []
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            names = [node.name]
        elif isinstance(node, ast.Assign):
            names = [t.id for t in node.targets if isinstance(t, ast.Name)]
        if any(name in NAMES for name in names):
            pieces.append(node)
    module = ast.Module(body=pieces, type_ignores=[])
    ast.fix_missing_locations(module)
    scope = {'ast': ast, 'json': json, 'Optional': Optional, '__builtins__': __builtins__}
    exec(compile(module, str(SRC), 'exec'), scope)
    return scope


def code_refs(scope: dict, text: str) -> Optional[dict]:
    """{zeile: [(art, empfaenger-text, name)]} oder None, wenn der Text kein Python ist."""
    if scope['_is_json_document'](text):
        return {}
    parsed = scope['_op_refs_by_row'](scope['_parse_ready'](text))
    if parsed is None:
        return None
    _lines, rows = parsed
    out = {}
    for row, entries in sorted(rows.items()):
        out[int(row)] = [[art, scope['_ref_label'](art, receiver, name), name] for art, receiver, name in entries]
    return out


def expr_refs(scope: dict, text: str) -> list:
    return [[art, scope['_ref_label'](art, receiver, name), name]
            for art, receiver, name in scope['_op_refs_in_expr'](text)]
