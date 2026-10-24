"""Kurs, Uebungsnetz, Code-Analyse und Beschriftungen fuer CodeSearch Pocket erzeugen.

Quelle ist der eingefrorene Stand in source/ (siehe source/FROZEN.sha256):
  lessons.json            Mitmach-Tour (merged, 462 Schritte)
  CodeSearch_Tutorial.tdn das Uebungsnetz mit allen Ops, Parametern, Kabeln und DAT-Inhalten
  CodeModelExt.py         echte Code-Analyse von CodeSearch (TD-freie Teile)
  CodeSearchExt.py        echte Beschriftungen, Tooltips und Hilfetexte
Ergebnis in data/: course.json, net.json, code.json, ui.json, features.json.
"""
from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = ROOT / "source"
DATA = ROOT / "data"
sys.path.insert(0, str(HERE))

import codemodel  # noqa: E402
import refscan  # noqa: E402
import uitext  # noqa: E402

PREFIX = "/project1/CodeSearch_Tutorial"
# Diese Teilbaeume gehoeren zur Tour bzw. zum Helfer-Werkzeug, nicht zum Uebungsnetz: nur als Huelle zeigen
STUB_CHILDREN = {"Tour", "ExtUtils"}
# Reste eines fremden Werkzeugs (Kopfdaten mit Autor / privater Herkunfts-Datei): kein Teil des Kurses, nicht veroeffentlichen
EXCLUDE = {"testeeeExt", "ExtUtils1"}
FAMILIES = ("COMP", "TOP", "CHOP", "SOP", "DAT", "MAT", "POP")
CALLBACK_TYPES = {"chopexecuteDAT", "datexecuteDAT", "parameterexecuteDAT", "panelexecuteDAT", "opexecuteDAT",
                  "executeDAT"}


def family_of(op_type: str) -> str:
    for fam in FAMILIES:
        if op_type.endswith(fam):
            return fam
    return "COMP"


def par_entry(value):
    """TDN-Wert -> {'v': Konstante} | {'e': Expression} | {'b': Bind}."""
    if isinstance(value, dict) and value.get("mode") == "expression":
        return {"e": value.get("expr", "")}
    if isinstance(value, dict) and value.get("mode") == "bind":
        return {"b": value.get("expr", "")}
    if isinstance(value, str) and value.startswith("="):
        return {"e": value[1:]}
    if isinstance(value, str) and value.startswith("~"):
        return {"b": value[1:]}
    return {"v": value}


def custom_pars(raw) -> list[dict]:
    out = []
    for page, items in (raw or {}).items():
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            entry = {"page": page, **{k: v for k, v in item.items() if k in (
                "name", "style", "label", "default", "value", "menuNames", "menuLabels", "help", "min", "max",
                "normMin", "normMax", "readOnly", "startSection")}}
            out.append(entry)
    return out


def text_of(dat_content):
    if isinstance(dat_content, str):
        return dat_content
    return None


def resolve_input(parent: str, name: str) -> str:
    return f"{parent}/{name}" if parent else name


def walk(ops: list, parent: str, out: list) -> None:
    for o in ops:
        name = o["name"]
        if name in EXCLUDE:
            continue
        path = f"{parent}/{name}" if parent else name
        op_type = o.get("type", "")
        entry = {
            "path": path, "name": name, "type": op_type, "family": family_of(op_type), "parent": parent,
            "pos": o.get("position") or [0, 0], "size": o.get("size") or ([160, 130] if op_type.endswith("COMP")
                                                                          else [130, 90]),
        }
        pars = {k: par_entry(v) for k, v in (o.get("parameters") or {}).items()}
        if pars:
            entry["pars"] = pars
        if o.get("inputs"):
            entry["inputs"] = [resolve_input(parent, str(i)) for i in o["inputs"]]
        cps = custom_pars(o.get("custom_pars"))
        if cps:
            entry["custom"] = cps
        if o.get("flags"):
            entry["flags"] = o["flags"]
        if o.get("dock"):
            entry["dock"] = resolve_input(parent, str(o["dock"]))
        if o.get("tags"):
            entry["tags"] = sorted(o["tags"]) if isinstance(o["tags"], (list, set)) else [str(o["tags"])]
        if o.get("comment"):
            entry["comment"] = o["comment"]
        seq = o.get("sequences") or {}
        if seq.get("ext"):
            exts = [s for s in seq["ext"] if isinstance(s, dict) and s.get("name")]
            if exts:
                entry["ext"] = [{"name": s["name"], "object": s.get("object", ""), "promote": bool(s.get("promote"))}
                                for s in exts]
        if seq.get("const"):
            entry["chans"] = [{"name": c.get("name", f"chan{i}"), "value": c.get("value", 0)}
                              for i, c in enumerate(seq["const"]) if isinstance(c, dict)]
        dc = o.get("dat_content")
        if isinstance(dc, str):
            entry["text"] = dc
        elif isinstance(dc, list):
            entry["table"] = [[str(c) for c in row] for row in dc]
        if o.get("annotations"):
            entry["annotations"] = [{k: a.get(k) for k in ("name", "title", "text", "position", "size")}
                                    for a in o["annotations"]]
        if o.get("storage"):
            entry["storage"] = {k: v for k, v in o["storage"].items() if isinstance(v, (str, int, float, bool))}
        out.append(entry)
        if name in STUB_CHILDREN:
            entry["stub"] = True
            continue
        walk(o.get("children") or [], path, out)


def load_net() -> dict:
    tdn = yaml.safe_load((SRC / "CodeSearch_Tutorial.tdn").read_text(encoding="utf-8"))
    ops: list = []
    walk(tdn["operators"], "", ops)
    root = {
        "path": "", "name": "CodeSearch_Tutorial", "type": tdn.get("type", "baseCOMP"), "family": "COMP",
        "parent": None, "pos": [0, 0], "size": [160, 130],
        "annotations": [{k: a.get(k) for k in ("name", "title", "text", "position", "size")}
                        for a in tdn.get("annotations") or []],
    }
    return {"prefix": PREFIX, "root": root, "ops": ops}


def is_python(entry: dict) -> bool:
    """Python-DAT nach denselben Kriterien wie CodeSearch: Sprache, Callback-Typ oder Extension-Quelle."""
    if "text" not in entry:
        return False
    lang = (entry.get("pars", {}).get("language", {}) or {}).get("v")
    if lang and lang != "python":
        return False
    if entry["type"] in CALLBACK_TYPES:
        return True
    if lang == "python":
        return True
    text = entry["text"]
    try:
        ast.parse(text)
    except SyntaxError:
        return False
    return bool(re.search(r"^\s*(def|class|import|from)\s", text, re.M))


def site_target(site: dict) -> dict:
    """Empfaenger eines Aufrufs in eine lesbare, maschinell nutzbare Form bringen."""
    recv = site.get("recv") or []
    out = {"line": site["line"], "attr": site.get("attr", ""), "type": site["type"], "func": site["func"],
           "cls": site.get("cls", "")}
    if not recv:
        return out
    kind = recv[0]
    out["via"] = kind
    if kind == "opof" and len(recv) > 2:
        out["op"] = recv[2]
    elif kind == "op" and len(recv) > 1:
        out["op"] = recv[1]
    elif kind == "parentshortcut" and len(recv) > 1:
        out["shortcut"] = recv[1]
    elif kind == "ext" and len(recv) > 2:
        inner = recv[1]
        if isinstance(inner, (list, tuple)) and len(inner) > 1:
            out["shortcut"] = inner[1]
        out["extclass"] = recv[2]
    elif kind == "name" and len(recv) > 1:
        out["name"] = recv[1]
    if site.get("text"):
        out["text"] = site["text"]
    if site.get("dynamic"):
        out["dynamic"] = True
    for key in ("branch_group", "branch_kind", "branch_test"):
        if site.get(key):
            out[key] = site[key]
    return out


def ast_extras(text: str) -> dict:
    """Guards (if … return), Argument-Quelltexte und lokale Zuweisungen je Funktion - fuer WARUM, ROUTE und LANDKARTE."""
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return {}
    out = {}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        guards, calls, locals_ = [], [], []
        for inner in ast.walk(node):
            if isinstance(inner, ast.If):
                returns = any(isinstance(n, ast.Return) for n in inner.body)
                guards.append({"line": inner.lineno, "test": ast.get_source_segment(text, inner.test) or "",
                               "returns": returns, "orelse": bool(inner.orelse)})
            elif isinstance(inner, ast.Call) and isinstance(inner.func, ast.Attribute):
                calls.append({"line": inner.lineno, "attr": inner.func.attr,
                              "args": [ast.get_source_segment(text, a) or "" for a in inner.args],
                              "kw": {k.arg: ast.get_source_segment(text, k.value) or "" for k in inner.keywords if k.arg}})
            elif isinstance(inner, ast.Assign) and len(inner.targets) == 1 and isinstance(inner.targets[0], ast.Name):
                locals_.append({"line": inner.lineno, "name": inner.targets[0].id,
                                "value": ast.get_source_segment(text, inner.value) or ""})
        out[node.name] = {"guards": sorted(guards, key=lambda g: g["line"]),
                          "calls": sorted(calls, key=lambda c: c["line"]),
                          "locals": sorted(locals_, key=lambda x: x["line"])}
    return out


def load_code(net: dict) -> dict:
    ns, M = codemodel.load()
    result = {}
    for entry in net["ops"]:
        if not is_python(entry):
            continue
        text = entry["text"]
        try:
            raw = ns["_analyze_source"](text)
        except Exception as error:  # noqa: BLE001 - ein DAT, den die Analyse nicht versteht, bleibt ohne Modell
            print(f"WARN Analyse {entry['path']}: {error}", file=sys.stderr)
            raw = None
        if raw is None:
            result[entry["path"]] = {"error": "parse"}
            continue
        dat = codemodel.FakeDat(f"{PREFIX}/{entry['path']}", text)
        classes = []
        for cls in raw.get("classes", []):
            class_id = f"{dat.path}:{cls['name']}"
            members = []
            for mem in cls.get("members", []):
                kind = "property" if mem.get("is_property") else "method"
                try:
                    facts = codemodel.facts(M, dat, class_id, mem["name"], mem["line"], kind)
                except Exception as error:  # noqa: BLE001
                    print(f"WARN Fakten {entry['path']}.{mem['name']}: {error}", file=sys.stderr)
                    facts = {}
                params = mem.get("params") or {}
                members.append({
                    "name": mem["name"], "line": mem["line"], "end": mem.get("end", mem["line"]),
                    "doc": mem.get("doc", ""), "property": bool(mem.get("is_property")),
                    "decorators": mem.get("decorators", []),
                    "params": [p for p in params.get("pos", []) if p not in ("self", "cls")],
                    "facts": {k: v for k, v in (facts or {}).items() if k != "located"},
                })
            classes.append({"name": cls["name"], "line": cls["line"], "members": members,
                            "states": cls.get("states", {})})
        functions = []
        for fn in raw.get("functions", []):
            functions.append({"name": fn["name"], "line": fn["line"], "end": fn.get("end", fn["line"]),
                              "doc": fn.get("doc", "")})
        sites = [site_target(s) for s in raw.get("sites", [])
                 if s["type"] in ("call", "run", "dispatch") or s.get("dynamic")]
        accesses = [{"cls": a[0], "func": a[1], "name": a[2], "how": a[3], "line": a[4], "conf": a[5]}
                    for a in raw.get("accesses", [])]
        result[entry["path"]] = {"classes": classes, "functions": functions, "sites": sites, "accesses": accesses,
                                 "ast": ast_extras(text)}
    return result


# Parameter, deren Wert ein Op-Pfad ist (PAR-REF). Labels nur dort, wo CodeSearchExt sie selbst nennt
# (EXEC_WATCH_PAR-Kommentar, live 11.10.); sonst zeigt die Zeile den Python-Namen wie _par_ref_label ohne Label.
OP_PARS = ("top", "chop", "chops", "dat", "sop", "op", "callbacks", "material", "camera", "lights", "geometry",
           "panels", "opviewer")
WATCH_PARS = {"chopexecuteDAT": "chop", "datexecuteDAT": "dat", "parameterexecuteDAT": "op", "opexecuteDAT": "op",
              "panelexecuteDAT": "panels"}
PAR_LABELS = {("chopexecuteDAT", "chop"): "CHOPs", ("datexecuteDAT", "dat"): "DATs",
              ("parameterexecuteDAT", "op"): "OPs", ("opexecuteDAT", "op"): "Monitor OPs",
              ("panelexecuteDAT", "panels"): "Panels"}


class Resolver:
    """Op-Namen relativ zu einem COMP aufloesen, wie op() in TD (nur fuer das eingefrorene Uebungsnetz)."""

    def __init__(self, net: dict):
        self.by_path = {o["path"]: o for o in net["ops"]}
        self.by_path[""] = net["root"]
        self.shortcuts = {}
        for o in net["ops"]:
            short = (o.get("pars", {}).get("parentshortcut") or {}).get("v")
            if short:
                self.shortcuts.setdefault(short, []).append(o["path"])

    def exists(self, path):
        return path in self.by_path

    def relative(self, comp: str, name: str):
        name = str(name).strip()
        if not name:
            return None
        if name.startswith(PREFIX + "/"):
            target = name[len(PREFIX) + 1:]
            return target if self.exists(target) else None
        if name.startswith("/"):
            return None
        parts = [p for p in name.split("/") if p not in ("", ".")]
        base = comp.split("/") if comp else []
        for part in parts:
            if part == "..":
                if not base:
                    return None
                base = base[:-1]
            else:
                base = base + [part]
        target = "/".join(base)
        return target if self.exists(target) else None

    def parent_shortcut(self, start_comp: str, short: str):
        """parent.X: vom COMP aus nach oben bis zum ersten COMP mit diesem Parent Shortcut (sich selbst eingeschlossen)."""
        path = start_comp
        while True:
            entry = self.by_path.get(path)
            if entry is not None and (entry.get("pars", {}).get("parentshortcut") or {}).get("v") == short:
                return path
            if not path:
                return None
            path = path.rsplit("/", 1)[0] if "/" in path else ""

    def parent_levels(self, comp: str, levels: int):
        path = comp
        for _ in range(max(0, levels - 1)):
            if not path:
                return None
            path = path.rsplit("/", 1)[0] if "/" in path else ""
        return path


def resolve_ref(res: Resolver, art: str, receiver: str, name: str, home: str, owner: str):
    """Ein (art, empfaenger, name) aus refscan auf einen Op-Pfad abbilden.

    home = COMP, in dem der Ausdruck/Code steht (op('x') sucht dort); owner = COMP der Extension (self.ownerComp).
    """
    if art == "call":
        base = owner if "ownerComp" in receiver else home
        if "parent()" in receiver and ".op(" in receiver:
            base = res.parent_levels(home, 1) or ""
        return res.relative(base, name)
    if art == "short" and receiver.startswith("parent."):
        return res.parent_shortcut(home, name)
    if art == "parent":
        try:
            return res.parent_levels(home, int(name))
        except ValueError:
            return None
    return None


def build_edges(net: dict, code_refs: dict) -> list[dict]:
    """Alle festen Verbindungen des Uebungsnetzes als Kanten {kind, src, dst, par, line, text, receiver}."""
    res = Resolver(net)
    scope = refscan.load()
    edges = []
    for o in net["ops"]:
        path, parent = o["path"], o["parent"] or ""
        for index, src in enumerate(o.get("inputs", [])):
            if res.exists(src):
                edges.append({"kind": "wire", "src": src, "dst": path, "index": index})
        for par, val in (o.get("pars") or {}).items():
            if "e" in val:
                refs = refscan.expr_refs(scope, val["e"])
                targets = []
                for art, receiver, name in refs:
                    target = resolve_ref(res, art, receiver, name, parent, parent)
                    if target is not None and target not in targets:
                        targets.append(target)
                for target in targets or [None]:
                    edges.append({"kind": "expr", "src": target, "dst": path, "par": par, "text": val["e"]})
            elif "b" in val:
                refs = refscan.expr_refs(scope, val["b"])
                target = None
                for art, receiver, name in refs:
                    target = resolve_ref(res, art, receiver, name, parent, parent)
                    if target is not None:
                        break
                edges.append({"kind": "bind", "src": target, "dst": path, "par": par, "text": val["b"]})
            elif par in OP_PARS and isinstance(val.get("v"), str) and val["v"]:
                target = res.relative(parent, val["v"])
                if target is None:
                    continue
                kind = "watch" if WATCH_PARS.get(o["type"]) == par else (
                    "callbacks" if par == "callbacks" else "oppar")
                edges.append({"kind": kind, "src": target, "dst": path, "par": par, "text": val["v"],
                              "label": PAR_LABELS.get((o["type"], par), "")})
        # CHOP-Export (Select CHOP mit autoname): Kanalname 'op:par' schreibt in diesen Parameter
        pars = o.get("pars") or {}
        if (pars.get("exportmethod") or {}).get("v") == "autoname":
            names = str((pars.get("renameto") or {}).get("v") or (pars.get("channames") or {}).get("v") or "")
            root_expr = (pars.get("autoexportroot") or {}).get("e", "")
            root = res.parent_levels(parent, 1) if "parent()" in root_expr else parent
            for chan in names.split():
                if ":" in chan:
                    op_name, par_name = chan.split(":", 1)
                    target = res.relative(root or "", op_name)
                    if target is not None:
                        edges.append({"kind": "export", "src": path, "dst": target, "par": par_name,
                                      "channel": chan, "chop_source": (pars.get("chops") or {}).get("v", "")})
    for dat_path, rows in code_refs.items():
        dat = res.by_path[dat_path]
        home = dat["parent"] or ""
        for row, entries in rows.items():
            for art, receiver, name in entries:
                target = resolve_ref(res, art, receiver, name, home, home)
                edges.append({"kind": "code", "src": dat_path, "dst": target, "line": int(row),
                              "receiver": receiver, "name": name, "art": art})
    return edges


def load_course() -> dict:
    src = json.loads((SRC / "lessons.json").read_text(encoding="utf-8"))
    extra_path = HERE / "abschluss.json"
    chapters = list(src["chapters"])
    lessons = list(src["lessons"])
    if extra_path.exists():
        extra = json.loads(extra_path.read_text(encoding="utf-8"))
        offset = len(chapters)
        chapters.extend(extra["chapters"])
        known = {lesson["id"] for lesson in lessons}
        for lesson in extra["lessons"]:
            if lesson["id"] in known:
                raise ValueError(f"Abschluss-ID doppelt: {lesson['id']}")
            item = dict(lesson)
            item["chapter"] = lesson["chapter"] + offset
            lessons.append(item)
    patches = json.loads((HERE / "course_patches.json").read_text(encoding="utf-8"))["patches"]
    by_id = {lesson["id"]: lesson for lesson in lessons}
    for patch in patches:
        target = by_id[patch["id"]]
        for key, value in patch["set"].items():
            if isinstance(value, dict) and isinstance(target.get(key), dict):
                target[key] = {**target[key], **value}
            else:
                target[key] = value
        target.setdefault("patched", []).append(patch["why"])
    return {"version": src.get("version", 2), "updated": "2026-10-23",
            "source": "codesearch_lab/merged/artifacts/lessons.json (eingefroren, siehe source/FROZEN.sha256)",
            "chapters": chapters, "lessons": lessons}


DOCS = [
    ("map", "Die sieben Werkzeuge", "docs/FEATURES_EINFACH.md", 26),
    ("atlas", "1. State Atlas", "docs/FEATURE_01_STATE_ATLAS.md", 26),
    ("ask", "2. Kontext nachliefern", "docs/FEATURE_02_NACHFRAGE.md", 27),
    ("compare", "3. Zwei Fälle vergleichen", "docs/FEATURE_03_VERGLEICH.md", 28),
    ("claims", "4. Aussagen prüfen", "docs/FEATURE_04_AUSSAGEN.md", 29),
    ("preview", "5. Änderungen vorschauen", "docs/FEATURE_05_VORSCHAU.md", 30),
    ("visual", "6. Bildfall aufnehmen", "docs/FEATURE_06_BILDFALL.md", 31),
    ("repro", "7. Repro-Testkopie", "docs/FEATURE_07_REPRO.md", 32),
    ("questions", "Fünf Fragen an einen State", "docs/STATE_ATLAS.md", 26),
    ("triggers", "TRIGGERS: Bereich und Richtung", "upstream_docs/trigger-perspective.md", 33),
    ("compctx", "AUSWAHL und DIESE COMP", "upstream_docs/comp-context.md", 33),
    ("data", "DATEN: F6 und Alt+D", "upstream_docs/data-shortcuts.md", 34),
    ("definition", "Definitionen springen", "upstream_docs/definition-navigation.md", 34),
    ("floats", "Lesekopien", "upstream_docs/floating-copies.md", 34),
    ("flowlens", "FlowLens-Anbindung", "upstream_docs/flowlens-integration.md", 25),
    ("limits", "Stärken und Grenzen", "upstream_docs/deep-dive/STAERKEN_UND_GRENZEN.md", None),
]


def load_features() -> list[dict]:
    out = []
    for key, title, rel, chapter in DOCS:
        path = SRC / rel
        if not path.exists():
            print(f"WARN Doku fehlt: {rel}", file=sys.stderr)
            continue
        text = re.sub(r"\n{3,}", "\n\n", path.read_text(encoding="utf-8")).strip()
        out.append({"id": key, "title": title, "chapter": chapter, "body": text})
    return out


def write(name: str, data) -> int:
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    (DATA / name).write_text(raw, encoding="utf-8")
    return len(raw)


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    course = load_course()
    net = load_net()
    code = load_code(net)
    scope = refscan.load()
    code_refs = {}
    for entry in net["ops"]:
        if entry["path"] in code and "text" in entry:
            rows = refscan.code_refs(scope, entry["text"])
            if rows:
                code_refs[entry["path"]] = rows
    net["edges"] = build_edges(net, code_refs)
    ui = uitext.extract()
    ui["marker_catalogue"] = json.loads((SRC / "marker_catalogue.json").read_text(encoding="utf-8"))
    cs_tdn = yaml.safe_load((SRC / "CodeSearch.tdn").read_text(encoding="utf-8"))
    ui["CS_PARS"] = [p for p in custom_pars(cs_tdn.get("custom_pars")) if p.get("style") != "Header"]
    features = load_features()
    sizes = {name: write(name, data) for name, data in (
        ("course.json", course), ("net.json", net), ("code.json", code), ("ui.json", ui),
        ("features.json", features))}
    stale = DATA / "hits.json"
    if stale.exists():
        stale.unlink()
    print(json.dumps({"lessons": len(course["lessons"]), "chapters": len(course["chapters"]),
                      "ops": len(net["ops"]), "python_dats": len(code), "features": len(features),
                      "bytes": sizes}, ensure_ascii=False))


if __name__ == "__main__":
    main()
