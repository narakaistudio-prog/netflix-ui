# MovieBox ±10s — bina proxy wala rasta (phone)

> Owner: *"haa koi safe tarika dekho bina koi proxy lagaye or merge mat karna
> bas preview dena"*

PR #91 me page ko hamare origin ke proxy se serve kiya gaya tha (taaki andar
script daal kar `<video>` tak pahunchein) — us raste par MovieBox ka video
chalta hi nahi tha, isliye revert (#92). Ab rasta **bilkul ulta** hai: page
chhedo hi na, bas **stream URL** seedha browser me lao.

## Pehle: kya possible hai, kya nahi (empirically)

CI probe (`scripts/probe-moviebox-play.mjs`, GitHub Actions runner par chalta
hai — runner ke paas internet hai):

| Cheez | Result |
| --- | --- |
| `GET h5-api…/home` guest token | `200`, token `x-user` response header me |
| API CORS | **origin reflect** hota hai (`ACAO: https://net-ki15.vercel.app`) + `access-control-expose-headers: *` |
| `GET /media-player/get-domain` | `200` → rotates (aaj `mzfi.me`) |
| `GET {player}/…/subject/play` | `200`, par **US runner** se `hasResource:false`, `streams: []` (region) |
| mobile BFF `play-info` | `403 Service not available in current region` |
| CDN (media file) | `206`, **`ACAO: none`** — par media element playback ko CORS chahiye hi nahi |

Nateeja: **browser se seedha** (user ka IP, India) API call ho sakti hai — koi
server/proxy beech me nahi. CDN par CORS nahi hai, isliye MP4 `<video src>`
seedha chalta hai; HLS ko hls.js chahiye hota (usko CORS chahiye) — isliye HLS
sirf Safari ke native HLS par.

## Flow (`lib/movieboxDirect.ts`, poori tarah client-side)

1. guest token ← `GET /home` ka `x-user` header (30 min cache)
2. player host ← `GET /media-player/get-domain` (fallback `mzfi.me`)
3. streams ← `GET {player}/wefeed-h5api-bff/subject/play?subjectId&se&ep&detailPath`
4. `pickStreams()` — sirf asli media URL (`mp4/m3u8/mpd`), `vipLocked` drop,
   **MP4 pehle** (media element ko CORS nahi chahiye)
5. `MovieboxDirectPlayer` — `<video>` hamare document me, `currentTime` hamare
   haath me

## Gestures (`components/MovieboxDirectPlayer.tsx`)

| Tap | Kya |
| --- | --- |
| double-tap **baayein 34%** | −10s |
| double-tap **daayein 34%** | +10s |
| double-tap **beech** | play / pause |
| ek tap | play / pause |

- **Koi button nahi**, koi permanent control bar nahi — sirf 0.9s ka halka
  toast (`-10s 01:23 / 45:10`), `pointerEvents: none`.
- 0 se pehle aur `duration − 0.3s` ke baad seek nahi.
- Muted-autoplay block ho jaye to muted chala kar pehle tap par awaaz wapas.

## Safe fallback (zero regression)

`MovieboxPagePlayer` phone par pehle direct try karta hai; **kuch bhi** galat ho
to wahi purana cropped iframe chal jata hai:

| Haalat | Kya hota hai |
| --- | --- |
| `streams: []` / region | `reason: no-streams` → iframe |
| token na mile | `no-token` → iframe |
| sirf HLS + Chrome | `unsupported-format` → iframe |
| video `error` | `media-error` → iframe |
| 12s me pehla frame nahi | `not-playing` → iframe |

Console me reason dikhta hai: `[m2box-direct] fallback: <reason>`.

## Files

| File | Kaam |
| --- | --- |
| `lib/movieboxDirect.ts` | token → player host → streams, cache, pure helpers |
| `components/MovieboxDirectPlayer.tsx` | `<video>` + invisible double-tap + watchdog |
| `components/MovieboxPagePlayer.tsx` | phone par direct → fail par iframe |
| `scripts/probe-moviebox-play.mjs` | CI probe (Actions) — API + CDN headers |
| `tests-arena/moviebox-direct.test.tsx` | 14 tests (pure + asli jsdom gestures) |

## Test

`tests-arena/moviebox-direct.test.tsx` — 14/14:

- `pickStreams`: MP4 pehle, VIP-locked/khaali/non-media drop, `hls` string list
- `pickPlayableStream`: Chrome me HLS → `null` (iframe), Safari me HLS ok
- `resolveDirectStreams`: token `x-user` se, link se se/ep parse, khaali streams
  → `ok:false`, cache hit par koi network call nahi
- Player (jsdom): koi `<button>` nahi, double-tap left −10s / right +10s,
  HLS-only fallback, `error` par parent ko khabar

## Risk (jaan-boojh kar)

1. `subject/play` ne CI (US) se khaali streams diye — **region** ka asar hai.
   India ke browser me asli streams milne chahiye. Na mile to player chup-chaap
   purane iframe par chala jayega (koi regression nahi, bas ±10s nahi milega).
2. Stream URLs signed/rotate hote hain — 20 min cache, phir dobara resolve.
3. `/subject/play` par rate limit (~1 successful call / 2-3 min per IP) hai;
   cache isi liye hai.

---

# Follow-up: −10s / +10s ke **dikhne wale buttons** (phone)

> Owner (phone screenshot, title ke bagal do jagah mark karke): "jaha par mark
> kiya hai waha par 10 sec piche aur right mae 10 sec aage ka button de do".

Invisible double-tap waisa hi hai; uske upar ab **do visible buttons** hain:

```
Mandaadi                       (  ‹‹ 10s )  ( 10s ›› )
Mandaadi                                      ← owner ke marks
2h 33m
```

- Jagah: bade title (`phoneEpisodeTitle`) ke saath **ek hi row**
  (`phoneTitleRow`), `marginLeft: 'auto'` se daayein — bilkul screenshot ke marks
  par. 46px gol buttons, halka white border, icon + `10s`.
- Press par `seekMovieboxBy(±10)` (`lib/movieboxSeekBridge.ts`) → wahi clamp aur
  wahi toast jo double-tap deta hai. Koi alag seek logic nahi.
- **Sirf tab dikhte hain jab seedha player chalu ho** (`useMovieboxSeekReady()`).
  Iframe wale fallback me seek ho hi nahi sakta, isliye dead button nahi dikhata.
- Bridge ka matlab: buttons `MovieDetailModal` me hain, video
  `MovieboxDirectPlayer` ke andar — ek module-level register/subscribe pul dono
  ko jodta hai (player unmount par unregister, identity check ke saath).
