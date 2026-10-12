# Crunchyroll player — Nxsha-only coverage

The Crunchyroll section now uses **Nxsha as its only playback provider**. The previous AnimaHD/Drive player tabs and fallback switching have been removed.

**41/41 catalog titles mapped** · **1669 guide episodes** across series and movies.

The original Nxsha entries have their existing probe results in `data/nxsha-verify.json`. The 23 titles migrated from the old source have Nxsha IDs configured but are not yet live-probed in this checkout; run `node scripts/probe-nxsha.mjs` from a network-enabled runner to verify embed responses and season numbering.

## Series

| Title | Nxsha ID | Guide seasons | Episodes | Probe status |
|---|---|---:|---:|---|
| Attack on Titan | `tt2560140` | S1:25 + S2:12 + S3:22 + S4:28 | 87 | Verified |
| Tokyo Revengers | `105009` | S1:24 + S2:13 + S3:12 | 49 | Verified |
| Vinland Saga | `tt10233448` | S1:24 + S2:24 | 48 | Verified |
| Sword Art Online | `tt2250192` | S1:25 + S2:24 + S3:24 + S4:23 | 96 | Verified |
| Dr. STONE | `tt9679542` | S1:24 + S2:11 + S3:22 + S4:12 | 69 | Verified |
| Boruto: Naruto Next Generations | `tt6342474` | S1:293 | 293 | Verified |
| Solo Leveling | `127532` | S1:12 + S2:13 | 25 | Not probe-checked |
| Demon Slayer: Kimetsu no Yaiba | `tt9335498` | S1:26 | 26 | Not probe-checked |
| JUJUTSU KAISEN | `tt12343534` | S1:24 + S2:23 | 47 | Not probe-checked |
| One Piece | `37854` | S1:31 + S20:10 | 41 | Not probe-checked |
| Frieren: Beyond Journey’s End | `tt22248376` | S1:28 | 28 | Not probe-checked |
| Chainsaw Man | `114410` | S1:12 | 12 | Not probe-checked |
| SPY x FAMILY | `120089` | S1:25 + S2:12 + S3:13 | 50 | Not probe-checked |
| Kaiju No. 8 | `207468` | S1:2 + S2:12 | 14 | Not probe-checked |
| Naruto Shippuden | `tt0988824` | S1:32 + S2:21 + S3:18 + S4:17 + S5:24 + S6:31 + S7:8 + S8:7 + S9:21 + S10:25 + S11:21 + S13:20 + S14:25 | 270 | Not probe-checked |
| Death Note | `tt0877057` | S1:37 | 37 | Not probe-checked |
| My Hero Academia | `tt5626028` | S6:25 + S7:21 + S8:12 | 58 | Not probe-checked |
| One Punch Man | `tt4508902` | S1:12 | 12 | Not probe-checked |
| Bleach | `30984` | S1:13 + S2:13 + S3:14 | 40 | Not probe-checked |
| Hunter x Hunter | `tt2098220` | S1:26 + S2:12 + S3:20 + S4:17 + S5:21 | 96 | Not probe-checked |
| Mob Psycho 100 | `tt5897304` | S1:12 + S2:14 + S3:12 | 38 | Not probe-checked |
| Re:ZERO | `65942` | S1:13 + S2:15 + S3:16 + S4:11 | 55 | Not probe-checked |
| Black Clover | `tt7441658` | S1:26 + S2:1 | 27 | Not probe-checked |
| HAIKYU!! | `60863` | S2:25 + S4:27 | 52 | Not probe-checked |
| BLUE LOCK | `tt15222080` | S2:14 | 14 | Not probe-checked |
| OSHI NO KO | `203737` | S1:11 + S2:13 + S3:11 | 35 | Not probe-checked |
| DAN DA DAN | `240411` | S1:12 | 12 | Not probe-checked |
| Tower of God | `97860` | S1:13 | 13 | Not probe-checked |
| The God of High School | `99778` | S1:13 | 13 | Not probe-checked |

## Movies

| Title | Nxsha ID | Probe status |
|---|---:|---|
| Your Name | `tt5311514` | Verified |
| Suzume | `tt16428256` | Verified |
| A Silent Voice | `tt5323662` | Verified |
| Spirited Away | `tt0245429` | Verified |
| Princess Mononoke | `tt0119698` | Verified |
| Howl's Moving Castle | `tt0347149` | Verified |
| Akira | `tt0094625` | Verified |
| Weathering With You | `tt9426210` | Verified |
| Jujutsu Kaisen 0 | `tt14331144` | Verified |
| Demon Slayer: Mugen Train | `tt11032374` | Verified |
| My Hero Academia: Two Heroes | `505262` | Verified |
| Sword Art Online: Ordinal Scale | `413594` | Verified |
