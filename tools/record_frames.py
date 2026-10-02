"""Smooth video capture: drive the game frame by frame (fixed 1/30 s steps) and screenshot the canvas each frame.
Frame timing no longer depends on how fast the machine is.  usage: record_frames.py race|play|diag OUTDIR SECONDS"""
import sys, os
from pathlib import Path
from playwright.sync_api import sync_playwright
clip, out, secs = sys.argv[1], sys.argv[2], float(sys.argv[3]); FPS = int(sys.argv[4]) if len(sys.argv) > 4 else 30; os.makedirs(out, exist_ok=True)
URL = (Path(__file__).resolve().parents[1] / "build" / "flappy_worm.html").as_uri() + ("?diag=1" if clip == "diag" else "")
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=2)
    pg.goto(URL); pg.wait_for_timeout(800)
    if clip == "race":
        pg.evaluate("window.__manual = true; versusTest.start()"); adv = "__advanceVersus"
    else:
        pg.evaluate("flappyTest.train()")                     # warm-up in real time until the worm has learned (not recorded)
        while len(pg.evaluate("flappyTest.state()")["history"]) < 2: pg.wait_for_timeout(1000)
        pg.evaluate("window.__manual = true; window.__speedMult = 1.0"); adv = "__advance"   # same on-screen speed as the race (both run at S x)
    canvas = pg.locator("#game"); probe = "versusTest.drawnX()" if clip == "race" else "flappyTest.drawnX()"; xs = []
    for i in range(int(secs * FPS)):
        pg.evaluate(f"window.{adv}(1/{FPS})"); canvas.screenshot(path=f"{out}/f{i:05d}.png"); xs.append(pg.evaluate(probe))
        if i % 300 == 0: print(clip, i, flush=True)
    import json; json.dump(xs, open(f"{out}/drawn_x.json", "w")); b.close()
