# Crunchyroll player — Nxsha guide coverage

The Crunchyroll section uses **Nxsha as its only playback provider**. The previous AnimaHD/Drive player tabs and fallback switching are removed. Route mapping status and episode-guide verification are tracked separately.

## Nxsha episode harvest

Harvested 2026-10-12T10:31:31.869Z from `https://nxsha.space/api/tv/{tmdbId}/season/{season}`: **28/28 non-One-Piece series**, **2,802 episodes**, **2,773 episode stills**, and **2,773 episode synopses**. No series failed; 29 episodes lack a still and 29 lack a synopsis. The full response snapshot is `data/nxsha-episodes.json`; `data/nxsha-harvest-report.json` is the machine-readable audit report.

The season maps in `data/nxsha-titles.json` and `data/nxsha-plan.json` now come from Nxsha season API responses. The browser guide uses only this Nxsha snapshot for non-One-Piece episode titles, stills, synopsis, air date, and runtime. Missing stills use a unique episode placeholder; missing synopsis/date/runtime fields are omitted instead of borrowing show art or generic local-catalog text.

**Tokyo Revengers is 1 season / 55 episodes** on Nxsha, replacing the old local 3-season map. **One Piece was intentionally excluded** from the harvest and its existing route/season map remains unchanged.

## Adding future anime

The daily harvester is not limited to today's 28 series: it reads the current Crunchyroll `shows` catalog and the Nxsha route registry on every run. When adding a TV anime, add its card to `assets/crunchyroll/crunchyroll.html` and add a matching key to `data/nxsha-titles.json` with its Nxsha `/tv/{id}` page ID, title, and `kind: "tv"`. The workflow then harvests its current seasons/episodes, adds it to the verification plan, and bakes its guide data into the page. A catalog card without a matching Nxsha registry entry fails the refresh with the missing key, rather than being silently skipped. One Piece remains excluded from episode-guide refreshes.

| Series | Nxsha API ID | Nxsha season map | Episodes | Stills | Synopses |
|---|---:|---|---:|---:|---:|
| Attack on Titan | `1429` | S1: 25 + S2: 12 + S3: 22 + S4: 28 | 87 | 87 | 87 |
| Tokyo Revengers | `105009` | S1: 55 | 55 | 52 | 52 |
| Vinland Saga | `88803` | S1: 24 + S2: 24 | 48 | 48 | 48 |
| Sword Art Online | `45782` | S1: 25 + S2: 24 + S3: 24 + S4: 23 | 96 | 96 | 96 |
| Dr. STONE | `86031` | S1: 24 + S2: 11 + S3: 22 + S4: 37 | 94 | 94 | 94 |
| Boruto: Naruto Next Generations | `70881` | S1: 293 | 293 | 293 | 293 |
| Solo Leveling | `127532` | S1: 25 | 25 | 25 | 25 |
| Demon Slayer: Kimetsu no Yaiba | `85937` | S1: 26 + S2: 7 + S3: 11 + S4: 11 + S5: 8 | 63 | 63 | 63 |
| JUJUTSU KAISEN | `95479` | S1: 59 | 59 | 59 | 59 |
| Frieren: Beyond Journey's End | `209867` | S1: 38 | 38 | 38 | 38 |
| Chainsaw Man | `114410` | S1: 12 | 12 | 12 | 12 |
| SPY x FAMILY | `120089` | S1: 25 + S2: 12 + S3: 13 | 50 | 50 | 50 |
| Kaiju No. 8 | `207468` | S1: 23 | 23 | 23 | 23 |
| Naruto Shippūden | `31910` | S1: 32 + S2: 21 + S3: 18 + S4: 17 + S5: 24 + S6: 31 + S7: 8 + S8: 24 + S9: 21 + S10: 25 + S11: 21 + S12: 33 + S13: 20 + S14: 25 + S15: 28 + S16: 13 + S17: 11 + S18: 21 + S19: 20 + S20: 87 | 500 | 500 | 500 |
| Death Note | `13916` | S1: 37 | 37 | 37 | 37 |
| My Hero Academia | `65930` | S1: 13 + S2: 25 + S3: 25 + S4: 25 + S5: 25 + S6: 25 + S7: 21 + S8: 11 | 170 | 170 | 170 |
| One-Punch Man | `63926` | S1: 12 + S2: 12 + S3: 12 | 36 | 36 | 36 |
| Bleach | `30984` | S1: 366 + S2: 50 | 416 | 414 | 414 |
| Hunter x Hunter | `46298` | S1: 62 + S2: 74 + S3: 12 | 148 | 148 | 148 |
| Mob Psycho 100 | `67075` | S1: 12 + S2: 13 + S3: 12 | 37 | 37 | 37 |
| Re:ZERO -Starting Life in Another World- | `65942` | S1: 85 | 85 | 85 | 85 |
| Black Clover | `73223` | S1: 170 + S2: 26 | 196 | 172 | 172 |
| Haikyu!! | `60863` | S1: 25 + S2: 25 + S3: 10 + S4: 25 | 85 | 85 | 85 |
| BLUE LOCK | `131041` | S1: 38 | 38 | 38 | 38 |
| 【OSHI NO KO】 | `203737` | S1: 35 | 35 | 35 | 35 |
| Dan Da Dan | `240411` | S1: 24 | 24 | 24 | 24 |
| Tower of God | `97860` | S1: 13 + S2: 26 | 39 | 39 | 39 |
| The God of High School | `99778` | S1: 13 | 13 | 13 | 13 |

## Playback route status

- **41/41 catalog titles** have a configured Nxsha playback route.
- **12 movies** remain routed through Nxsha; movie metadata is outside the TV season harvest.
- All **41/41 Nxsha playback routes** passed a live embed-title probe in `data/nxsha-verify.json`. The probe checked the first and last episode in every configured TV season and matched the Nxsha title for all 12 movies; Sword Art Online: Ordinal Scale resolved to `413594`.

Use `data/nxsha-harvest-report.json` as the source for exact per-title counts and field coverage. Do not infer Nxsha data from the legacy guide or local catalog.
