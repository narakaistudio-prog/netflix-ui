# anidisk-extractor — `/api/extract` + `/api/stream`

> NOTE: Server 2 (player side) is currently removed — the player is single-server
> AnimaHD. This API stays ready; to reconnect, restore the extractor client block
> (commit `9c94ab1`) and open the player with `?extractor=<this-service>/api/extract`.

Tiny **zero-dependency** Node server that turns episode/embed pages (AniDisk and the
video hosts behind it — StreamWish, VidHide/VidMoly, Filemoon, Voe, …) into a direct
**m3u8/mp4** the demo player's own `<video>` element can play. No iframe, no host JS
on the page — popups are physically impossible, and "sandboxed embed" refusals can't
happen because nothing is embedded.

## API

- `GET /api/extract?url=<episode-or-embed-page-url>`
  → `{ ok, stream, kind ("hls"|"mp4"), host, page, embed, proxied }`
  or `{ ok:false, error }` (`no-player-found`, `no-stream-found`, `target-blocked`, …).
- `GET /api/stream?u=<b64u media URL>&r=<b64u referer>` — proxies bytes with a proper
  `Referer`/UA; m3u8 playlists are rewritten so segments + keys keep flowing through
  the proxy. Forwards `Range` (seeking works).
- `GET /healthz` → `{ ok:true }`.

How it works: fetch page → if it's an episode page, pick the known-host `<iframe>`
(StreamWish/VidHide/… first, else first iframe) → fetch embed with `Referer` →
unpack `p.a.c.k.e.r` JS → pick `file:`/`source:`/bare `.m3u8` (m3u8 preferred over mp4).

## Run locally

```bash
cd server
node extractor.mjs --self-test   # offline checks, no internet needed
node extractor.mjs --port 8787   # or PORT=8787 npm start
curl 'http://127.0.0.1:8787/api/extract?url=https://anidisk.org/watch/solo-leveling/1/1'
```

## Deploy free (Render, ~10 min)

1. Push this repo to GitHub (already done on your branch).
2. Render dashboard → **New → Blueprint** → select the repo.
   `server/render.yaml` in this folder wires everything (free plan, `/healthz` check).
   (No Blueprint? **New → Web Service** → root dir `server`, build `npm install`,
   start `npm start`, plan Free.)
3. Wait for deploy → copy the service URL, e.g. `https://anidisk-extractor.onrender.com`.
4. Open the demo player with your extractor once:
   `…/crunchyroll.html?extractor=https://anidisk-extractor.onrender.com/api/extract`
   The player remembers it (localStorage) — Server 2 (AniDisk ⚡) then plays in-app.

Env: `PORT` (default 8787), `ALLOW_ORIGIN` (default `*`; set your site origin to lock
the API to your player).

## Honest limits

- Tokens can be **IP-locked or short-lived**: the proxy re-spoofs Referer/UA, but it
  can't fix a link bound to another IP. If a stream 403s, re-extract (it's instant).
- Hosts **rotate domains and obfuscation**; when a pattern breaks, add it in
  `extract-lib.cjs` (`KNOWN_HOSTS`, `findStreamUrl`) — pure functions, covered by
  `tests-arena/extractor-server.test.ts`.
- Rate limits: 30 extract/min, 600 stream req/min per IP. Personal-use scale only.
- This fetches third-party pages server-side (same as Consumet-style APIs). Keep your
  deploy URL to yourself and respect the sources' terms.
