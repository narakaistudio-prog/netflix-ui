# Crunchyroll page — episode coverage

**UPDATE (player ab Nxsha-only hai):** Crunchyroll section ka player ab sirf **Nxsha** hai — Server 1 (AnimaHD) aur Server 2 (Drive) hata diye gaye hain. Har title aur har episode `nxsha.space/embed/...` se embed hota hai (`data/nxsha-titles.json` → `NX_DATA`; bake: `node scripts/bake-animahd-links.mjs`).

- **Nxsha (default + only player)** — `https://nxsha.space/embed/{movie|tv}/{id}[/{s}/{e}]` (script: `scripts/probe-nxsha.mjs` + `data/nxsha-titles.json`).

**41 titles / 3519 episodes** (Nxsha) = **41/41 titles playable**.

## Historical: Server 1 + Server 2 (AnimaHD → Drive) — removed from the player

Neeche ka table AnimaHD harvest ka record hai (data layer me ab bhi `data/animahd-episodes.json` ke roop me maujood; player me use nahi hota).

| Title | Seasons (eps each) | Episodes |
|---|---|---|
| Solo Leveling | S1:12 + S2:13 | 25 |
| Demon Slayer: Kimetsu no Yaiba | S1:26 | 26 |
| JUJUTSU KAISEN | S1:24 + S2:23 | 47 |
| One Piece | S1:31 + S20:10 | 41 |
| Frieren: Beyond Journey’s End | S1:28 | 28 |
| Chainsaw Man | S1:12 | 12 |
| SPY x FAMILY | S1:25 + S2:12 + S3:13 | 50 |
| Kaiju No. 8 | S1:2 + S2:12 | 14 |
| Naruto Shippuden | S1:32 + S2:21 + S3:18 + S4:17 + S5:24 + S6:31 + S7:8 + S8:7 + S9:21 + S10:25 + S11:21 + S13:20 + S14:25 | 270 |
| Death Note | S1:37 | 37 |
| My Hero Academia | S6:25 + S7:21 + S8:12 | 58 |
| One Punch Man | S1:12 | 12 |
| Bleach | S1:13 + S2:13 + S3:14 | 40 |
| Hunter x Hunter | S1:26 + S2:12 + S3:20 + S4:17 + S5:21 | 96 |
| Mob Psycho 100 | S1:12 + S2:14 + S3:12 | 38 |
| Re:ZERO | S1:13 + S2:15 + S3:16 + S4:11 | 55 |
| Black Clover | S1:26 + S2:1 | 27 |
| HAIKYU!! | S2:25 + S4:27 | 52 |
| BLUE LOCK | S2:14 | 14 |
| OSHI NO KO | S1:11 + S2:13 + S3:11 | 35 |
| DAN DA DAN | S1:12 | 12 |
| Tower of God | S1:13 | 13 |
| The God of High School | S1:13 | 13 |

## Server 3 (Nxsha) — AnimaHD par available nahi

| Title | Type | Seasons (eps each) | Episodes | Id (verified) |
|---|---|---|---|---|
| Attack on Titan | Series | S1:25 + S2:12 + S3:22 + S4:28 | 87 | `tt2560140` ✓ |
| Tokyo Revengers | Series | S1:24 + S2:13 + S3:12 | 49 | `105009` ✓ |
| Vinland Saga | Series | S1:24 + S2:24 | 48 | `tt10233448` ✓ |
| Sword Art Online | Series | S1:25 + S2:24 + S3:24 + S4:23 | 96 | `tt2250192` ✓ |
| Dr. STONE | Series | S1:24 + S2:11 + S3:22 + S4:12 | 69 | `tt9679542` ✓ |
| Boruto: Naruto Next Generations | Series | S1:293 | 293 | `tt6342474` ✓ |
| Your Name | Movie | S1:1 | 1 | `tt5311514` ✓ |
| Suzume | Movie | S1:1 | 1 | `tt16428256` ✓ |
| A Silent Voice | Movie | S1:1 | 1 | `tt5323662` ✓ |
| Spirited Away | Movie | S1:1 | 1 | `tt0245429` ✓ |
| Princess Mononoke | Movie | S1:1 | 1 | `tt0119698` ✓ |
| Howl’s Moving Castle | Movie | S1:1 | 1 | `tt0347149` ✓ |
| Akira | Movie | S1:1 | 1 | `tt0094625` ✓ |
| Weathering With You | Movie | S1:1 | 1 | `tt9426210` ✓ |
| Jujutsu Kaisen 0 | Movie | S1:1 | 1 | `tt14331144` ✓ |
| Demon Slayer: Mugen Train | Movie | S1:1 | 1 | `tt11032374` ✓ |
| My Hero Academia: Two Heroes | Movie | S1:1 | 1 | `505262` ✓ |
| Sword Art Online: Ordinal Scale | Movie | S1:1 | 1 | `413594` ✓ |

