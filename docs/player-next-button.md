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

Jagah owner ke red-mark se: video ke bottom-right, control bar se kaafi
**upar** — `bottom: clamp(56px, 30%, 300px)` (phone `clamp(44px, 26%, 140px)`),
`right: 18px` (phone 10px). Percentage se har player size par wahi naap rehti
hai, px clamp chhote players par overlap rokta hai.

- White pill, kaala text + play icon (`border-radius: 6px` — MovieBox jaisa).
- Site ke apne control bar se **upar** (bottom 64px / phone 52px), taaki uske
  fullscreen/volume icons se na takraye.
- Sirf button clickable hai — baaki stage par click seedha iframe (video) ko
  jaata hai, player ke apne controls kabhi block nahi hote.

## Autohide — cursor chhupe to button bhi chhupe

`NEXT_IDLE_MS = 3200` — 3.2 second (site ke chrome jitna) kuch na ho to
fade-out. Dikhane ke signals:

- `mousemove` / `mousedown` / `touchstart` (capture, poori screen par),
- pointer iframe ke andar gaya → `mouseout` jiska `relatedTarget` null hai,
- `keydown`, `wheel`, `scroll`, window `focus`.

### Asli problem: iframe ke andar ka movement

Video cross-origin iframe hai — uske **andar** cursor ghumane par parent page ko
`mousemove` kabhi nahi milta. Isliye pehle do problem thi:

1. cursor video par rehne par button 3.2s me gayab ho jata tha aur wapas nahi
   aata tha ("screen par cursor hai phir bhi next nahi aaya"),
2. CSS `:hover` se hamesha dikhta tha, to jab player apna cursor/controls
   chhupa deta tha tab bhi button pada rehta tha.

Ab **idle-probe** hai: button chhupne ke baad stage par `stage-idle` class lagti
hai → `.video-stage.stage-idle iframe{pointer-events:none}`. Isse cursor jab
video par wapas aata hai, wahi pehli movement parent page ko mil jati hai →
probe turant hat jati hai (iframe dobara clickable) aur button dikh jata hai.
Bas 3.2s tak kuch na ho to button + probe dono idle rehte hain — bilkul site ke
cursor ki tarah.

Probe sirf mouse-wale devices par (`hover:hover and pointer:fine`) on hota hai;
phone par purana touch-activity wala behaviour.

## Kab dikhta hai

Sirf jab:

- **ToonStream mode** ho (`TS_MODE`) — Nxsha par ye button nahi hai
  (owner: "nxsha server par ye next lagana jaruri nahi"),
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

- button stage ke andar + naya mark (30%) + idle timing + probe rule,
- Nxsha par button nahi (activity ke baad bhi hidden),
- ToonStream par: dikhta hai → 3.2s idle par gayab + `stage-idle` → mousemove
  par wapas (probe off) → player se bahar nikalne par chhup jata hai,
- click par agla episode usi player me,
- movie par nahi,
- last episode (Chainsaw Man S1E12) par nahi.
