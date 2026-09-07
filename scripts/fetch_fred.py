#!/usr/bin/env python3
"""
Fetch LIVE-tier series for the GPI Truck Volume Tracker from FRED.

Uses the public fredgraph.csv endpoint, which requires NO API key for a
straight series pull (unlike the JSON /fred/series/observations endpoint).
Appends new observations to data/fred-series.json rather than overwriting
history, so the file accumulates a permanent record in git even though
FRED itself only serves the current vintage on each call.

Run manually:
    python3 scripts/fetch_fred.py

Run on a schedule via .github/workflows/update-fred.yml (monthly).
"""
import json
import urllib.request
import csv
import io
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = REPO_ROOT / "data" / "fred-series.json"

SERIES = {
    "DLTRUCKSSAAR": {
        "name": "Domestic Light Weight Truck Sales, SAAR",
        "unit": "Millions of Units",
    },
    "FLTRUCKSSAAR": {
        "name": "Foreign (Imported) Light Weight Truck Sales, SAAR",
        "unit": "Millions of Units",
    },
    "ALTSALES": {
        "name": "Total Light Vehicle Sales (Autos + Trucks), SAAR",
        "unit": "Millions of Units",
    },
    "TERMCBAUTO48NS": {
        "name": "Finance Rate, 48-Month New Auto Loans, Commercial Banks",
        "unit": "Percent",
    },
    "GASREGW": {
        "name": "US Regular All Formulations Gas Price",
        "unit": "$/Gallon",
    },
    "TXUR": {
        "name": "Texas Unemployment Rate",
        "unit": "Percent",
    },
}

FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"


def fetch_series_csv(series_id: str):
    url = FRED_CSV_URL.format(series_id=series_id)
    req = urllib.request.Request(url, headers={"User-Agent": "gpi-truck-tracker/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8")
    reader = csv.reader(io.StringIO(raw))
    rows = list(reader)
    header = rows[0]
    date_col = 0
    value_col = header.index(series_id) if series_id in header else 1
    points = []
    for row in rows[1:]:
        if not row or len(row) <= value_col:
            continue
        date_str = row[date_col].strip()
        val_str = row[value_col].strip()
        if not date_str or val_str in ("", "."):
            continue
        try:
            value = float(val_str)
        except ValueError:
            continue
        points.append({"date": date_str, "value": value})
    return points


def load_existing():
    if DATA_FILE.exists():
        with open(DATA_FILE) as f:
            return json.load(f)
    return {
        "meta": {
            "tier": "live",
            "source": "FRED (fredgraph.csv, no API key)",
            "last_updated": None,
        },
        "series": {},
    }


def main():
    store = load_existing()
    added_total = 0

    for series_id, info in SERIES.items():
        try:
            points = fetch_series_csv(series_id)
        except Exception as e:
            print(f"[warn] failed to fetch {series_id}: {e}")
            continue

        existing = store["series"].setdefault(
            series_id,
            {"name": info["name"], "unit": info["unit"], "data": []},
        )
        existing["name"] = info["name"]
        existing["unit"] = info["unit"]

        known_dates = {p["date"] for p in existing["data"]}
        new_points = [p for p in points if p["date"] not in known_dates]
        if new_points:
            existing["data"].extend(new_points)
            existing["data"].sort(key=lambda p: p["date"])
            added_total += len(new_points)
            print(f"{series_id}: added {len(new_points)} new observation(s)")
        else:
            print(f"{series_id}: no new observations")

    store["meta"]["last_updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DATA_FILE, "w") as f:
        json.dump(store, f, indent=2)
        f.write("\n")

    print(f"Done. {added_total} total new observation(s) written to {DATA_FILE}")


if __name__ == "__main__":
    main()
