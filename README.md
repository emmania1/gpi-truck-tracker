# GPI Truck Volume Exposure Tracker

Static dashboard tracking truck-market demand exposure relevant to Group 1 Automotive (NYSE: GPI), modeled on the [vol-regime-tracker](https://slogatskiy.github.io/vol-regime-tracker/) structure: numbered sections, each tagged by data tier, data versioned as JSON in git.

## Data tiers

- **Live** (`data/fred-series.json`) — auto-fetched monthly from FRED (`DLTRUCKSSAAR`, `FLTRUCKSSAAR`, `ALTSALES`, `TERMCBAUTO48NS`, `GASREGW`, `TXUR`) via `scripts/fetch_fred.py`, run by `.github/workflows/update-fred.yml`. Appends only; never overwrites history. To add another FRED series, add an entry to the `SERIES` dict in `scripts/fetch_fred.py` and re-run it — the fetcher and chart helpers are generic.
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

## Monthly maintenance (manual series)

- **Section 6 (used market)** — update monthly from Cox Automotive: wholesale (Manheim MUVVI) on the 5th business day (next: **Nov 6, 2026**), retail (vAuto inventory report) around mid-month. The due date lives in `data/manual-data.json` → `real_series.used_market_monthly.maintenance.next_due`; the page shows it in the freshness bar and flags it when overdue. After updating, bump `next_due` to the 5th business day of the following month.
- **GPI quarterly series** (`gpi_new_vehicle_sss`, `gpi_used_vehicle`) — add a row after each GPI earnings release (Q3 2026: Oct 28, 2026).
- **OEM deliveries** — add rows after Ford/GM quarterly sales releases (early Jan for Q4). Use GM's TOTAL lines; see `_instructions` in the data file.

## Cache-busting (run before every commit that touches app.js or style.css)

GitHub Pages caches files for 10 minutes, so visitors can briefly see old JS/CSS with new HTML. `index.html` references `app.js?v=<hash>` and `style.css?v=<hash>`; after editing either file run:

```bash
python3 scripts/stamp_assets.py
```

and commit the updated `index.html` along with the change. (Data JSON is fetched with `cache: no-store`, so data is never stale.)
