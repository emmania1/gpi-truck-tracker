#!/usr/bin/env python3
"""
Stamp content-hash version tags onto the <link>/<script> asset URLs in index.html and backtest.html.

GitHub Pages serves every file with `cache-control: max-age=600`, so a browser can
hold an OLD app.js/style.css next to a NEW index.html (or vice versa) for ~10
minutes after a deploy and render a half-updated page. Changing the `?v=` tag
whenever the file content changes forces browsers to fetch the matching file.

Run after editing app.js or style.css, before committing:
    python3 scripts/stamp_assets.py
"""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = {
    "index.html": ("style.css", "app.js"),
    "backtest.html": ("style.css", "backtest.js"),
}


def pattern(name):
    ext = name.rsplit(".", 1)[1]
    attr = "href" if ext == "css" else "src"
    return rf'({attr}="{re.escape(name)})(\?v=[0-9a-f]+)?(")'


def main():
    for page, assets in PAGES.items():
        path = ROOT / page
        html = path.read_text()
        for name in assets:
            digest = hashlib.sha1((ROOT / name).read_bytes()).hexdigest()[:8]
            html, n = re.subn(pattern(name), rf"\g<1>?v={digest}\g<3>", html)
            if n != 1:
                raise SystemExit(f"expected exactly one reference to {name} in {page}, found {n}")
            print(f"{page}: {name} v={digest}")
        path.write_text(html)


if __name__ == "__main__":
    main()
