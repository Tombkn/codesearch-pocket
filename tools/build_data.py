"""Kurs, Features und Suchindex fuer CodeSearch Pocket erzeugen."""
from __future__ import annotations

import json
import re
from pathlib import Path

LAB = Path(
    r"c:\VisualStuff\Touchdesigner All\AllFiles\Cursor Base"
    r"\Claude_Extensions_komplett_Course\a1-brief\a1-brief\codesearch_lab"
)
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
KEEP = {
    "id", "chapter", "title", "why", "action", "expected", "meaning", "limit",
    "next_step", "glossary", "rules", "mode", "start", "target", "query",
    "symbol", "prep", "highlight", "hint", "purpose_profile", "keep",
    "observed", "marker", "scope", "features", "view", "prompt",
}


def slim_lesson(raw: dict) -> dict:
    item = {key: raw[key] for key in KEEP if key in raw and raw[key] not in ("", [], {})}
    if "rules" not in item:
        item["rules"] = raw.get("rules") or []
    if "prep" not in item:
        item["prep"] = raw.get("prep") or {}
    item.setdefault("mode", raw.get("mode") or "search")
    item.setdefault("target", raw.get("target") or "BranchLab")
    item.setdefault("query", raw.get("query") or "")
    return item


def load_course() -> dict:
    src = json.loads((LAB / "merged" / "artifacts" / "lessons.json").read_text(encoding="utf-8"))
    lessons = [slim_lesson(item) for item in src["lessons"]]
    return {
        "version": src.get("version", 2),
        "updated": "2026-10-23",
        "source": "codesearch_lab/merged/artifacts/lessons.json",
        "chapters": src["chapters"],
        "lessons": lessons,
    }


def read_md(name: str) -> str:
    return (LAB / "docs" / name).read_text(encoding="utf-8")


def load_features() -> list[dict]:
    files = [
        ("map", "Die sieben Werkzeuge", "FEATURES_EINFACH.md", None),
        ("atlas", "1. State Atlas", "FEATURE_01_STATE_ATLAS.md", 25),
        ("ask", "2. Kontext nachliefern", "FEATURE_02_NACHFRAGE.md", 26),
        ("compare", "3. Zwei Fälle vergleichen", "FEATURE_03_VERGLEICH.md", 27),
        ("claims", "4. Aussagen prüfen", "FEATURE_04_AUSSAGEN.md", 28),
        ("preview", "5. Änderungen vorschauen", "FEATURE_05_VORSCHAU.md", 29),
        ("visual", "6. Bildfall aufnehmen", "FEATURE_06_BILDFALL.md", 30),
        ("repro", "7. Repro-Testkopie", "FEATURE_07_REPRO.md", 31),
        ("questions", "Fünf Fragen an einen State", "STATE_ATLAS.md", 25),
    ]
    out = []
    for key, title, filename, chapter in files:
        text = read_md(filename)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        out.append({"id": key, "title": title, "chapter": chapter, "body": text})
    return out


def load_hits(course: dict) -> list[dict]:
    hits = [
        {"id": "op-branchlab", "kind": "OP", "art": "OP", "path": "BranchLab", "name": "BranchLab", "text": "containerCOMP  Uebungsnetz", "group": "OPERATOREN", "tab": "search"},
        {"id": "op-control", "kind": "OP", "art": "OP", "path": "BranchLab/control", "name": "control", "text": "Steuerung  Fire  RouteEvent", "group": "OPERATOREN", "tab": "search"},
        {"id": "op-statelab", "kind": "OP", "art": "OP", "path": "StateLab", "name": "StateLab", "text": "Uebungsbereich fuer Atlas und Faelle", "group": "OPERATOREN", "tab": "search"},
        {"id": "op-farb", "kind": "OP", "art": "OP", "path": "Farbmischer", "name": "Farbmischer", "text": "FarbmischerExt  Gain  Intensity", "group": "OPERATOREN", "tab": "search"},
        {"id": "op-palette", "kind": "OP", "art": "OP", "path": "BranchLab/ColorEngine/palette", "name": "palette", "text": "TABLE  warm  cool  neutral", "group": "TABLE", "tab": "table"},
        {"id": "code-gain", "kind": "CODE", "art": "CODE", "path": "BranchLab/ColorEngine/ColorEngineExt", "name": "gain", "text": "def ApplyPreset(self, gain):", "group": "CODE", "tab": "search", "query": "gain"},
        {"id": "code-aurora", "kind": "CODE", "art": "CODE", "path": "Farbmischer/FarbmischerExt", "name": "aurora", "text": "preset = 'aurora'", "group": "CODE", "tab": "search", "query": "aurora"},
        {"id": "code-demo", "kind": "CODE", "art": "CODE", "path": "BranchLab/demo_tick", "name": "demo_tick", "text": "def demo_tick(self):", "group": "CODE", "tab": "search", "query": "demo_*"},
        {"id": "code-lab", "kind": "CODE", "art": "CODE", "path": "StateLab/StateLabExt", "name": "lab", "text": "class StateLabExt:", "group": "CODE", "tab": "search", "query": "lab"},
        {"id": "code-level", "kind": "EXPR", "art": "EXPR", "path": "BranchLab/level_expr", "name": "level", "text": "op('control').par.Level", "group": "PARAMETER", "tab": "search", "query": "level"},
        {"id": "code-tick", "kind": "CHAN", "art": "CHAN", "path": "BranchLab/null_takt", "name": "tick", "text": "chan tick  1 Hz", "group": "KANAL", "tab": "search", "query": "tick"},
        {"id": "code-warm", "kind": "TABLE", "art": "TABLE", "path": "BranchLab/ColorEngine/palette", "name": "warm", "text": "warm  r=0.92", "group": "TABLE", "tab": "table", "query": "warm"},
        {"id": "code-intensity", "kind": "PAR", "art": "PAR", "path": "Farbmischer", "name": "Intensity", "text": "par.Intensity  0.6", "group": "PARAMETER", "tab": "search", "query": "Intensity"},
        {"id": "meth-route", "kind": "METHOD", "art": "METH", "path": "BranchLab/BranchLabExt", "name": "RouteEvent", "text": "BranchLabExt.RouteEvent", "group": "STRUCTURE", "tab": "map"},
        {"id": "meth-apply", "kind": "METHOD", "art": "METH", "path": "BranchLab/ColorEngine/ColorEngineExt", "name": "ApplyPreset", "text": "ColorEngineExt.ApplyPreset", "group": "STRUCTURE", "tab": "map"},
        {"id": "flow-bind", "kind": "BIND", "art": "BIND", "path": "BranchLab/SoftBranch/blur_soft", "name": "Softness", "text": "BIND  Softness <- control.Softness", "group": "FLOW", "tab": "chain"},
        {"id": "flow-export", "kind": "EXPORT", "art": "EXPORT", "path": "BranchLab/level_export", "name": "Level", "text": "EXPORT  null_takt[tick] -> Level", "group": "FLOW", "tab": "chain"},
        {"id": "flow-expr", "kind": "EXPR", "art": "EXPR", "path": "BranchLab/level_expr", "name": "Level", "text": "EXPR  0.5 + 0.25", "group": "FLOW", "tab": "chain"},
        {"id": "uses-control", "kind": "USES", "art": "USES", "path": "BranchLab/control", "name": "control", "text": "Fire ruft RouteEvent", "group": "USES", "tab": "trace"},
        {"id": "err-clean", "kind": "OK", "art": "OK", "path": "BranchLab", "name": "clean", "text": "0 Errors  0 Warnings", "group": "ERRORS", "tab": "errors"},
    ]
    seen = {item["id"] for item in hits}
    for lesson in course["lessons"]:
        marker = lesson.get("marker") or {}
        label = marker.get("label")
        if not label:
            continue
        ident = "mk-" + (marker.get("id") or lesson["id"])
        if ident in seen:
            continue
        match = marker.get("match") or {}
        art = match.get("hitkind") or match.get("kind") or label
        hits.append({
            "id": ident,
            "kind": str(art).upper(),
            "art": str(label),
            "path": marker.get("target") or lesson.get("target") or "BranchLab",
            "name": label,
            "text": (marker.get("meaning") or lesson.get("title") or label).split("\n", 1)[0],
            "group": "MARKER",
            "tab": lesson.get("mode") or "search",
            "query": marker.get("query") or lesson.get("query") or "",
            "markerId": marker.get("id"),
        })
        seen.add(ident)
    return hits


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    course = load_course()
    features = load_features()
    hits = load_hits(course)
    (DATA / "course.json").write_text(
        json.dumps(course, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (DATA / "features.json").write_text(
        json.dumps(features, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (DATA / "hits.json").write_text(
        json.dumps(hits, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"lessons={len(course['lessons'])} chapters={len(course['chapters'])} "
        f"features={len(features)} hits={len(hits)}"
    )


if __name__ == "__main__":
    main()
