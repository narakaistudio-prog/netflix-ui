# Server 3 — VidSync (vidsync.pro)

Owner (24 Oct): *"vidsync.pro mae server 3 isse website se soch raha hu lagne ke
liyea netflix par ye thik hai"*

Haan, ye **sabse saaf** fit hai jo ab tak mila: unka **designed embed iframe**
hai aur route **TMDB numeric id** maangta hai — hamare catalog ke ids
(`tmdb:1465943`) se seedha ban jata hai. Koi link hunting nahi, koi crop nahi,
koi proxy nahi.

## Kya verify hua (GitHub runner se, mobile UA)

| Check | Nateeja |
| --- | --- |
| `GET /embed/movie/155` | `200`, `text/html` |
| `X-Frame-Options` | **nahi** — iframe allowed |
| `CSP frame-ancestors` | **nahi** — koi origin-block nahi |
| `/embed/movie/1184918?dubLang=hindi&primarycolor=E50914` | `200` |
| `/embed/tv/66732/1/1?dubLang=hindi&primarycolor=E50914` | `200` |
| Body | har route par wahi SPA shell (~2.1 KB) |

⚠️ Jo **verify nahi ho saka**: "video sach me chal raha hai". Body SPA hai
(playback JS se hota hai) aur unka VPN-detection datacenter IP par modal dikha
sakta hai — isliye CI se "chal raha hai" kehna jhooth hoga. Asli test user ke
phone/desktop par hota hai (normal residential IP).

## URL

```
movie : https://vidsync.pro/embed/movie/{tmdbId}?primarycolor=E50914&dubLang=hindi
series: https://vidsync.pro/embed/tv/{tmdbId}/{season}/{episode}?primarycolor=E50914&dubLang=hindi
```

- `primarycolor` — Netflix laal `E50914` (`#` ke bina).
- `dubLang=hindi` — Hindi dub mile to wahi, warna **unka apna fallback** original
  audio par (kuch tootta nahi).
- Id parsing: `tmdb:1465943` / `1465943` / `tv-66732` → number.
  **IMDb id (`tt0903747`) reject** — uske digits TMDB id nahi hote, warna
  bilkul doosri film khul jati.

## Server cycle me kahan

```
MovieBox link hai : nxsha → nhd → custom? → M2Box → VidSync
MovieBox nahi hai : nxsha → VidSync          (purana "sirf Server 1" rule + Server 3)
TMDB id nahi hai  : nxsha                    (VidSync ka pill dikhta hi nahi)
```

- VidSync **kabhi default nahi** — Server 1 (Nxsha) hi pehla server hai. Owner ka
  pattern: naya source pehle optional, tabhi default jab wo sab par chale.
- Series par **chalu episode** ka hi embed khulta hai (`/tv/id/s/e`).
- Agar unka player kisi title par kuch na dikhaye → ek tap me Server 1 wapas
  (zero regression).

## "Bahut ruk ruk kar chalta hai" — upstream line switch

Owner (laptop par Server 3): *"bhaii bahut ruk ruk kar chalta hai"*.

Unke docs me ek hi asli lever hai:

```
server=number · 1   →  "Forces a specific upstream provider index on load"
```

Matlab VidSync ke paas **ek se zyada upstream** hain aur har line ki speed alag
hai. Isliye:

- Player ke top bar me **Line 1 · 2 · 3** pills (sirf Server 3 chalne par).
  Ek tap = naya URL = us line se fresh stream. Provider ke gear menu me jaane ki
  zarurat nahi (chhoti screen par wo dhoondhna mushkil hota hai).
- Chuni hui line `localStorage` me yaad rehti hai (`vidsync_server_v1`) — agli
  baar wahi khulti hai. Bekaar value (0/4/'abc') purani choice ko bigaadti nahi.
- Line badalte waqt **playhead yaad** rakha jata hai aur `resumeAt` ke roop me
  bheja jata hai; agar unka player postMessage seek na maane to video shuru se
  chalega (wo unki taraf ki baat hai — hum jhoothe "resume" ka dawa nahi karte).
- Quality (1080p/720p) unke player ke apne menu me hai — hum use hide nahi karte
  (`hidequality` default false), isliye slow net par wahan 720p chun sakte hain.

## Files

| File | Kaam |
| --- | --- |
| `lib/vidsync.ts` | URL builder + id parsing + labels (pure, testable) |
| `lib/playbackServers.ts` | cycle me `vidsync` (aakhri), `vidsyncAvailable` input |
| `app/movie/[id].tsx` | movie page: cycle + `buildSrc()` ka VidSync branch |
| `components/MovieList/MovieDetailModal.tsx` | phone detail: "VidSync" server chip + `playerSrc` |
| `contexts/UserContext.tsx` | `useOptionalUser()` — provider ke bahar render par crash nahi |
| `tests-arena/vidsync.test.tsx` | 18 tests: URL, id parsing, `server=` line, persistence, cycle, chip → play → iframe src |
| `tests-arena/vidsync-lines.test.tsx` | 2 tests: asli EmbedPlayer me Line 1/2/3 pills + tap callback |

## Tests

```
NODE_OPTIONS=--max-old-space-size=3072 ./node_modules/.bin/jest \
  --config jest.arena.config.js --runInBand tests-arena/vidsync.test.tsx
```

## Peeche ka sabak (kyun default nahi)

- M2Box (Server 2) par owner ka rule hai: jis title ka link nahi, wahan button
  hi na dikhe. VidSync isse alag hai — wo id se har title par ban jata hai, par
  **sach me chalta hai ya nahi** wo unke player par depend karta hai. Isliye
  default nahi, sirf pill.
- TV par ye bhi iframe hi hai — MovieBox jaisa hi `currentTime` haath me nahi
  aata, isliye TV par ±10s/seek wala koi dawa nahi.
