# Server 2 — M2Box (MovieBox) cropped player

> TL;DR: MovieBox embed nahi deta. Uska **poora watch page** iframe me kholo,
> aur dabbe ko aise kaato ki screen par sirf **player** bache — site ka header,
> sidebar aur "Resources" (episode grid) panel sab bahar.
> Desktop par iframe ek **fixed 1536px stage** par render karta hai aur stage
> `transform: scale()` se screen ke hisaab se chhoti/badi hoti hai — isliye
> kaat har screen par ek hi jagah padta hai.

## Kahan kya hai

| File | Kaam |
| --- | --- |
| `lib/moviebox.ts` | Pure helpers: link parse, canonical watch-page URL, crop ka naap-tol (`getMovieboxCrop`), sandbox/allow tokens, proxy URL. |
| `lib/movieboxLinks.ts` | Per-title link yaad rakhna (localStorage) — MovieBox ka per-ID embed nahi hota, isliye ek link chahiye. |
| `components/MovieboxCroppedFrame.tsx` | Teen dabbe + iframe + crop (web par imperative DOM). Native par browser fallback. |
| `components/MovieboxPagePlayer.tsx` | "Server 2" player: X, server switch, link badalna, loading, proxy hint. |
| `components/MovieboxLinkPanel.tsx` | Link paste karne wala panel (validation + proxy toggle + saved links). |
| `app/moviebox.tsx` | `/moviebox` page — kisi bhi m2box link ko seedha cropped frame me kholta hai (`?url=<link>`). Admin me iska button hai. |
| `api/moviebox-frame.mjs` | Fallback proxy: page ka HTML hamare origin se, frame-block headers utre hue (jis din M2Box framing rok de). |
| `scripts/preview-server.mjs` | Local preview: `dist/` + `api/*.mjs` ek hi port par. |

## Crop kaise kaam karta hai

```
host (naapne wali jagah — PAKKI height)
 └── box   (dikhne wala dabba, overflow:hidden)
       └── stage (fixed 1536px chaudi, scale hoti hai)
             └── iframe (upar −117, baayein −120 dhakela hua)
```

Naap (asli screenshots par pixel-naap, 20 Oct 2026 — Demon Slayer, 26 eps):

| Constant | Value | Matlab |
| --- | --- | --- |
| `MOVIEBOX_STAGE_WIDTH` | 1536 | Site ka layout isi chaudai par waisa rehta hai jaisa asli site par (episode guide 5-column chhota). |
| `MOVIEBOX_STAGE_CROP_TOP` | 117 | Header + menu kaat (player page-y 120 se shuru hota hai). |
| `MOVIEBOX_STAGE_CROP_LEFT` | 120 | Baayein ka kaat (iframe ke andar player 129 se shuru hota hai). |
| `MOVIEBOX_STAGE_PLAYER_WIDTH` | 968 | **Sirf player**: x 120 → 1088. Video stage-x 128.6 → 1088.6 (960 wide) hai aur "Resources" panel bilkul wahin (1088.6) se shuru hota hai — isliye panel kabhi andar nahi aata. |
| `MOVIEBOX_STAGE_PLAYER_HEIGHT` | 545 | Window y 117 → 662: video y 121 → 661 (540 tall, 16:9) + uske apne controls. Title/rating patti 663 se shuru hoti hai — bahar. 968 × 545 = 16:9. |
| `MOVIEBOX_STAGE_VISIBLE_HEIGHT` | 545 | **Poora page** mode (sirf search frame): y 117 → 662. |

Desktop scale = `min(chaudai / visibleWidth, unchai / visibleHeight)` — yaani
`contain`: jo dabba chhota pad jaye usme bhi player ka koi hissa (control bar,
fullscreen button) nahi katta. Phir `dikhne wali chaudai × scale` hi dabbe ki
chaudai banti hai.

Mode ka faisla `MovieboxCroppedFrame` ke `mode` prop se hota hai:
`player` (default — watch page, panel bahar) aur `page` (search results frame).

**Chhoti window (mobile / PC par window chhoti):** player mode me **koi
special case nahi** — har chaudai par wahi 1536px stage + wahi crop, bas poora
stage `scale` ho kar dabbe me fit ho jata hai. (Pehle 900px se neeche site ka
apna mobile layout chal jata tha, jisme player ke neeche Refresh/Download/Prev/
Next, title, description aur bottom nav — poora page — dikhta tha.)

Sirf **search/page mode** hi 900px se neeche site ke asli mobile layout par
jaata hai (scale 1, upar ka kaat 112/108/104, unchai = player + 16 + 320) —
wahan results/episode grid padhne ke liye scroll khula rehta hai.

## Series: episode badalna ("Next Episode")

Resources panel crop se bahar hai, isliye episode aage badhane ka apna raasta
hai — player ke neeche-daayein **Next Episode** ka pill (agar series ho aur
agla episode bacha ho):

- Button **video ke dabbe ke andar** hota hai, bottom-right (site ke apne Next
  Episode ki jagah) — `getMovieboxCrop` se dabbe ka rect nikaal kar overlay
  usi par align hota hai, root ke kinare par nahi (warna black gutter me chala
  jata tha).
- Visibility site ke controls jaisi: yahan milne wali **har activity** par
  overlays dikhte hain aur timer reset hota hai (pointer ka player par
  aana/ghoomna, click, scroll, key, pointer ka frame me jaana, frame par
  click/focus). **3.2s tak kuch na ho to gayab** — chahe pointer khamoshi se
  video par hi khada ho.
  (Iframe cross-origin hai isliye video ke andar lagatar mouse ghumane ka
  event humein nahi milta; us halat me overlays 3.2s baad chhup jate hain aur
  pointer ke bahar-nikal-kar-andar-aane ya click par turant wapas.)
- `MovieboxPagePlayer` khud hi agla episode khol deta hai (`episode + 1`,
  wahi `detailSe`/`detailEp` watch page — iframe dobara mount hota hai).
- Parent ko `onEpisodeChange({ season, episode })` se batata hai, taaki
  Continue Watching / row ka state sahi rahe.
- `episodeCount` (us season ke episodes) se pata chalta hai ki agla episode
  hai ya nahi — aakhri episode par button dikhta hi nahi. Movie par bhi nahi.
- Search-results frame me bhi nahi (wahan title hi nahi mila tha).

## Fullscreen

Site ka fullscreen button **band** hai (iframe ke `allow` me `fullscreen` nahi,
`allowfullscreen` attribute bhi nahi). Wajah: wo iframe ko fullscreen karta
tha, aur us waqt browser sirf iframe dikhata hai — crop toot jata tha aur poora
MovieBox page (header, Resources panel, title, Download/Share bar) dikhne lagta
tha.

Fullscreen ab hum dete hain:

- **Fullscreen button video ke andar hai**, theek site ke apne fullscreen icon
  ke **upar** — ek **kaale plate** (#000, ink ka 1.4x, halke rounded kone) par.
  Plate unka icon dhak leti hai, aur plate ke beech me hamara safed
  `MaterialCommunityIcons` `fullscreen` (chaaron kone wale brackets) unke icon
  se **~11% bada** hai. Isse do fullscreen kabhi saath nahi dikhte. Chrome
  (mouse rukne par) chhupte waqt **plate + icon dono** fade hote hain — warna
  video ke corner me sirf kaala dabba chipka reh jata (owner ne yahi pakda).
  Naap (owner ke 4.14x zoom crop se): ink 3.4% unchai, plate ka daaya kinara
  2.14% chaudai aur neeche se 2.06% unchai par. `testID="moviebox-fullscreen"`
  poore player dabbe (iframe + overlays) ko fullscreen karta hai. Top bar me
  sirf X + server pill (link icon aur neeche wala badge hata diye).
- **Chrome chhupne par iframe pointer-events `none` ho jate hain**, isliye
  cross-origin iframe ke bawajood mouse ka har movement hamare dabbe tak aata
  hai — mouse hilte hi fullscreen button (aur Next Episode + patti) wapas dikh
  jate hain, aur chup-chaap 3.2s baad gayab. Pause karne ke liye pehla click
  sirf chrome wapas laata hai (YouTube jaisa), doosra click player tak jata hai.
- Fullscreen me bhi crop chalta rehta hai — host (player dabba) ka naap hi
  screen ka naap ban jata hai, `getMovieboxCrop` wahi player-only dabba nikalta
  hai, aur overlays (Next Episode, episode patti) usi dabbe par align rehte
  hain. `fullscreenchange` par sirf dobara naapa jata hai.
- Esc se bahar.

## Jab phir bhi link na mile — live resolve

Baked map ~87% catalog cover karta hai. Baaki titles (naya release, ya MovieBox
par search me na aane wala naam) ke liye ab **paste karne ki zaroorat nahi**:

```
GET /api/moviebox-resolve?title=Vishwanath%20%26%20Sons&year=2026&type=movie
→ { found: true, url, subjectId, detailPath, title, dub, score, tier }
```

Server wahi search ladder + matching chalata hai jo harvester chalata hai
(`scripts/lib/moviebox-api.mjs` + `scripts/lib/moviebox-match.mjs` — dono ek hi
code hain, isliye app aur roz ka bake kabhi alag behave nahi karte).

Client (`lib/movieboxResolve.ts`, `MovieboxPagePlayer`):

1. row link → 2. baked catalog → 3. browser me saved → 4. **live resolve**
   (sirf tab jab teeno na hon) → 5. tabhi paste panel.

- Milne par link `netflix-moviebox-live-v1` me 7 din ke liye yaad rehta hai
  (`saveMovieboxLink` se sync resolver ko bhi de diya jata hai, isliye reload ke
  baad network call nahi).
- Na mile to 6 ghante tak dobara nahi poochha jata; panel tab ek note ke saath
  khulta hai.
- Ek IP se 30 resolve/minute; jawab `s-maxage=86400` ke saath cache hota hai.

### Jab MovieBox par title hi na ho

Live resolve bhi kuch na de (MovieBox par wo title abhi nahi hai — e.g. naya
release), to paste maangne ke bajaye frame me **MovieBox ke apne search
results** khul jate hain:

```
https://m2box.org/en/web/searchResult?keyword=<title>
```

Route MovieBox ke apne Nuxt router se liya gaya hai (`/en/web/searchResult`).
Us frame me andar scroll khula rehta hai (crop ke baad bhi results dekh sakein),
aur neeche do buttons hote hain — **Dobara dhoondho** (live resolve retry) aur
**Link paste karo** (manual panel, sirf jab user khud chaahe).

### Search ladder

MovieBox ka search poore title par kamzor padta hai — "Vishwanath & Sons" par
"SONS OF ROYALTY" lauta deta hai, lekin "Vishwanath" par sahi subject mil jata
hai. Isliye ladder: poora naam → naam + saal → naam Hindi → brackets hata kar →
`&` ↔ and → subtitle se pehle ka hissa → **sabse distinctive shabd**.

## Har title par pehle se link (auto-harvest)

Owner ki demand: Netflix ke **saare content** par M2Box apne aap second server
bane — koi link paste na karna pade. Isliye link khojna ab repo ka kaam hai:

```bash
node scripts/harvest-moviebox-links.mjs            # sirf naye/miss hue titles
node scripts/harvest-moviebox-links.mjs --refresh   # poora catalog dobara
node scripts/harvest-moviebox-links.mjs --limit 25  # test run
node scripts/harvest-moviebox-links.mjs --check     # offline validation
node scripts/harvest-moviebox-links.mjs --relabel   # offline: purane dub labels slug se theek
node scripts/harvest-moviebox-links.mjs --probe "Mandaadi"   # raw API debug
```

Kya karta hai (MovieBox ki apni site ka flow):

1. guest JWT — `GET /home?host=moviebox.ph` ke `x-user` header se (fallback:
   `POST /subject/search-suggest` + `X-Client-Token: <sec>,<md5(reverse(sec))>`).
2. `POST /subject/search {keyword, page, perPage:0, subjectType:0}` — pehle
   seedha naam, phir `<naam> Hindi`, phir `<naam> <saal>`.
3. Matching (`scripts/lib/moviebox-match.mjs`, pure + tested): title
   (accents/case/`&`/brackets/season markers normalise), type (movie vs TV —
   mismatch par bada penalty), year (film par strict, TV par season-pack window),
   Hindi-dub hint bonus, `hasResource:false` par penalty, aur **junk clip
   penalty** (`[SUB] … EP24`, teaser/trailer/“meet” wale YouTube-style results
   kabhi bake nahi hote). Ek-shabd titles ("Jawan", "Sultan") par extra shabd
   wala result reject hota hai — warna "Jawani Janeman" jaisi galti bake ho jati.
4. `GET /detail` se confirm. `dubs[]` me Hindi audio ho to:
   - us dub ka **apna** `subjectId`/`detailPath` ho → wahi page bake hota hai
     (`dub: "hindi"`),
   - warna wahi subject rehta hai (jahan page ke andar dub badalta hai) aur
     `hindiAudio: true` note ho jata hai — label jhooth nahi bolta, `dub` slug
     se aata hai (`hindi`, `english`, `tamil`, … ya `original`).

Output:

| File | Kaam |
| --- | --- |
| `data/moviebox-links.json` | `{ "tmdb:<id>": { url, subjectId, detailPath, title, year, type, dub, hindiAudio, score, harvestedAt } }` — app isi ko bundle karta hai (`lib/movieboxCatalog.ts`). |
| `data/moviebox-pins.json` | Owner-verified overrides — inhe harvester kabhi nahi chhoo sakta. |
| `data/moviebox-harvest-report.json` | `stats` + `review` (60–72% wale shakki matches) + `misses` + `errors`. App ise nahi padhta. |

CI: `.github/workflows/moviebox-links.yml` — daily + manual. Harvester chalata
hai, `--check` se validate karta hai, phir changed files commit karta hai
(`moviebox-bot`). Sab kuch fail ho jaye to purana baked JSON hi chalta rehta
hai (app kabhi khali links par nahi jata).

### Pin (owner-verified link)

Kabhi matching kisi title par galat page chun le, ya owner ko pata ho ki kaunsa
page sahi hai, to `data/moviebox-pins.json` me daal do:

```json
{ "links": { "tmdb:1465943": { "url": "https://m2box.org/movies/mandaadi-hindi-qxUx1r3QHW4?id=…&type=/movie/detail&detailSe=&detailEp=&lang=en" } } }
```

Pin hamesha jeetta hai — harvester na use search se replace karta hai, na
refresh se, aur us title ke liye network call bhi nahi karta. Offline merge:
`node scripts/harvest-moviebox-links.mjs --pins`.

**Miss ka reason dekhna**: `data/moviebox-harvest-report.json` me har miss ke
saath `candidates` (top 3, kis query se aaye) hote hain — usse pata chalta hai
kya MovieBox par title hai hi nahi, ya naam alag hai.

**Tuning**: `MATCH_ACCEPT` (default 0.72) se neeche kuch bake nahi hota;
0.60–0.72 `review` list me jata hai. Koi title galat match lage to `--refresh`
ke saath `MATCH_ACCEPT` thoda badha do, ya us title ka sahi link row ke
`embed_url` me daal do (row hamesha catalog se jeetta hai).

## Server 2 sirf tab, jab link sach me ho

Owner ka rule: **jis title ka MovieBox link nahi, us par Nxsha hi default
rahega aur server badalne ka option dikhega hi nahi.**

Title khulte hi (`hooks/useMovieboxAvailable.ts`):

1. row / baked catalog / browser-saved link hai → turant pata, `available: true`;
2. warna background me live resolve (`/api/moviebox-resolve`).

`lib/playbackServers.ts` ka `buildServerCycle()` usi par cycle banata hai:

| MovieBox | Server cycle | Pill |
| --- | --- | --- |
| mila | default (Nxsha) → NHD → custom → M2Box | dikhta hai |
| nahi mila | **sirf Nxsha** | dikhta hi nahi (cycle length 1) |

Settings me default provider `moviebox` ho par link na ho to bhi Nxsha par gir
jata hai. Pehle har title par "M2Box" ka option aata tha, aur jab MovieBox par
wo title hi nahi hota tha to us par jaate hi paste/search screen khulti thi —
ab aisa nahi hota.

## Link kahan se aata hai

MovieBox ke har title/dub ka apna canonical watch-page URL hota hai:

```
https://m2box.org/movies/<slug>?id=<subjectId>&type=/movie/detail&detailSe=<s>&detailEp=<e>&lang=en
```

`lib/moviebox.ts` kisi bhi mirror/SPA link se slug + subjectId nikaal kar
canonical m2box.org page bana deta hai. Season/episode player ki state jeetti
hai (series ke episode badalne par page wahi episode kholta hai).

Teen tarah se link aa sakta hai:

1. **Baked catalog** — harvester ne us title ka link `data/moviebox-links.json`
   me bake kar diya hai (poora Netflix catalog). Kuch paste nahi karna padta;
   Server 1 hi default rehta hai, pill se Server 2 chala lo.
2. **Title row me** — `embed_url` ya `videoUrl` me poora m2box link. Is halat
   me M2Box hi **pehla** server hota hai (Nxsha cycle me rehta hai).
3. **Ek baar paste** — jo title catalog me nahi mila (naya/obscure), uske liye
   panel link maangta hai aur usi browser me yaad rakhta hai
   (`netflix-moviebox-links-v1`).
4. **`/moviebox` page** — kisi bhi link ko turant kholne ke liye (`?url=` bhi).

Priority: **row → baked catalog → browser me saved**. Isliye owner kabhi bhi
kisi title ka link manually override kar sakta hai.

## UI

- Player ke upar hamara koi bada UI nahi: top-left **X** (Esc bhi), uske bagal
  **server switch pill**, aur (frame chalne ke baad) link badalne ka chhota
  button.
- Frame 15s tak kuch na dikhaye to neeche ek hint aata hai: **"Proxy se kholo"**
  — wahi page `/api/moviebox-frame` se load hota hai.

## Safety

```html
sandbox="allow-downloads allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"
allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
referrerpolicy="no-referrer-when-downgrade"
```

- **`allow-top-navigation` kabhi nahi** — warna site/ads hamari poori tab
  hijack kar sakti hain.
- `allow-scripts` + `allow-same-origin` zaroori hain, warna player/episode list
  chalegi hi nahi.
- Server-side proxy sirf MovieBox hosts (aur player-jaisi shakal wale rotated
  domains) ke liye khulta hai — open proxy nahi.

## Fullscreen ke usool

1. Crop tabhi hatao jab **iframe khud** fullscreen ho (top-level
   `document.fullscreenElement` wahi iframe ho). App khud `documentElement` ko
   fullscreen karti hai — us waqt crop chalta rahega, bas naye size se dobara
   naapa jayega. Warna fullscreen me poora m2box page (title, menu) dikhne lagta.
2. `scrolling="no"` desktop par hamesha (fullscreen me bhi) — warna user scroll
   karke kata hua hissa wapas dekh leta hai.
3. Fullscreen se lautne par dobara naapo: turant + `requestAnimationFrame` +
   80ms + 250ms. Purana size chipka to dabba lamba ho jata hai aur title
   jhaankne lagta hai.

## Galtiyan jo mat dohrana

1. **Host ki height auto/min-height** — crop apni hi unchai naap kar "cap" lagane
   lagta hai; controls kat jate hain. Host ko pakki height do (full-screen layer).
2. **Chaudai ke hisaab se seedha crop (proportional)** — har screen par kaat
   alag padta hai. Fixed stage + scale hi pakka rasta hai.
3. **Stage 1280** — kam episodes par theek, 26+ par panel player se lamba ho
   kar controls bahar dhakel deta hai. 1536 rakho.
4. **Browser tab se naapna** — tab me sidebar khuli hoti hai (player 245 se),
   iframe me band (129 se). Naap hamesha iframe ke andar ke screenshot se.
5. **Desktop par andar scroll khula** — user kata hua menu/title dekh leta hai.
6. **Panel ko CSS se chhupane ki koshish** — frame cross-origin hai (m2box.org),
   uske DOM tak pahunch nahi hai; isliye panel sirf crop se hi bahar rehta hai
   (`MOVIEBOX_STAGE_PLAYER_WIDTH`).

## Site layout badle to dobara naapna

1. Purane numbers se frame chalao, apni site par khule player ka screenshot lo
   (browser tab me khuli m2box.org ka **nahi**).
2. Screenshot me player/panel ka top, left, bottom aur title ki pehli line
   dhoondo.
3. Frame me **do** cheezein naapo: player ka daaya kinara aur "Resources"
   panel ka baaya kinara (panel ka background `#28292E` jaisa flat grey hota
   hai — rang badalne wali jagah hi kinara hai).
4. `stagePx = screenshotPx × (visibleWidth / screenshot me frame ki chaudai)`
   (`visibleWidth` = 1064 player mode / 1416 page mode).
5. Scale seedha naapo: `scale = frameChaudaiPx / visibleWidth` (poora page mode
   me `1416`). Phir har kinara stage units me: `stageX = CROP_LEFT + (xPx −
   frameLeftPx) / scale`, `stageY = CROP_TOP + (yPx − frameTopPx) / scale`.
6. Naye constants: `CROP_TOP = videoTop − 4`, `CROP_LEFT = videoLeft − 9`,
   `PLAYER_WIDTH = panelLeft − CROP_LEFT` (panel aur video ke beech saans nahi
   hota — thoda sa video ka daaya kinara kaatna padta hai), aur
   `PLAYER_HEIGHT = (videoBottom + 1) − CROP_TOP`.
7. Teen titles par test karo — movie, chhoti series, aur 26+ episode wali series
   (panel sabse pehle wahi chaudi karta hai).

## Hadein

- **Episode chunna:** player mode me "Resources" panel jaan-boojh kar bahar hai
  (screen par sirf player). Episode change app ke apne episode selector se hota
  hai (URL me `detailSe`/`detailEp`), ya `/moviebox` page se poora page khol lo.
- **Framing kabhi bhi band ho sakti hai:** jis din M2Box `X-Frame-Options`/CSP
  laga dega, seedha frame blank hoga — tab proxy (`/api/moviebox-frame`) ya
  naya tab bacha hua rasta hai.
- **Quality/subtitles/episode** sab site ke haath me hai — crop sirf dikhne wala
  hissa kaatta hai, andar poori site waisi hi chalti hai.
- **Continue Watching** M2Box par position track nahi karta (cross-origin frame
  kuch nahi batata) — position sirf Nxsha/NHD wale server par save hoti hai.

## Test

```bash
npx jest --config jest.arena.config.js tests-arena/moviebox
npx jest --config jest.arena.config.js tests-arena/api-moviebox-frame.test.ts
```

- `moviebox-crop.test.ts` — link parse, canonical URL, crop math (desktop,
  mobile, cap, 900px boundary).
- `moviebox-server.test.tsx` — jsdom me asli iframe: 1536px stage, offsets,
  scale, sandbox tokens, `scrolling="no"`, link paste → saved → next visit,
  Esc/X, proxy mode.
- `api-moviebox-frame.test.ts` — proxy: frame guards utre, `<base>` inject,
  rotated domain allowed, open proxy band.
- `moviebox-match.test.ts` — matcher fixtures (normalise/dub hint, title
  similarity, type+year penalties, ranking, Hindi dub pick).
- `moviebox-catalog.test.ts` — baked JSON padhna + link priority
  (row → catalog → saved) + "baked link M2Box ko pehla server nahi banata".
- **Server lagate hi kaala parda (3.2s)**: watch page khulte hi M2Box ka
  *shell* dikhta hai (header, "Join Telegram", footer) — player uske baad mount
  hota hai, isliye wo ~2s crop ke andar jhalak jata tha. `FRAME_COVER_MS`
  (3200ms) tak `#000` parda + spinner rehta hai, phir seedha player. Search
  page mode me parda nahi (wahan page hi dikhna hai).

## Server chunna (Hindi / Multi)

- Detail screen par, description ke neeche aur "Episodes" ke upar, do chip:
  **Hindi** = MovieBox (M2Box crop player), **Multi** = Nxsha (embed).
  Default **MovieBox** hai (`server` state `'moviebox'` se shuru hota hai).
  MovieBox link na ho to ye option dikhta hi nahi — Nxsha hi chalta hai.
- Play dabne par jo server us waqt chal raha hai wahi chipak jata hai, taaki
  MovieBox ki availability baad me resolve hone par video ke beech player na
  badle.
- **Player ke andar server switch nahi** — `MovieboxPagePlayer` ko
  `onSwitchServer` aur `EmbedPlayer` ko `onSwitchProvider` nahi diya jata; X se
  band karke detail screen se server badla ja sakta hai. (Standalone
  `/movie/[id]` page par Nxsha ka pill video chalu hone se pehle tak dikhta hai,
  `rolling` hone par gayab.)
- Frame ka loading parda ab sirf **"Loading…"** likhta hai.
