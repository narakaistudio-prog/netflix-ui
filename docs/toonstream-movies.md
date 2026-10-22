# Movies ka ToonStream (Server 2) route

Owner: "jo movies jitna hai na humne unka toonstream server nhi lagya hai unka
laga do jisse movie ka na mile usse rehne dena."

## Kya problem thi

- Player ke do server hain: **Server 1 = Nxsha**, **Server 2 = ToonStream**.
  Series ke liye Server 2 pehle se kaam karta tha (`/episode/<slug>-<s>x<e>`),
  par movies ka ToonStream page **alag URL shape** par hota hai:
  `https://toonstream.us/movies/<slug>` — season/episode nahi hota.
  Isliye movie par ToonStream button dabane se `s=1&e=1` wali series query
  jati thi aur kuch nahi milta tha.

## Ab kaise kaam karta hai

```
page  --- /api/toonstream?type=movie&title=<naam>&slug=<baked> --->  api
api   --- https://toonstream.us/movies/<slug>                    --->  ToonStream
api   --- {ok, movieUrl, servers:[{name,url}], chosen}           --->  page
```

1. `scripts/harvest-toonstream-movies.mjs` catalog ki har movie
   (`shows[key].type === 'Movie'`) ke liye slug verify karta hai:
   - pehle baked/state slug, phir site ke slug rule se bane 3 variant,
   - phir `/s?q=<title>` search ke `/movies/<slug>` links,
   - har candidate page par **title match** (wanted se 2 word se zyada lamba
     naam reject) aur **player slot** (`id="options-N"`) hona zaroori hai.
2. Jo movie mil jati hai uska slug page me bake hota hai:
   `var TS_MOVIES={ kiki:{slug:'kikis-delivery-service'}, … }`.
3. Play par `playToonstream()` movie ke liye `type=movie&title=…&slug=…` bhejta
   hai; embed na mile to `/movies/<slug>` page naye tab me khulta hai.
4. Jo movie ToonStream par nahi hai uske liye **kuch nahi** likha jata —
   button dabane par saaf toast aata hai, khaali player nahi.

## Dhayan rakhne wali baatein

- `&type=movies` search ke saath **query ignore ho jati hai** (site har title
  par wahi generic list — Shrek, Toy Story — lautati hai). Isliye plain
  `/s?q=` use hota hai.
- Galat slug par site **500** deti hai, 404 nahi — isliye status 200 hi
  "page mila" mana jata hai.
- Movies ka ek bhi server na mile to slug bake nahi hota (owner ka
  "rehne dena"), aur har run par saari movies dobara verify hoti hain taaki
  purana galat match state me na chipka rahe.
