# Crunchyroll player actions (like / share) + notification + Continue Watching

Task 14 — owner ke chaar points, ek hi page par:

1. “like bhi save hona chahiye”
2. “share ka button real karo, sahi se work kare”
3. “G7 wala fake profile hta do”
4. “notification ke item check karne ke baad waha number nahi dikhna chahiye”
5. “image 3 me jaise Continue Watching ka design hai waisa kardo, fake timing mat dikhana”

Sab kuch `assets/crunchyroll/crunchyroll.html` me hai; DB ka hissa
`supabase/migrations/20261023160000_crunchyroll_reactions.sql` me.

## Like / Dislike (ab save hota hai)

Pehle `watchReaction` sirf page ke memory me tha — reload par gayab, aur count
hamesha nakli “1”. Ab:

| Kaam | RPC |
| --- | --- |
| counts + apna vote padhna | `cr_reaction_counts(show_key, season, episode)` |
| like/dislike toggle | `cr_toggle_reaction(show_key, season, episode, value)` |

- Table `cr_episode_reactions` ka primary key `(show_key, season, episode, user_id)`
  hai, isliye ek user ka ek hi reaction per episode.
- Wahi button dobara dabane par reaction hat jata hai; doosra button dabane par
  palat jata hai.
- Counts sabko dikhte hain (guest bhi), par **likhne ke liye sign-in zaroori** —
  guest ka click sign-in modal kholta hai aur kuch save nahi hota.
- Direct table write band hai (koi insert policy nahi); `anon` se
  `cr_toggle_reaction` ka EXECUTE revoke hai. Insert sirf `SECURITY DEFINER`
  function se hota hai jo `auth.uid()` khud padhta hai.

## Share (asli link)

Purana bug: `location.href` copy hota tha — iframe ke andar wo
`/assets/crunchyroll/crunchyroll.html` hai, jo khologe to sirf HTML milega,
episode nahi.

Ab link banta hai app ka:

```
<origin>/crunchyroll?show=<key>&s=<season>&e=<episode>
```

- Web par `origin` parent window ka hota hai (yaani jis domain par app khula hai).
- Native WebView me origin `null` hota hai, isliye production URL
  (`https://net-ki15.vercel.app/crunchyroll`) par fallback.
- Share flow: `navigator.share` (mobile) → warna clipboard → warna legacy
  `execCommand('copy')`. Success par toast “Link copy ho gaya — <title>”.
- Wahi link kholne par `crApplyDeepLink()` page load par `?show=&s=&e=` padhta
  hai aur seedha wahi episode chalata hai.

## Notification badge

- `TS_DROPS[].firstSeen` ISO date string hai (`2026-10-23`) — string compare hota
  hai, `Number()` me badalne par sab `NaN` ho jata tha.
- Panel kholte hi `markNoticesSeen()` latest `firstSeen` ko
  `localStorage['cr-notices-seen']` me likh deta hai aur badge chhupa deta hai.
- Iske baad sirf **us date se naye** drops par badge aata hai; reload par bhi
  purane items dobara “new” nahi dikhte.
- Sabhi naye drops ek hi din ke ho to badge `9+` par cap hota hai.

## Continue Watching (image 3 design)

Card ab poster-first hai:

```
┌───────────────────────────┐
│        [ ▶ play ]         │  ← 16:9 thumb + play overlay
│ ███████░░░░░░░░░░░░░░░░░░ │  ← neeche progress bar (orange)
├───────────────────────────┤
│ Attack on Titan           │
│ S1 · E3 · “Episode name”  12:48 / 24:00 │
└───────────────────────────┘
```

- Meta line: `S<season> · E<episode> · “<episode title>”`.
- **Fake timing nahi:** clock sirf tab dikhta hai jab player ne asli
  `currentTime` + `duration` diye hon (`sec >= 10` aur `dur > sec`). Purane
  “12 min left”, “just now”, “in” jaise andaze hata diye.
- Progress bar bhi sirf real `sec/dur` par.
- Dismiss (×) hover/focus par dikhta hai; card click par wahi episode resume hota
  hai (purana `pendingResumeSec` flow).

## G7 fake profile

Header ka fake “G7” avatar aur poora **Guest profile** section (Guest #A7F2,
“18h 42m watch time”, “46 episodes done”…) hata diya gaya — ye sab hardcoded
tha. Account entry point ab sirf asli `Sign in` / account button hai
(`#authButton`), jo Supabase session dikhata hai.

## Tests

`tests-arena/crunchyroll-watch-actions.test.ts` — like save + guest gate, share
deep link, deep link boot, notification badge, G7 removal, Continue Watching
card & no-fake-timing, aur reaction SQL ka RLS check.
`tests-arena/crunchyroll-resume.test.ts` — naye card markup ke hisaab se update.
