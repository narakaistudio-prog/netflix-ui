# Player ke andar "Next episode" button (autohide)

Owner: **"player ke andar next ka button laga do bas sahi jagah par… cursor move
hoga to button dikhega, kuch nahi hoga to hide rahega — jaisa MovieBox me laga
hai."**

Auto-next (countdown bar) hata diya gaya — wo ToonStream ke cross-origin players
ke saath bharosemand nahi tha. Uski jagah **manual Next button** hai, exactly
MovieBox jaisa.

## Kahan lagta hai

`assets/crunchyroll/crunchyroll.html` → player shell → `#videoStage` ke **andar**,
video ke **bottom-right** me (MovieBox me bhi wahin hai):

```
┌──────────────────────────────────────────┐
│                                          │
│            ( Nxsha / ToonStream )        │
│                                          │
│                        [ ▶ Next · E2 ]   │  ← 64px upar, 16px daayein
└──────────────────────────────────────────┘
```

- White pill, kaala text + play icon (`border-radius: 6px` — MovieBox jaisa).
- Site ke apne control bar se **upar** (bottom 64px / phone 52px), taaki uske
  fullscreen/volume icons se na takraye.
- Sirf button clickable hai — baaki stage par click seedha iframe (video) ko
  jaata hai, player ke apne controls kabhi block nahi hote.

## Autohide (MovieBox ka wahi pattern)

`NEXT_IDLE_MS = 3200` — 3.2 second tak kuch na ho to fade-out. Dikhane wale
signals:

- `mousemove` / `mousedown` / `touchstart` (capture, poori screen par),
- pointer iframe ke andar gaya → `mouseout` jiska `relatedTarget` null hai
  (cross-origin iframe me ghusne par parent ko sirf yahi signal milta hai),
- `keydown`, `wheel`, `scroll`, window `focus`.

Matlab: cursor hilao → button aa jata hai; haath hatao → 3.2s me gayab.
Agar pointer video (iframe) ke andar lagatar ghum raha hai to browser humein
mousemove nahi deta — us haalat me bhi 3.2s baad button chhup jata hai, aur
pointer ek baar bahar-nikal ke wapas aaye (ya click ho) to turant dikh jata
hai. Yahi limitation MovieBox me bhi hai.

## Kab dikhta hai

Sirf jab:

- player khula ho aur episode chalu ho (`stageInjected`),
- agla episode maujood ho (`neighborEpisode(1)`) — **last episode** par nahi,
- title **movie** na ho (movie ka next episode nahi hota).

Episode chalte hi ek baar apne aap dikhta hai (pata chale ki feature hai), phir
idle par chhup jata hai.

## Click karne par

`goNextEpisode()`:

1. current episode "watched" mark (Continue Watching se hata) — warna 99% par
   pada rehta hai,
2. `playState` ka next episode,
3. `reloadAfterEpisodeChange()`:
   - ToonStream me the → **wahi slot (S1/S2/S3)** par agla episode
     (`playToonstream({server: tsActiveIndex})`),
   - Nxsha me the → Nxsha (`loadServer`).

Label bhi update hota hai: `Next · E2` → `Next · E3`.

## Tests

`tests-arena/player-next-button.test.ts` (real page, JSDOM):

- button stage ke andar + idle timing + listeners,
- episode chalte hi dikhta hai → 3.2s idle par gayab → mousemove par wapas,
- click par agla episode usi player me,
- movie par nahi,
- last episode (Chainsaw Man S1E12) par nahi.
