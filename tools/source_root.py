"""Gemeinsame, per Hash geprüfte Eingaben für den reproduzierbaren Datenbuild."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = json.loads((ROOT / "upstream.json").read_text(encoding="utf-8"))
SOURCE = ROOT / "source" / LOCK["commit"]

for name, info in LOCK["files"].items():
    path = SOURCE / name
    if not path.is_file():
        raise SystemExit("Quellen fehlen. Zuerst python tools/upstream.py --repo <td-codesearch> --ref " + LOCK["commit"] + " --version " + LOCK["version"] + " --checked " + LOCK["checked"] + " --freeze ausführen.")
    if hashlib.sha256(path.read_bytes()).hexdigest() != info["sha256"]:
        raise SystemExit(f"Veränderte Build-Eingabe: {name}. Herkunft prüfen, nicht still neu bauen.")
