#!/usr/bin/env python3
"""Assemble the single-file Flappy Worm page -> build/flappy_worm.html"""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
t = (ROOT / "web/flappy.html").read_text()
t = t.replace("/*WORMCORE*/", (ROOT / "core/js/wormcore.js").read_text()).replace("/*BRAIN*/", (ROOT / "data/brain_v2.json").read_text()).replace("/*APP*/", (ROOT / "web/flappy.js").read_text()).replace("/*VERSUS*/", (ROOT / "web/versus.js").read_text())
out = ROOT / "build/flappy_worm.html"; out.parent.mkdir(exist_ok=True); out.write_text(t); print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")
