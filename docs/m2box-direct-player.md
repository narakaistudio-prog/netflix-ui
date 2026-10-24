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

---

# 24 Oct: Owner ka follow-up — "button kaha hai hi nahi laga", aur API ka sach

> Owner: "button kaha hai hai hi nhi laga hua ye jo fallback no stream likhta ye
> sab bhi hta do or second image mae jaha mark hai wah sahi mae button do working
> samjha phone ke liyea uske baad pr bnakar sab sahi se merge kar"

## 1. Fallback/debug text hata diya

`MovieboxPagePlayer` me jo 10px wali line (`direct ok · …` / `fallback: …`,
`?m2boxdebug=1` par hamesha) dikhti thi, wo **poori tarah hata di**. Ab player ke
upar sirf player hai — reason sirf console me (`[m2box-direct] fallback: …`).

## 2. Buttons ab hamesha dikhte hain (gate hata)

Pehle wo `seekReady` par gate the — jab MovieBox ki API stream nahi deti to
player unki site ke iframe par chala jata hai, `seekReady` false reh jata hai,
aur button **gayab**. Isi liye owner ko "laga hi nahi" dikha.

Ab:

| Haalat | Button | Tap par |
| --- | --- | --- |
| Video hamare `<video>` me (direct stream mila) | poora chamakta hua | sach me ±10s (clamp + toast) |
| Video cross-origin iframe me (site ka player) | wahi jagah, halka dhundhla (`opacity 0.45`) | toast: "10s skip works in the built-in player only" |

Cross-origin iframe ke andar `currentTime` chhuna browser allow hi nahi karta
(same-origin policy) — isliye wahan "ho gaya" ka jhooth nahi bolte.

## 3. Sach: MovieBox ki play API guest ko stream deti hi nahi (24 Oct 2026)

`scripts/probe-moviebox-browser.mjs` (browser ke nazariye se — OPTIONS preflight
+ safelisted GET + CDN) aur `scripts/probe-moviebox-play.mjs` se, GitHub runner
se:

| Test | Nateeja |
| --- | --- |
| OPTIONS preflight (`authorization`, `x-client-token`, `x-play-mode`) | **200**, `ACAH` me saare headers allowed |
| `GET /subject/play` (hamare asli headers) | **200 · streams 0 · hls 0 · dash 0 · hasResource false** |
| `GET /subject/play` (bina kisi custom header ke) | wahi — **0 streams** |
| `m2box.org`, `moviebox.ph`, `h5-api`, `mzfi.me` — chaaron hosts | sab par `hasResource:false`, `maxResolution:480` |
| Mandaadi, Avatar, Wednesday, Inception, Stranger Things | **sab par 0** |
| `/detail` ka `resourceDetectors` | 0, aur ek purana sample mp4 |
| mobile BFF `play-info` | 403 — "Service not available in current region" (runner US me) |
| CDN (`macdn.aoneroom.com`) | 206, no ACAO — media element chalta hai *agar* URL mile |

Matlab: aaj koi bhi title direct `<video>` me nahi aata — player hamesha unki
site ke player par jata hai (jo chalta hai, par uska `currentTime` hamare haath
me nahi). Isliye ±10s sirf us waqt kaam karta hai jab MovieBox dobara streams
dene lage; tab kuch aur badalna nahi padega — buttons pehle se jude hue hain.

Rasta aage khulne par: `/subject/play` ka jawab streams ke saath aate hi
`MovieboxDirectPlayer` mount ho jata hai aur buttons apne aap "chalu" ho jate
hain (hook bridge se).
