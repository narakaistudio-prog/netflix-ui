# ToonStream auto-next — episode khatam, agla khud

Owner request: **"episode khatam hone ke baad autonext nahi hota, usse autonext kardo
taki episode khatam hone ke baad khud dusra lag jaye."**

Yeh page `assets/crunchyroll/crunchyroll.html` ke player shell me lagta hai — ToonStream
trio (Play / Short / MultiQ) aur Nxsha, dono par.

## Kya hota hai

Episode khatam hone par 8 second ka countdown bar aata hai:

```
Next: S1 · E2 in 8s      [ Play now ]  [ ✕ ]
```

- kuch na karo → 8s baad agla episode khud load.
- `Play now` → turant agla.
- `✕` → rehne do, wahi episode (pause/rewind ke liye).

Aakhri episode par bar nahi aata, bas toast: `Last episode hai — agla episode nahi`.
Movie par: `Movie hai — agla episode nahi`.

## "Ended" kaise pata chalta hai (do raaste)

1. **postMessage (exact)** — player `ended / finished / complete` bheje to seedha
   `armAutoNext()`. Nxsha bhejta hai; kai ToonStream hosts bhi.
2. **time events** — jin hosts se `ended` nahi aata par `timeupdate` jaisa data aata
   hai, wahan `currentTime >= duration - 12s` hote hi countdown chalu.
3. **wall-clock fallback** — ToonStream hosts cross-origin iframes hain (ravok.buzz,
   abyssplayer, blakiteapi) aur ho sakta hai wo parent ko kuch bhi na bhejein. Isliye
   page apna clock (`WATCH`) chalata hai: episode ki runtime guide se (`guessDur`,
   default 24 min) leke aakhri 12s par countdown chalu. Clock pause/visibility/blur
   par rukta hai, `tsInject`/`injectServer` par zero se shuru.

Teen raaste ek hi jagah aate hain — `armAutoNext()`.

## Source wahi rehta hai

`reloadAfterEpisodeChange()`:

- ToonStream mode (`TS_MODE`) → `playToonstream({server: tsActiveIndex})` — yaani
  **wahi slot** (S1 / S2 / S3) jispar user tha, sirf episode naya. Pehle `stepEp()`
  seedha `loadServer()` karta tha jo chupchap Nxsha par le jata tha — wo bug bhi isi
  fix me gaya.
- Nxsha → `loadServer()`.

ToonStream fetch pehle se chal raha ho (`TS.loading`) to reload 500ms ke gap se retry
karta hai, warna request drop ho jati.

## Continue Watching

`goNextEpisode()` episode ko khatam maan ke `flushPlayhead(true)` karta hai, isliye
wahi episode 99% par Continue Watching me nahi pada rehta.

## Tests

`tests-arena/toonstream-autonext.test.ts` (real page, JSDOM):

- plumbing (bar, countdown, clock fallback, same-slot reload),
- `ended` → countdown → S1E2 khud load,
- sirf `timeupdate` (bina `ended`) → last 12s par countdown → S1E2,
- `✕` cancel → episode nahi badalta,
- movie → koi autonext nahi.

Countdown tests me chhota karne ke liye `window.AUTONEXT_SECONDS` set kar sakte hain.
