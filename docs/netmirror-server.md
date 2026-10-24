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
| `lib/netmirror.ts` | id parsing (IMDb reject), query builder, normalize (1080 pehle), 12-min client cache |
| `hooks/useNetmirrorAvailable.ts` | halka probe (URLs ke bina) — chip sirf tab jab title mile |
| `components/NetmirrorPlayer.tsx` | apna `<video>` (wahi ±10s/seek/progress player), na chale to **"Play on Nxsha"** |
| `lib/playbackServers.ts` | naya server `netmirror` — MovieBox se pehle; MovieBox na ho to `[Server 1 → NetMirror]` |
| `app/movie/[id].tsx` | cycle wiring + server switch pill |
| `components/MovieList/MovieDetailModal.tsx` | phone detail par **NetMirror** chip (`testID="server-netmirror"`) |

## Rules jo nahi badle

- NetMirror **kabhi default nahi** — MovieBox (Hindi) hi pehla server.
- Title NetMirror par na ho → chip dikhta hi nahi (**dead button nahi**).
- Stream chalte waqt fail ho jaye → error card + "Play on Nxsha" (atka hua player nahi).

## Probe / test

```bash
# asli upstream + asli handler (runner par, ya kisi bhi internet wale shell me)
node scripts/probe-netmirror-api.mjs
node scripts/probe-netmirror-handler.mjs

# unit tests
NODE_OPTIONS=--max-old-space-size=3072 ./node_modules/.bin/jest \
  --config jest.arena.config.js --runInBand \
  tests-arena/netmirror.test.tsx tests-arena/netmirror-chip.test.tsx
```

Runner result (24 Oct): Mandaadi → 3 streams (1080 pehle), Breaking Bad S1E1 → 4
streams, `1441228` → `not-added`, IMDb id → `bad-id`.
