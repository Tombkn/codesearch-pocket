"""Uebungsnetz aus der eingefrorenen TDN als lesbare Uebersicht ausgeben (nur Erkundung)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

SRC = Path(__file__).resolve().parents[1] / "source"
SKIP = {"Tour", "ExtUtils"}


def custom_names(cp) -> list[str]:
    names = []
    for page in (cp or {}).values():
        for item in page if isinstance(page, list) else []:
            names.append(item["name"] if isinstance(item, dict) else str(item))
    return names


def walk(ops, prefix, out, texts):
    for o in ops:
        name = o["name"]
        path = f"{prefix}/{name}" if prefix else name
        if name in SKIP:
            out.append(f"{path} [{o.get('type')}] (ausgelassen)")
            continue
        info = []
        for k, v in (o.get("parameters") or {}).items():
            info.append(f"{k}={str(v)[:70]}")
        if o.get("inputs"):
            info.append("IN:" + ",".join(map(str, o["inputs"])))
        for key in ("dock", "comp_inputs", "connections"):
            if o.get(key):
                info.append(f"{key}:{o[key]}")
        if o.get("custom_pars"):
            info.append("CP:" + ",".join(custom_names(o["custom_pars"])))
        if o.get("sequences"):
            info.append("SEQ:" + json.dumps(o["sequences"], ensure_ascii=False)[:160])
        dc = o.get("dat_content")
        if isinstance(dc, str):
            texts[path] = dc
            info.append(f"TEXT {len(dc.splitlines())}L")
        elif isinstance(dc, list):
            info.append("TABLE " + json.dumps(dc, ensure_ascii=False)[:160])
        if o.get("flags"):
            info.append("F:" + ",".join(o["flags"]))
        extra = sorted(set(o) - {"name", "type", "parameters", "inputs", "custom_pars", "sequences", "dat_content",
                                 "dat_content_format", "flags", "position", "size", "color", "children", "annotations"})
        if extra:
            info.append("KEYS:" + ",".join(extra))
        out.append(f"{path} [{o.get('type')}] " + " | ".join(info))
        walk(o.get("children") or [], path, out, texts)


def main() -> None:
    tdn = yaml.safe_load((SRC / "CodeSearch_Tutorial.tdn").read_text(encoding="utf-8"))
    out, texts = [], {}
    walk(tdn["operators"], "", out, texts)
    (SRC / "net_outline.txt").write_text("\n".join(out), encoding="utf-8")
    net = SRC / "net"
    net.mkdir(exist_ok=True)
    for path, text in texts.items():
        (net / (path.replace("/", "__") + ".txt")).write_text(text, encoding="utf-8")
    print(len(out), "ops", len(texts), "texte", file=sys.stderr)


if __name__ == "__main__":
    main()
