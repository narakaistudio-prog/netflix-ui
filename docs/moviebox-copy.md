# MovieBox ka copy — "M2Box 2" (doosra domain, wahi backend)

Owner (24 Oct): *"koi aacha server moviebox ka copy dhundo samjhe"*.

## Matlab kya hai

MovieBox ka koi naya "brand" nahi hota. Ek hi backend
(`h5-api.aoneroom.com/wefeed-h5api-bff`) par kai front domains chalte hain —
same catalog, same streams, alag domain. Isliye "copy" ka saaf matlab:
**wahi site, doosra domain**.

## Probe (GitHub runner, 24 Oct — asli internet)

`scripts/probe-moviebox-hosts.mjs` ne front page + BFF (`home?host=…`, `x-user`
token) dono check kiye:

| Host | Front | BFF |
| --- | --- | --- |
| `m2box.org` (default) | 200 · M2Box | 200 · token ok |
| **`m2box.co` (copy)** | 200 · same site shell | 200 · token ok |
| `movieboxonline.net` | 200 | 200 · token ok |
| `netnaija.film` | 200 (alag skin) | 200 · token ok |
| `officialmoviebox.com` | 200 (alag skin) | 200 · token ok |
| `moviebox.ke` | 200 | 200 · token ok |
| `moviebox.ph` | 200 → `movieboxhd.net` | 200 · token ok |
| `moviebox.id` | 200 → `officialmoviebox.com` | 200 · token ok |
| `mzfi.me` | 200 (player shell) | 200 · token ok |
| `moviebox.pk` | **dead** | 200 |

`m2box.co` chuna gaya kyunki layout m2box.org jaisa hi hai — crop ke number
(`STAGE_WIDTH 1536`, `CROP_TOP 117`, `CROP_LEFT 120`, `PLAYER_WIDTH 968`)
bina badle chalta hai. `netnaija.film` / `officialmoviebox.com` alag skin hain,
wahan crop naap dobara lena padta — isliye unhe nahi liya.

## App me kaise aa gaya

| File | Kaam |
| --- | --- |
| `lib/moviebox.ts` | `MOVIEBOX_COPY_SITE` (`https://m2box.co`), `MOVIEBOX_COPY_LABEL` (`M2Box 2`); `buildMovieboxPageUrl(link, { site })` pehle se site override leta tha |
| `lib/playbackServers.ts` | naya server id `moviebox2` — cycle me **MovieBox ke turant baad** (`['nxsha','nhd','custom','moviebox','moviebox2']`) |
| `app/movie/[id].tsx` | `moviebox2` par `MovieboxPagePlayer` ko `site={MOVIEBOX_COPY_SITE}` |
| `components/MovieboxPagePlayer.tsx` | naya prop `site` (default `MOVIEBOX_SITE`) |
| `components/MovieList/MovieDetailModal.tsx` | phone detail par naya chip **Hindi 2** (`testID="server-hindi-2"`) |
| `api/moviebox-frame.mjs` | `m2box.co` pehle se whitelist me tha (frame proxy) |
| `tests-arena/moviebox-copy.test.tsx` | 6 tests: URL copy par, episode override, cycle order, dead slot nahi, chip → copy player, default par override nahi |

## Rules jo nahi badle

- Copy **kabhi default nahi** — Hindi (asli MovieBox) hi pehla server rehta hai.
- MovieBox link na ho to copy ka chip/cycle entry dikhta hi nahi (dead button nahi).
- Sandbox/iframe niyam wahi — `allow-top-navigation` nahi.

## Probe dobara chalana

```bash
node scripts/probe-moviebox-hosts.mjs     # runner/CI me (sandbox ka egress band hai)
```
