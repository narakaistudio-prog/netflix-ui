# Crunchyroll player — Nxsha source and metadata status

The Crunchyroll section uses **Nxsha as its only playback provider**. The former AnimaHD/Drive player tabs and fallback switching are removed. This document separates route mappings from episode metadata; a configured player ID does not prove Nxsha season or episode counts.

## Guide data

A manual GitHub Action, `Harvest Nxsha episode guide`, fetches each series detail page and its `/api/tv/{tmdbId}/season/{season}` responses. It writes the resulting Nxsha-only episode snapshot to `data/nxsha-episodes.json`, refreshes the series season maps in `data/nxsha-titles.json` and `data/nxsha-plan.json`, and records field coverage in `data/nxsha-harvest-report.json`. The checked-in HTML guide is then rebuilt with `node scripts/bake-animahd-links.mjs`.

**The live harvest has not yet completed.** Until `data/nxsha-harvest-report.json` is present, counts retained in the route manifest are legacy/unverified and must not be cited as confirmed Nxsha episode counts. Local catalogue images and descriptions are not used as Nxsha episode metadata; missing Nxsha stills render an episode-specific placeholder, and absent synopsis/runtime fields are omitted.

Nxsha's Tokyo Revengers detail page confirms **1 season and 55 episodes**. The harvester will replace the old local 3-season map with the API result. **One Piece is intentionally excluded** from the season/episode-guide refresh and remains unchanged.

## Catalog routing

- **41/41 catalog titles** have a configured Nxsha playback route.
- **28 non-One-Piece TV series** are included in the episode guide harvest.
- **12 movies** remain routed through Nxsha and are not part of the series season harvest.
- **23 migrated route IDs** still lack a successful live embed probe in the checked-in `data/nxsha-verify.json`; that status is separate from season/episode metadata verification.

After a successful harvest, use `data/nxsha-harvest-report.json` for exact Nxsha counts, still coverage, synopsis coverage, and per-title status. Never infer those results from the old catalogue or route map.
