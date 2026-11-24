# Synthetic location timeline

The Timeline tab compares time-stamped observations in the selected case. Its offline coordinate grid draws the reported accuracy area for each observation and links it to the original CSV row in the evidence drawer. The time window, subject filter, and cursor narrow the observations shown in the grid and the event list. The proximity form uses the entered time window and lists the evidence for each match.

## Input and provenance

Download the header template in Timeline. The CSV requires a record ID, subject ID, device ID, ISO timestamp with a timezone, latitude, longitude, positive accuracy radius in metres, and a source kind of `gps`, `cell_tower`, `photo_exif`, or `manual`. Each row must carry `true` in the `synthetic` column. Uploads that break the synthetic marker or schema requirement are rejected. Allowed synthetic rows with invalid field values are quarantined with a row locator and a reason.

The ledger retains the source bytes, SHA-256 hash, CSV record and line numbers, parsed passage, extraction method and version, evidence and import identifiers, normalized UTC event time, and separate ingestion time. The reported radius is kept with the observation, and extraction confidence is left unset. Scope checks apply to uploads, queries, and source retrieval. The records are evidence-only, so an observation consumes no case graph nodes and contributes no lead score.

## Distance and time

The offline grid uses an approximate local projection. Query classifications use great-circle distance between coordinate centres. With centre distance `d` and the sum of reported accuracy radii `a`, the estimated separation runs from `max(0, d - a)` to `d + a`. A coordinate search uses zero radius for the query coordinate. The result says “Within radius under stated accuracy” when the entire interval fits and “Possible overlap” when only part intersects. A cell-tower observation appears as a dashed coverage area. EXIF coordinates are labelled claimed metadata.

Pair queries require two different subject labels, two different devices, and timestamps inside the selected window and requested tolerance. The results describe reported device observations. Subject and device IDs come directly from the rows and are unverified labels. Configured limits bound the import size, retained case rows, pair comparisons, and returned pair matches.

## Demo and follow-up

Select a dedicated demo case and choose **Timeline → Load synthetic scenario**. MAHA generates six location observations and four contextual events in memory. The contextual records show a reported time range, a call, a bank credit, and a conflicting statement. The source contains two CSV sections because the contextual events use a different schema from the upload template. Each event points to its own source row.

The evidence board, lead evidence coverage, hypothesis checking, and contradiction detection are future milestones. The time range in the demo comes from the scenario generator. Postmortem document parsing and image or EXIF intake remain separate work.
