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
│                        [ ▶ Next · E2 ]   │  ← control bar se upar,
└──────────────────────────────────────────┘     daayein kinare se 18px
```

Jagah owner ke red-mark se: video ke bottom-right, site ke control bar ke
**upar** — `bottom: clamp(56px, 15%, 150px)` (phone `clamp(44px, 14%, 96px)`),
`right: 18px` (phone 10px). Percentage se har player size par wahi naap rehti
hai, px clamp chhote players par overlap rokta hai.

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
- `keydown`, `wheel`, `scroll`, window `focus`,
- aur **CSS `:hover`** — `.video-stage:hover .next-float`. Ye zaroori hai:
  cursor jab video (iframe) ke **andar** hota hai to browser parent ko koi
  mousemove nahi deta, isliye pehle button 3.2s me gayab ho ke wapas nahi
  aata tha (owner ki screenshot: "screen par cursor hai phir bhi next nahi
  aaya"). Iframe stage ka child hai, isliye stage par `:hover` bana rehta
  hai — button cursor player par hone tak dikhta rehta hai.

Matlab: cursor player par aate hi button dikhta hai, hilne par bhi; player se
bahar nikalte hi 900ms me chhup jata hai (MovieBox ka leave-delay), aur
3.2s idle timer tab kaam aata hai jab cursor player ke bahar ho.

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

- button stage ke andar + jagah (control bar ke upar) + idle timing + listeners
  + `:hover` reveal rule + leave-hide,
- episode chalte hi dikhta hai → 3.2s idle par gayab → mousemove par wapas →
  player se bahar nikalne par chhup jata hai,
- click par agla episode usi player me,
- movie par nahi,
- last episode (Chainsaw Man S1E12) par nahi.
