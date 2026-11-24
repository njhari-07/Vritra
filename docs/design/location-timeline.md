# Synthetic location timeline

The Timeline tab compares time-stamped observations in the selected case. Its offline coordinate grid draws the reported accuracy area for each observation and links it to the original CSV row in the evidence drawer. The time window, subject filter, and cursor narrow the observations shown in the grid and the event list. The proximity form uses the entered time window and lists the evidence for each match.

## Input and provenance

Download the header template in Timeline. The CSV requires a record ID, subject ID, device ID, ISO timestamp with a timezone, latitude, longitude, positive accuracy radius in metres, and a source kind of `gps`, `cell_tower`, `photo_exif`, or `manual`. Each row must carry `true` in the `synthetic` column. Uploads that break the synthetic marker or schema requirement are rejected. Allowed synthetic rows with invalid field values are quarantined with a row locator and a reason.

The ledger retains the source bytes, SHA-256 hash, CSV record and line numbers, parsed passage, extraction method and version, evidence and import identifiers, normalized UTC event time, and separate ingestion time. The reported radius is kept with the observation, and extraction confidence is left unset. Scope checks apply to uploads, queries, and source retrieval. The records are evidence-only, so an observation consumes no case graph nodes and contributes no lead score.

Timeline filters, the cursor, the call explorer, and the evidence drawer display timestamped records in India Standard Time (`Asia/Kolkata`, UTC+05:30). A date-only source remains a date. The filters submit explicit timezone offsets for server-side comparisons.

## Distance and time

The offline grid uses an approximate local projection. Query classifications use great-circle distance between coordinate centres. With centre distance `d` and the sum of reported accuracy radii `a`, the estimated separation runs from `max(0, d - a)` to `d + a`. A coordinate search uses zero radius for the query coordinate. The result says “Within radius under stated accuracy” when the entire interval fits and “Possible overlap” when only part intersects. A cell-tower observation appears as a dashed coverage area. EXIF coordinates are labelled claimed metadata.

Pair queries require two different subject labels, two different devices, and timestamps inside the selected window and requested tolerance. The results describe reported device observations. Subject and device IDs come directly from the rows and are unverified labels. Configured limits bound the import size, retained case rows, pair comparisons, and returned pair matches.

## Demo and follow-up

Select a dedicated demo case and choose **Timeline → Load synthetic scenario**. MAHA generates six location observations and four contextual events in memory. The contextual records show a reported time range, a call, a bank credit, and a conflicting statement. The source contains two CSV sections because the contextual events use a different schema from the upload template. Each event points to its own source row.

The evidence board, lead evidence coverage, hypothesis checking, and contradiction detection are future milestones. The time range in the demo comes from the scenario generator. Postmortem document parsing and image or EXIF intake remain separate work.

## Locations named in documents

English FIRs, court documents, and pasted text retain source-linked place names. Explicit address labels, reported sightings, and reported event locations carry separate relationship labels. The Timeline tab lists those records for review. Once a candidate is confirmed, MapLibre shows either a site marker or an area-level reference. Dated records appear in the event list, and the original wording is preserved on the evidence record. An investigator can link a reported sighting to a person already in the active case.

The map uses MapLibre and locally hosted [Protomaps vector tiles](https://docs.protomaps.com/basemaps/maplibre) derived from [OpenStreetMap](https://www.openstreetmap.org/copyright). The installed archives cover India at overview zoom and Bengaluru, Mysuru, and surrounding areas at street zoom. Clicking a site pin or area marker opens controls to zoom to the place and view its source evidence. The Natural Earth outline provides context beyond tile coverage and serves as the fallback when the archives are missing.

The place search catalogue includes 214 Indian populated-place references and two airport references. Optional Nominatim lookup uses a locally configured loopback HTTP endpoint `MAHA_LOCAL_GEOCODER`. The map and place search keep case viewports, documents, and place queries local.

Source data are from [Natural Earth land](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_110m_land.geojson), [populated places](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/), and [airport references](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_10m_airports.geojson).

### Install map assets

Use the [PMTiles CLI](https://docs.protomaps.com/pmtiles/cli) and a current [Protomaps daily build](https://maps.protomaps.com/builds). Run from the project root. The build URL below identifies the snapshot used for the local installation. Use a current build when that snapshot expires.

```bash
map_build=https://build.protomaps.com/20261123.pmtiles
map_assets=data/private/map-assets
mkdir -p "$map_assets"
pmtiles extract "$map_build" "$map_assets/india.pmtiles.tmp" --bbox=67.5,6.5,98,36.5 --maxzoom=9 --overfetch=.35
pmtiles extract "$map_build" "$map_assets/south-karnataka.pmtiles.tmp" --bbox=75.85,11.85,78.3,13.75 --maxzoom=15 --overfetch=.35
for region in india south-karnataka; do
  pmtiles verify "$map_assets/$region.pmtiles.tmp" && mv "$map_assets/$region.pmtiles.tmp" "$map_assets/$region.pmtiles"
done
for range in 0-255 256-511 768-1023 8192-8447 8448-8703; do
  curl -fL "https://protomaps.github.io/basemaps-assets/fonts/Noto%20Sans%20Regular/$range.pbf" \
    -o "$map_assets/noto-sans-$range.pbf"
done
for sprite in light.json light.png light@2x.json light@2x.png dark.json dark.png dark@2x.json dark@2x.png; do
  curl -fL "https://protomaps.github.io/basemaps-assets/sprites/v4/$sprite" -o "$map_assets/$sprite"
done
```

The archives take about 145 MiB together and are excluded from Git. The backend serves only the expected map filenames under `/api/map-assets/` and supports HTTP range reads.

## Reproduce the fictional investigation

Run from the project root. This command creates a temporary ledger and writes the invented input files, expected answers, output checks, and Markdown report to an empty destination.

```bash
.venv/bin/python scripts/evaluate_synthetic_investigation.py --case DEMO-RIVER-VERIFY --out /tmp/maha-river-verify
```

Adding `--live` creates the fictional case on the existing local service using the locally configured investigator token. Choose a fresh demo case identifier and keep generated run artifacts in the private data directory.
