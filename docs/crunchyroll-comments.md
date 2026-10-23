# Crunchyroll comments (Supabase)

Owner: “player ke neeche image 1 jaisa comment ka button, click par image 2 jaisa
drawer, saara comment Supabase me save ho, aur jo website me sign in karega
sirf wahi comment kar sake.”

## Kahan kya hai

| Hissa | File |
| --- | --- |
| Button + drawer + sign-in modal + saara JS | `assets/crunchyroll/crunchyroll.html` |
| Tables, RLS, RPC functions | `supabase/migrations/20261023120000_crunchyroll_comments.sql` |
| Tests (jsdom + fake Supabase) | `tests-arena/crunchyroll-comments.test.ts` |

## Supabase project

Comment feature ke liye alag Supabase project bana hai (pehle account me koi
project nahi tha):

- project ref: `wavzzkbemvujvgdaczqq`
- URL: `https://wavzzkbemvujvgdaczqq.supabase.co`
- region: `ap-south-1` (Mumbai), plan: free
- Auth: email + password, **Confirm email = off** (`mailer_autoconfirm`), taaki
  signup ke turant baad session mil jaye (free plan me mail delivery limited
  hai).

Page me sirf **anon/publishable key** rakhi hai. Wo public hona normal hai —
asli security RLS + RPC se aati hai. `service_role` key kabhi page me na daalein.

## Data model

`cr_comments` — ek row = ek comment.

| column | matlab |
| --- | --- |
| `show_key` / `season` / `episode` | kis title ke kis episode ka comment (movie = season 1, episode 1) |
| `parent_id` | reply hone par parent comment ka id, warna null |
| `user_id` | `auth.users(id)` |
| `author_name` | signup ke `display_name` se (trigger ki jagah function me bharta hai) |
| `body` | 1–1200 characters |

`cr_comment_votes` — `(comment_id, user_id)` primary key, `value` = `1` (like)
ya `-1` (dislike). Ek user ka ek hi vote; wahi button dobara dabane par vote
hat jata hai.

## Kaun kya kar sakta hai

| Kaam | Guest | Signed-in |
| --- | --- | --- |
| comments padhna (`cr_list_comments`, `cr_comment_count`) | ✅ | ✅ |
| comment likhna (`cr_add_comment`) | ❌ | ✅ |
| like/dislike (`cr_vote_comment`) | ❌ | ✅ |
| apna comment delete (`DELETE /rest/v1/cr_comments`) | ❌ | ✅ (RLS: `user_id = auth.uid()`) |

Kyun RPC: tables par **koi insert policy nahi** hai, isliye browser se seedha
`insert` fail hota hai. Likhna sirf `SECURITY DEFINER` functions se hota hai jo
`auth.uid()` khud padhte hain — matlab koi client apna `user_id` ya
`author_name` forge nahi kar sakta. `anon` role se write-functions ka `EXECUTE`
explicitly revoke kiya gaya hai (Supabase naye functions par by default de
deta hai).

## Frontend flow

1. Player khulta hai → `syncPlayerHeading()` wrapper `cr_comment_count` bulata
   hai aur `Comment` pill par count laga deta hai.
2. Pill dabane par `#commentsDrawer` slide hota hai. Guest ko list dikhti hai,
   composer ki jagah “Sign in to comment” CTA.
3. Sign in / Create account → Supabase GoTrue (`/auth/v1/token`,
   `/auth/v1/signup`). Session `localStorage` me (`cr_comment_session_v1`),
   access token expire hone par refresh token se ek retry.
4. Post → `cr_add_comment` → list + count refresh. Reply `p_parent` ke saath.
5. Episode badla → panel dobara load (comments episode-wise hain, mix nahi
   hote).

## Keys badalni ho to

`assets/crunchyroll/crunchyroll.html` me `var CR_SB={url:'…',key:'…'}` — bas
wahi do value update karni hain. Test bhi check karta hai ki key `anon` role ki
hai aur page me `service_role` kahin na ho.
