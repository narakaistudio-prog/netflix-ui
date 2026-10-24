# Netflix phone screen: Like / Dislike + Comments (Crunchyroll ka hi system)

Owner (24 Oct):

1. "moviebox ke player ke liyea hi 10 s button lagaya agar button chalta hi nhi
   hai usme to konsa kaam ka hta de usse aur agar working bna sakta hai to bna"
2. "crunchyroll mae jaise comment like ye sab ka system hai netflix ke phone ke
   liyea bhi ye kardo"

---

## 1. ±10s button hataya — kyun

Button **kabhi chal hi nahi sakta tha**, aur wajah hamare code me nahi thi:

| Probe (GitHub runner se) | Nateeja |
| --- | --- |
| `OPTIONS /subject/play` (preflight) | 200 — saare headers allowed |
| `GET /subject/play` (guest token) | **streams 0 · hasResource false** |
| Chaar hosts (`mzfi.me`, `m2box.org`, `moviebox.ph`, `h5-api`) | sab par 0 |
| Mandaadi / Avatar / Wednesday / Inception / Stranger Things | sab par 0 |
| CDN (`macdn.aoneroom.com`) | 206, no ACAO — chalega *agar* URL mile |

Matlab Server 2 ka video hamesha MovieBox ki **site ke cross-origin iframe** me
chalta hai, aur browser same-origin policy ki wajah se us iframe ke andar
`currentTime` chhune hi nahi deta. Proxy mana hai (Task 19 me video tuta tha),
isliye "working" banane ka koi bacha hua rasta nahi tha.

Ab:

- `MovieDetailModal` se wo do gol button, unke styles, aur `NEED_OWN_PLAYER`
  toast — sab hata diye.
- `MovieboxDirectPlayer` ka **invisible double-tap** (baayein −10s / daayein
  +10s) bana hua hai. Jis din MovieBox streams degi, wahi sach me ±10s karega —
  us waqt koi naya kaam nahi karna padega.
- Poora saboot `docs/m2box-direct-player.md` me hai (probe table).

## 2. Like / Dislike + Comments (naya)

Files:

| File | Kaam |
| --- | --- |
| `lib/titleSocial.ts` | Supabase RPC wrapper (wahi functions jo Crunchyroll page chalata hai) |
| `components/TitleComments.tsx` | phone ka UI: like/dislike pills + "Comment" pill + bottom sheet |
| `components/MovieList/MovieDetailModal.tsx` | section phone screen par laga hua (SEE MORE EPISODES ke neeche) |

### Data — Crunchyroll ke saath **shared**

Koi nayi table nahi bani (aur nahi banani chahiye — do system rakhna hi galat
hota). Wahi tables/RPC:

| Cheez | RPC |
| --- | --- |
| Title/episode like-dislike counts | `cr_reaction_counts` |
| Like/dislike dabana (toggle) | `cr_toggle_reaction` |
| Comment list (roots + replies) | `cr_list_comments` |
| Comment badge | `cr_comment_count` |
| Comment post / reply | `cr_add_comment` |
| Comment par like/dislike | `cr_vote_comment` |
| Apna comment delete | `DELETE /rest/v1/cr_comments?id=eq.…` (RLS: `user_id = auth.uid()`) |

Schema + RLS `supabase/migrations/20261023120000_crunchyroll_comments.sql` aur
`…_reactions.sql` me hai — likhna sirf `SECURITY DEFINER` functions se hota hai,
isliye browser se `user_id`/`author_name` forge karke comment daalna possible
nahi. Guest sab padh sakta hai, likhne par sign-in (`lib/account.ts`, wahi
session Crunchyroll ke saath shared).

### Scope (kaunsa thread)

`scopeFor(movie, season, episode)`:

- Movie → `season 1, episode 1`
- Series → chalu episode (`S2E6`), isliye **har episode ka apna thread + apne
  like** — bilkul Crunchyroll jaisa.
- `show_key` = `movie.id` (catalog ka stable id).

### UI (phone)

```
[ 👍 12 ]  [ 👎 1 ]  [ 💬 Comment 5 ]      ← title details ke neeche
```

- Tap par bottom sheet: Top/Newest tabs, comment list (replies indent),
  per-comment 👍/👎/Reply/Delete (sirf apne par), composer.
- Guest ko composer ki jagah **"Sign in to comment"** CTA — app ka apna
  `SignInDialog` khulta hai (Netflix red).
- Rang: Netflix laal `#E50914`, kaala panel — Crunchyroll ka orange yahan nahi.
- Offline / Supabase down: counts purane rehte hain, sheet "could not load"
  dikhata hai — screen kabhi crash nahi karti.

## 3. Tests

`tests-arena/netflix-comments.test.tsx` (11):

- `scopeFor` movie/tv + clamp, server row → screen shape, `timeAgo`/initials/errors.
- RPC calls: URL, method, `apikey`, `Authorization`, aur poore params
  (`cr_list_comments`, `cr_add_comment`, `cr_reaction_counts`,
  `cr_toggle_reaction`, `cr_vote_comment`).
- Component: pills render, guest ka like → sign-in, sheet khulti hai, guest ko
  composer nahi CTA milta.
- Source guard: detail screen par `<TitleComments>` laga hua hai, aur dead ±10s
  buttons gaye.

`tests-arena/moviebox-direct.test.tsx` ka button-test bhi update: buttons ka
**na hona** ab assert hota hai.
