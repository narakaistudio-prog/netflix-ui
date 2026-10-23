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

---

# Follow-up #2 (owner ke 3 aur points)

> “continue watching bahut bada hai isse chota karoo sala ye player ke jitna bada
> hai … normal jaisa”, “my list ka fake data htaoo”, “crunchyroll ka
> notification netflix mae nhi aana chiyea”.

## Continue Watching ka size

Pehle `.continue-card` par `flex:1 1 0; min-width:220px` tha — matlab card
**barabar hisse le kar stretch** karta tha. Ek hi resume item hone par wo poori
row (~1200px) bharta tha, yaani player jitna bada. Ab:

```css
.continue-card{flex:0 0 calc(20% - 13px); width:calc(20% - 13px); min-width:0}
```

- Ek row me 5 card (gap 16px × 4 nikal kar); 6th item agli row me chala jata
  hai (normal grid jaisa) — koi bhi card stretch nahi karta.
- Mobile (≤700px) par ek card poori row (100%) — purana
  `.continue-main img{height:110px}` leftover bhi hata diya.
- Poster/overlay/copy thoda chhota: play button 44px, title 13.5px, meta 11px.

## My List ka fake data

Pehle sab kuch hardcoded tha:

```js
favorites = {solo:true, jjk:true, demon:true};
listSets = {continue:['solo','jjk'], favorites:[…3], watchlater:[…4], history:[…12]};
```

- **Favorites**: ab khaali `{}` se shuru, sirf detail page ka heart bharta hai.
- **Watch later**: sirf save button (`detailSave`) se.
- **Continue**: seedha `resumeStore()` (jo player sach me likhta hai) — sub-line
  `S1 · E3 · 12:48` asli progress hai, “Continue episode” nahi.
- **History** tab hata diya: uska koi real store hi nahi tha (sirf 12 fake
  titles), isliye dikha kar jhoot nahi bolte.
- Tab ke counts har render par store se ginte hain; kuch na ho to empty
  message: “Nothing to continue yet…”, “No favorites yet…”, “Watch later is
  empty…”.
- Dono lists `localStorage['cr-list-v1']` me (`{saved:{}, favorites:{}}`), isliye
  reload par bhi rehti hain — section ka subtitle ab sach bolta hai:
  “Saved on this device”.
- My List ke continue card par tap = wahi episode resume (`data-resume-index`),
  detail dialog nahi.

## Netflix bell se Crunchyroll notifications

`lib/notifications.ts` se `notificationsFromCrunchyroll()` (ToonStream/Fresh Drop
bake) `NOTIFICATIONS` list se hata diya — Netflix ka bell ab sirf Netflix/Tudum
India Top 10 updates dikhata hai. Crunchyroll ke naye drops us page ke apne bell
me hain (`crunchyroll.html` ke `TS_DROPS` + `cr-notices-seen`), jahan unka
context sahi hai.

Tests: `tests-arena/crunchyroll-my-list.test.ts` (5) + `notifications.test.ts`
ka naya guard (bell me koi `ts-` item nahi).
