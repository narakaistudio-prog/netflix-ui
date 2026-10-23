# Netflix account (red sign-in) + Crunchyroll comment box

Owner (comment panel ke screenshot ke saath):

> “bhaii comment box mae ye kyu likha hai supabase mae hoga ye sab hta bas sign in
> to comment rehne de aur uska color orange white kar crunchyroll ki traha sign ka
> bhi waisa color karoo aur ab netflix mae admin panel hta do aur fake sara
> profile hta do netflix mae bhi red ka sign wala exact jo crunchyroll mae system
> hai wo kardo”

## 1. Comment box (Crunchyroll page)

- Guest box me pehle teen cheezein thi: `Sign in to comment`, “Comments are saved
  in Supabase. Reading is free for everyone…” aur ek **violet** Sign in button.
  Ab sirf heading + button — Supabase ka zikr user ko nahi dikhna chahiye (wo
  implementation detail hai, feature nahi).
- Rang Crunchyroll ka: heading `#f47521` (orange), button orange background +
  dark text (`#160e08`) — Crunchyroll ke primary buttons jaisa.
- Poora comment drawer bhi violet se orange par aa gaya (pill, drawer border,
  header icon, avatar, input focus, Post button, reply border, spinner, auth
  modal). Violet Crunchyroll ka rang hi nahi hai, isliye ek hi accent rakha.
- Auth modal ka subtitle bhi badla: “Sign in to comment — your name shows next to
  what you post.” (Supabase nahi).

## 2. Netflix: fake profile gaya, asli account aaya

Pehle Netflix app ka user system **pura fake** tha:

| Pehle | Ab |
| --- | --- |
| `data/users.json` ke profiles (Saúl / Primeagen / Theo / Kids) | File delete — koi fake profile nahi |
| App start par “Who is watching?” gate (`components/WhoIsWatching.tsx`) | Guest seedha browse karta hai; sign in optional |
| `/switch-profile` modal + profile switcher | Delete |
| `/admin` screen + navbar/profile menu ka “Admin Panel” | Delete (route bhi) |
| Profile page: example liked posters, example My List, “New Arrival · The Perfect Couple” | Hata diya; page sirf asli account dikhata hai |
| Navbar ka avatar fake profile badge | Signed out = **red `Sign In`**; signed in = red initial + email dropdown |

Profile page ab: signed out par “You are browsing as a guest” + red **Sign In**;
signed in par naam + email + **Sign out of Netflix**. Downloads aur Crunchyroll
ke shortcuts bache hue hain (dono asli pages hain).

## 3. Sign-in system — Crunchyroll wala hi, Netflix red

`lib/account.ts` (naya):

- Wahi Supabase project + anon key jo Crunchyroll page inline use karta hai.
- Wahi endpoints: `/auth/v1/token?grant_type=password`,
  `/auth/v1/signup`, `/auth/v1/token?grant_type=refresh_token`, `/auth/v1/logout`.
- Wahi localStorage key: **`cr_comment_session_v1`**. Matlab ek hi site par ek hi
  account — Netflix me sign in karne se Crunchyroll comments bhi signed-in ho
  jate hain, aur sign out dono jagah lagta hai. Disk par shape bhi Crunchyroll
  wala (`user.display_name`) hai, isliye dono readers ek doosre ka session
  samajhte hain.
- Session hamesha storage se padha jata hai (module cache nahi) — doosre tab me
  sign-in/out turant dikhta hai (`storage` event bhi sunte hain).
- Token expire hone par `ensureFreshSession()` refresh karta hai; refresh fail =
  session clear (dobara sign in).

`components/SignInDialog.tsx` (naya): Netflix red modal (`#E50914`, upar 3px red
border), email + password, “Sign up now” se create-account (display name bhi),
local validation + Supabase errors ka seedha English message. Root layout
(`app/_layout.tsx`) me ek hi jagah render hota hai, isliye navbar aur profile page
dono se khulta hai.

## Test

`tests-arena/netflix-account.test.tsx` (8):

- signed out par red `Sign In`, koi fake profile naam nahi, koi Admin entry nahi;
- Sign In → dialog → token endpoint hit → session shared key me (`access_token`,
  `user.display_name`);
- sign out session clear;
- expired token → refresh call → naya token save;
- admin screen / switch-profile / WhoIsWatching / `data/users.json` file-level par
  gaye;
- navbar + profile page me admin ka koi reference nahi, fake content nahi;
- Crunchyroll guest box: Supabase line gayi, heading + button orange, purana
  violet accent (`#8b5cf6`, `#6d4bff`, `#a78bfa`, `#7c5cff`) kahin nahi.
