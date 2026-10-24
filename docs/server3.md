# Server 3 — third-party player (VidSync gaya, registry aayi)

Owner (24 Oct): *"vidsync hta de aur third server ke liyea aur mast server dhund
player bilkul aacha aur fast"*

## VidSync kyun hataya

- Unka player line 1 par **ruk ruk kar chalta tha** (laptop).
- Teen upstream lines (`server=1|2|3`) ka switch banaya — teeno par wahi haal.
- Uske baad unke paas bacha hi kuch nahi tha: speed unke relay par depend karti
  hai, hum bahar se buffer/quality control nahi kar sakte.

Isliye poora VidSync code, tests, line-pills aur docs **hata diye** (koi dead
code nahi bacha — test bhi isi ko assert karta hai).

## Ab: provider registry (`lib/server3.ts`)

Server 3 ek hi embed par tika nahi hai. Provider badalna **ek line** ka kaam hai:

| Provider | Movie / TV URL | ID | Notes |
| --- | --- | --- | --- |
| **Videasy** (default) | `player.videasy.net/movie/{id}` · `/tv/{id}/{s}/{e}` | TMDB | Sabse zyada sites isi par; player ke andar 10+ source + quality |
| VidFast | `vidfast.pro/movie/{id}` · `/tv/{id}/{s}/{e}` | TMDB | Fastest TTFB bucket me, multi-source |
| VidLink | `vidlink.pro/movie/{id}` · `/tv/{id}/{s}/{e}` | TMDB | 13+ sources, postMessage API |
| MyCineBy | `mycineby.cc/embed/movie/{id}` · `/embed/tv/…` | TMDB | `color`/`autoplay` params |
| VidAPI | `vaplayer.ru/embed/movie/{id}` · `/embed/tv/…` | TMDB/IMDb | `PLAYER_EVENT` postMessage |

**Ek provider par bet nahi:** player ke top bar me ek pill hai —
`Videasy ⟳` — tap par agla source (VidFast → VidLink → MyCineBy → VidAPI).
Choice `localStorage` (`server3_provider_v1`) me yaad rehti hai. Tees button nahi,
ek pill — owner ka "dead buttons na dikhao" rule.

## Probe (GitHub runner se, 24 Oct)

### 1. Headers + TTFB (`scripts/probe-server3.mjs`)

| provider | code | ttfb_ms (movie) | ttfb_ms (tv) | bytes | X-Frame-Options | CSP frame-ancestors |
| --- | --- | --- | --- | --- | --- | --- |
| vidfast.pro | 200 | 728 | 546 | ~170 KB | – | none |
| vidfast.vc | 200 | 282 | 239 | ~170 KB | – | none |
| videasy | 200 | 514 | 205 | ~18 KB | – | none |
| vidlink.pro | 200 | 308 | 189 | ~20 KB | – | none |
| mycineby.cc | 200 | 408 | 351 | ~71 KB (hls) | – | none |
| vaplayer.ru | 200 | 559 | 481 | ~72 KB (msg-api) | – | none |
| vidcore.org | 200 | 907 | 851 | 515 B (JS gate) | – | none |
| 2embed.cc | 200 | 1216 | 798 | 9 KB | – | none |
| embedwave.cc | 200 | 3823 | 883 | 8 KB | – | none |
| vixsrc.to | 403 | 62 | 32 | – | – | – |
| vidsrc.pro / moviesapi.club / vidora.su | 0 | – | – | – | – | – |

Koi bhi provider iframe block nahi karta (`X-Frame-Options` / `frame-ancestors`
kahin nahi) — matlab Server 3 ka rasta saaf hai.

### 2. Asli playback (`scripts/probe-server3-playback.mjs`, Chromium)

Har candidate ko asli Chromium me khola, **hamare iframe sandbox ke saath bhi**,
aur 8 second tak `waiting`/`stalled` events gine.

Nateeja: **runner ke datacenter IP se koi bhi player video nahi utha paaya**
(`no <video>` / `readyState 0`). Ye players human/VPN/IP check karte hain, aur
click-gate bhi hai — isliye CI se "chal raha hai" kehna jhooth hoga. Jo cheez
CI se sach me pata chali:

- mycineby + vidlink dono ne `<video>` element banaya (player boot hua) —
  baaki ne nahi.
- Sandbox attribute kisi ne reject nahi kiya (hamara iframe setup theek hai).

Isliye **playback quality ka faisla user ke phone/laptop par hoga**, aur uske
liye `Videasy ⟳` pill hai — ek tap me doosra source.

## Server order

```
MovieBox hai : nxsha → nhd → custom? → M2Box → Server 3
MovieBox nahi: nxsha → Server 3
TMDB id nahi : nxsha        (Server 3 ka pill dikhta hi nahi)
```

Server 3 kabhi default nahi — Server 1 hi pehla (owner ka pattern), aur Series
par chalu episode hi khulta hai.

## Files

| File | Kaam |
| --- | --- |
| `lib/server3.ts` | registry, URL builder, id parsing, source rotate + persistence |
| `lib/playbackServers.ts` | cycle me `server3` (aakhri) |
| `app/movie/[id].tsx` | movie page: cycle + src + source cycle |
| `components/MovieList/MovieDetailModal.tsx` | phone detail: "Server 3 (<label>)" chip + pill |
| `components/EmbedPlayer.tsx` | `sourceName` + `onCycleSource` → ek pill (`embed-source-cycle`) |
| `tests-arena/server3.test.tsx` | 19 tests: id parsing, URL shape per provider, rotation, persistence, chip → play → src, VidSync ka safaya |
| `scripts/probe-server3*.mjs` | probe scripts (dobara chalane ke liye) |

## Tests

```
NODE_OPTIONS=--max-old-space-size=3072 ./node_modules/.bin/jest \
  --config jest.arena.config.js --runInBand tests-arena/server3.test.tsx
```
