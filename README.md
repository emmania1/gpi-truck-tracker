# GPI Truck Volume Exposure Tracker

Static dashboard tracking truck-market demand exposure relevant to Group 1 Automotive (NYSE: GPI), modeled on the [vol-regime-tracker](https://slogatskiy.github.io/vol-regime-tracker/) structure: numbered sections, each tagged by data tier, data versioned as JSON in git.

## Data tiers

- **Live** (`data/fred-series.json`) — auto-fetched monthly from FRED (`DLTRUCKSSAAR`, `FLTRUCKSSAAR`, `ALTSALES`) via `scripts/fetch_fred.py`, run by `.github/workflows/update-fred.yml`. Appends only; never overwrites history.
- **Real** (`data/manual-data.json` → `real_series`) — structured figures entered by hand from OEM IR releases, GPI 10-Q/10-K filings, earnings calls, and Cox Automotive/KBB ATP releases (sourced via AlphaSense). See the `_instructions` block at the top of that file for exactly how to add a data point.
- **Tracked** (`data/manual-data.json` → `tracked_notes`) — qualitative status notes (rebranding/SEO, Val-U-Line, dealership disposal program, leverage), updated by hand as things develop.

## Local development

Just open `index.html` in a browser, or serve the directory:

```bash
python3 -m http.server 8000
```

## Updating live data manually

```bash
python3 scripts/fetch_fred.py
```

## Updating real/tracked data

Edit `data/manual-data.json` directly, following the `_instructions` block inside it. Commit the change — no other build step is required.

## Deployment

Static site served via GitHub Pages from the `main` branch root.
