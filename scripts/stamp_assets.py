#!/usr/bin/env python3
"""
Stamp content-hash version tags onto the <link>/<script> asset URLs in index.html.

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
INDEX = ROOT / "index.html"
ASSETS = {"style.css": r'(href="style\.css)(\?v=[0-9a-f]+)?(")', "app.js": r'(src="app\.js)(\?v=[0-9a-f]+)?(")'}


def main():
    html = INDEX.read_text()
    for name, pattern in ASSETS.items():
        digest = hashlib.sha1((ROOT / name).read_bytes()).hexdigest()[:8]
        html, n = re.subn(pattern, rf"\g<1>?v={digest}\g<3>", html)
        if n != 1:
            raise SystemExit(f"expected exactly one reference to {name} in index.html, found {n}")
        print(f"{name}: v={digest}")
    INDEX.write_text(html)


if __name__ == "__main__":
    main()
