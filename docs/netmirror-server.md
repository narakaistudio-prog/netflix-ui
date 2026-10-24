# NetMirror server — "net77.cc jaisa", par apna `<video>`

Owner (24 Oct): *"mujhe koi aisa server chahiye jo net77.cc ki tarah chale ya
best sidhe ek cloudflare se hi connect kar de"*.

## Wahi cheez jo net77.cc karta hai

NetMirror (net77.cc / net27.cc / net79.cc — sab **Cloudflare** par hain, ek hi
backend ke mirrors) apne web app me ye route chalata hai:

```
GET https://net27.cc/api/embed-tmdb/{tmdbId}                    → movie
GET https://net27.cc/api/embed-tmdb/{tmdbId}?type=tv&s=1&e=1    → tv episode
```

Jawab (runner-probe, 24 Oct — asli internet):

```json
{
  "ok": true, "title": "Mandaadi", "mode": "proxy",
  "mp4": "https://bcdnxw.hakunaymatata.com/bt/8a30….mp4?sign=…",
  "resolution": "480",
  "streams": [
    { "url": "…/convert-h264/8e5f….mp4", "resolution": 360, "size": 529218197 },
    { "url": "…/bt/8a30….mp4",           "resolution": 480, "size": 688907489 },
    { "url": "…/cms/47c9….mp4",          "resolution": 1080, "size": 2795925038 }
  ],
  "captions": [ { "lang": "en", "name": "English", "url": "/api/proxy/video?url=…" } ]
}
```

TV par chaar quality aati hain (1080/720/480/360). Title na ho to:

```json
{ "ok": true, "noSource": true, "mode": "none",
  "error": "This title is still being added to NetMirror. Please check back in a bit." }
```

**Do baatein jo ise baaki servers se alag karti hain:**

1. Ye **HLS nahi, seedha MP4** deta hai → apne `<video>` me chalta hai, iframe ki
   zaroorat hi nahi → **koi ad, koi popup, koi redirect**.
2. Us JSON par CORS header nahi hota (`ACAO` khaali, probe se verify) → browser
   seedha call nahi kar sakta. Isliye ek **chhota same-origin function**
   (`api/netmirror.mjs`) usse poochta hai. **Video ka proxy nahi hai** — MP4
   `bcdnxw.hakunaymatata.com` se seedha user ke browser me jaata hai.

Yahi "cloudflare se seedha connect" ka matlab hai: JSON Cloudflare ke network se
hamare function tak, video Cloudflare ke CDN se seedha screen tak.

## App me wiring

| File | Kaam |
| --- | --- |
| `api/netmirror.mjs` | Vercel function: mirrors `net27.cc → net79.cc → net77.cc`, `probe=1`, 10-min cache, `not-added` par saaf jawab |
| `lib/netmirror.ts` | id parsing (IMDb reject), query builder, normalize (1080 pehle), 12-min client cache (`fresh: true` se skip) |
| `hooks/useNetmirrorAvailable.ts` | halka probe (URLs ke bina) — chip sirf tab jab title mile |
| `components/NetmirrorPlayer.tsx` | apna `<video>` (wahi ±10s/seek/progress player), na chale to **"Play on Nxsha"** |
| `lib/playbackServers.ts` | naya server `netmirror` — MovieBox se pehle; MovieBox na ho to `[Server 1 → NetMirror]` |
| `app/movie/[id].tsx` | cycle wiring + server switch pill |
| `components/MovieList/MovieDetailModal.tsx` | phone detail par **NetMirror** chip (`testID="server-netmirror"`) |
| `api/netmirror-subtitle.mjs` | subtitle bridge: proxy ke andar se CDN URL, SRT → VTT, host allowlist |
| `lib/subtitles.ts` | WebVTT parser + `cueAt` (player apne overlay me dikhata hai) |
| `api/moviebox-audio.mjs` | **dub list** — provider ke `dubs[]` se (har bhasha ka apna subject) |
| `lib/movieboxAudio.ts` | client: `fetchAudioLanguages`, shape/de-dupe |

## Subtitles (multi-language) — 24 Oct ka fix

Owner: *"subtitle kam nahi kar raha"*. Wajah probe se mili: `captions[].url`
hamare hi jaise proxy ka hota hai —

```
/api/proxy/video?url=https%3A%2F%2Fcacdn.hakunaymatata.com%2Fsubtitle%2F…srt%3FPolicy%3D…%26Signature%3D…
```

aur wo proxy route **429** (Cloudflare) deta hai — andar wali CDN file bilkul
theek khulti hai (200, 192 KB SRT). Isliye bridge ab:

1. `?url=` ke andar se **asli CDN URL** nikaalta hai (khula proxy nahi — host
   allowlist lagti hai),
2. file laa kar **SRT → VTT** karta hai,
3. app us VTT ko `lib/subtitles.ts` se parse karke **apne overlay** me dikhata
   hai (native `<track>` ka style control me nahi tha, aur cross-origin video
   par wo chup-chaap fail bhi hota tha).

Verify (runner, asli provider — run `40097181843`):

| Title | Bhasha | Result |
| --- | --- | --- |
| Mandaadi (`1465943`) | en | 200 `text/vtt`, **2424 cues** |
| Breaking Bad S1E1 (`1396`) | en / hi | 200 `text/vtt`, **587 cues** each |
| `evil.example/a.srt` | — | 400 `host allowed nahi` |

## Audio (dub) — har bhasha ka apna subject

Provider par dub alag file nahi, **alag subject** hota hai:

```json
"dubs": [
  { "subjectId": "2237794012843369344", "lanName": "Original Audio", "lanCode": "ta", "original": true },
  { "subjectId": "4151920426815471968", "lanName": "Hindi dub",      "lanCode": "hi", "original": false },
  { "subjectId": "5228019281622882336", "lanName": "Telugu dub",     "lanCode": "te", "original": false }
]
```

NetMirror ka jawab wahi `subjectId`/`detailPath` deta hai (wo bhi isi backend ka
front hai), isliye **NetMirror par chal rahe title ke liye bhi** dub list milti
hai:

1. `api/moviebox-audio` (30 min cache) → bhashaon ki list,
2. chunne par `resolveDirectStreams` us dub ke subject se naye streams laata
   hai (browser se seedha, **video ka proxy nahi**) aur wahi position se chalta
   hai,
3. jis title par provider streams nahi deta → `"‹language› audio nahi mila"`
   (jhootha switch nahi, list bhi nahi banti).

## Audio (dub) — Server 2 (MovieBox) par bhi

Owner (24 Oct, doosra round): *"kisi par bhi audio dusra nahi aa raha"*. Sach:
dub sirf NetMirror par juda tha, aur **NetMirror ka client cache purani key
(`v1`) me `subjectId` bina save tha** — isliye audio list kabhi maangi hi nahi
jaati thi.

Ab:

| Rasta | Kaise switch hota hai |
| --- | --- |
| NetMirror (apna `<video>`) | us dub ke subject se naye streams (client se seedha), wahi second |
| MovieBox · phone (`<video>`) | wahi tarika (`resolveDirectStreams`) |
| MovieBox · desktop (iframe) | us dub ka watch page khulta hai — MovieBox khud usi bhasha me chalata hai |

Cache key `netflix-netmirror-v3` hai, taaki purana cache apne aap mar jaye.

Owner (24 Oct, teesra round): *"multiaudio sirf MovieBox me aa raha hai,
NetMirror me nahi"*. Do wajah thi, dono theek ho gayi:

1. **Audio pill sirf MovieBox players me thi.** Jo bhi server
   `MovieboxDirectPlayer` chalata hai (NetMirror bhi) usme audio list sirf CC
   menu ke andar chhupi thi. Ab top bar me alag **audio pill** hai
   (`direct-audio-pill`) — 2+ audio hone par hi, aur usme `Audio` menu
   (`direct-audio-<lang>`).
2. **Cache me `subjectId` missing** → audio list maangi hi nahi jaati thi. Ab
   `subjectId` na ho to `fetchNetmirrorStreams(..., { fresh: true })` se ek
   fresh call hoti hai, aur audio list khaali aaye to ek retry (700 ms).
Provider apni **subtitle** bhashayein bhi `dubs[]` me bhejta hai (`Arabic sub`)
— wo hata di jaati hain (audio nahi hain), aur ek hi bhasha ek hi baar
(`Original` jeetta hai).

### NetMirror par audio switch (chautha round)

Owner: *"netmirror par bas option aata hai par koi audio milta hi nahi … sab me
likhta hai audio nahi mila"*.

Wajah: list `api/moviebox-audio` se aa jaati thi (har bhasha ka apna subject),
par bhasha chunne par streams **browser se seedha** maangi jaati thi
(`h5-api.aoneroom.com` / player-domain). Us raste par browser CORS/preflight par
atak jata hai. MovieBox par audio badalta dikhta tha kyunki wahan desktop par
iframe (watch page) chalta hai; NetMirror par sirf apna `<video>` hai.

Ab:

```
bhasha chuni
  → GET /api/moviebox-play?subjectId=…&detailPath=…&se=…&ep=…   (server, same-origin)
      1. POST {apig}/wefeed-mobile-bff/user-api/visitor-login  → guest token
      2. GET  {apig}/wefeed-mobile-bff/subject-api/play-info/v2?subjectId&se&ep
         (Android app headers + x-tr-signature: hmac-md5(timestamp|2|base64))
         → streams/streamList/hls/dash, ya signCookie ke andar chhupa
           `urlprefix=<base64>` CDN path + index.mpd / index.m3u8
      3. fail ho to purana h5 rasta: /home token → get-domain → {player}/subject/play
      → { ok:true, streams:[{url, quality, kind}], via:'play-info-v2'|'h5' }
  → fail ho to purana browser rasta (lib/movieboxDirect)
  → dono fail → "‹language› audio nahi mila" (jhootha switch nahi)
```

Kyun h5 `subject/play` kaafi nahi tha: guest ko wo `streams: []`,
`hasResource:false` deta hai (India ke browser me bhi). Asli rasta app ka
visitor-login + `play-info/v2` hai.

- Video ke **bytes proxy nahi** hote — sirf chhota JSON (URLs), `api/netmirror`
  ki tarah. Playback CDN se seedha.
- Function `bom1` (Mumbai) me chalta hai: MovieBox play guest ko **US** se khaali
  deta hai (`hasResource:false`), India se stream deta hai.
- Debug: `/api/moviebox-play?…&probe=1` → `{ ok, count, via, region, trace }`
  (URLs ke bina; `region` batata hai function Mumbai me chala ya nahi).
- Test: `tests-arena/dub-streams.test.ts` (14) — server-first, client fallback,
  dono fail, `x-tr-signature`, `signCookie` decode, nested URL scan, handler
  `no-token`.

## Rules jo nahi badle

- NetMirror **kabhi default nahi** — MovieBox (Hindi) hi pehla server.
- Title NetMirror par na ho → chip dikhta hi nahi (**dead button nahi**).
- Stream chalte waqt fail ho jaye → error card + "Play on Nxsha" (atka hua player nahi).

## Probe / test

```bash
NODE_OPTIONS=--max-old-space-size=3072 ./node_modules/.bin/jest \
  --config jest.arena.config.js --runInBand \
  tests-arena/netmirror.test.tsx tests-arena/netmirror-chip.test.tsx \
  tests-arena/player-chrome.test.tsx tests-arena/player-audio.test.tsx
```

Runner result (24 Oct): Mandaadi → 3 streams (1080 pehle), Breaking Bad S1E1 → 4
streams, `1441228` → `not-added`, IMDb id → `bad-id`.
