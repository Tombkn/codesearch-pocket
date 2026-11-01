"""Pinnt lesbare TD-Quellen oder prüft, ob Pocket noch zum gewählten Git-Stand passt.

Kein TD-Zugriff, kein automatisches Git-Fetch und kein Überschreiben der alten
Frozen-Quelle. Neue Eingaben landen in source/<voller Commit>/.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / "upstream.json"
FILES = {
    "upstream_docs/SPEC-KIT-HANDOFF.md": "docs/SPEC-KIT-HANDOFF.md",
    "upstream_docs/workplace-workflows.md": "docs/workplace-workflows.md",
    "cs_search_sessions.py": "src/cs_search_sessions.py",
    "cs_comp_operations.py": "src/cs_comp_operations.py",
    "upstream_docs/SPEC-WORKSPACE.md": "docs/SPEC-WORKSPACE.md",
    "upstream_docs/FNS-TOOLBAR.md": "docs/FNS-TOOLBAR.md",
    "upstream_docs/LLM-WORKSPACE.md": "docs/LLM-WORKSPACE.md",
    "signalgarden-scenarios.json": "src/signalgarden/scenarios.json",
    "upstream_docs/SIGNALGARDEN_WORKFLOWS.md": "docs/SIGNALGARDEN_WORKFLOWS.md",
    "CodeSearchExt.py": "src/CodeSearchExt.py",
    "CodeModelExt.py": "src/CodeModelExt.py",
    "CodeSearch.tdn": "src/tdn/CodeSearch.tdn",
    "CodeSearch_Tutorial.tdn": "src/tdn/CodeSearch_Tutorial.tdn",
    "TourExt.py": "src/tutorial/TourExt.py",
    "lessons.json": "src/tutorial/lessons.json",
    "marker_catalogue.json": "src/tutorial/marker_catalogue.json",
    "group_examples.json": "src/tutorial/group_examples.json",
}
for name in ("cs_core.py", "cs_spec.py", "cs_state.py", "cs_workbench.py", "tutorial_adapter.py", "tutorial_fixture.py", "tutorial_network.json"):
    FILES[name] = f"src/stateatlas/{name}"
for name in ("FEATURES_EINFACH.md", "FEATURE_01_STATE_ATLAS.md", "FEATURE_02_NACHFRAGE.md", "FEATURE_03_VERGLEICH.md", "FEATURE_04_AUSSAGEN.md", "FEATURE_05_VORSCHAU.md", "FEATURE_06_BILDFALL.md", "FEATURE_07_REPRO.md", "STATE_ATLAS.md", "PROTOCOL.md"):
    FILES[f"docs/{name}"] = f"docs/state-atlas/{name}"
for name in ("INTERFACE-1.9.1.md", "trigger-perspective.md", "comp-context.md", "data-shortcuts.md", "definition-navigation.md", "floating-copies.md", "flowlens-integration.md", "deep-dive/STAERKEN_UND_GRENZEN.md"):
    FILES[f"upstream_docs/{name}"] = f"docs/{name}"


def git(repo: Path, *args: str) -> bytes:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True).stdout


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True, help="Lokaler td-codesearch Clone")
    parser.add_argument("--ref", default="origin/main", help="Zuvor mit git fetch aktualisierte Referenz")
    parser.add_argument("--freeze", action="store_true", help="Neue Eingaben und upstream.json ausdrücklich schreiben")
    parser.add_argument("--version", help="Bei --freeze: bewusst geprüfte TD-Release-Version")
    parser.add_argument("--checked", help="Bei --freeze: Datum des Abgleichs YYYY-MM-DD")
    args = parser.parse_args()
    if args.freeze and (not args.version or not args.checked):
        parser.error("--freeze braucht --version und --checked; eine neue Quelle ist nicht automatisch fachlich geprüft.")
    commit = git(args.repo, "rev-parse", "--verify", f"{args.ref}^{{commit}}").decode().strip()
    contents = {target: git(args.repo, "show", f"{commit}:{source}") for target, source in FILES.items()}
    files = {target: {"path": FILES[target], "sha256": hashlib.sha256(data).hexdigest()} for target, data in contents.items()}
    lessons = json.loads(contents["lessons.json"])["lessons"]
    if args.freeze:
        destination = ROOT / "source" / commit
        for name, data in contents.items():
            path = destination / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        lock = {"repo": "Tombkn/td-codesearch", "commit": commit, "version": args.version, "checked": args.checked, "lesson_count": len(lessons), "files": files}
        LOCK.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"frozen": commit, "files": len(files), "lessons": len(lessons)}))
        return
    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    changed = [name for name, info in files.items() if lock["files"].get(name) != info]
    pocket = json.loads((ROOT / "data/course.json").read_text(encoding="utf-8"))
    by_id = {lesson["id"]: lesson for lesson in pocket["lessons"]}
    patches = {p["id"]: p["set"] for p in json.loads((ROOT / "tools/course_patches.json").read_text(encoding="utf-8"))["patches"]}
    missing = [lesson["id"] for lesson in lessons if lesson["id"] not in by_id]
    mismatches = []
    for original in lessons:
        expected = dict(original)
        for key, value in patches.get(original["id"], {}).items():
            expected[key] = {**expected[key], **value} if isinstance(value, dict) and isinstance(expected.get(key), dict) else value
        actual = {k: v for k, v in by_id.get(original["id"], {}).items() if k != "patched"}
        if actual != expected:
            mismatches.append(original["id"])
    fresh = commit == lock["commit"] and not changed and not missing and not mismatches
    print(json.dumps({"source_commit": commit, "pocket_commit": lock["commit"], "current": fresh, "source_lessons": len(lessons), "missing": missing, "changed_inputs": changed, "unexplained_lesson_differences": mismatches}, ensure_ascii=False))
    raise SystemExit(0 if fresh else 1)


if __name__ == "__main__":
    main()
