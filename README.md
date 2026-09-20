# Netflix UI Clone with Expo

A high-fidelity Netflix mobile UI clone built with React Native and Expo, featuring advanced animations and gesture interactions.

![Demo](assets/gifs/demo.gif)

## Key Features

### Profile Management

- 👥 Animated profile selection screen with staggered loading
- 🔄 Smooth profile switching transitions
- 🎵 Sound effects and haptic feedback

### Navigation & Animations

- 🔄 Custom tab navigation with sliding animations
- 💫 Gesture-based content interactions
- 🌟 Shared element transitions between screens
- 📱 iOS-style modal presentations
- 🎨 Dynamic blur effects and scaling
- 🔄 Tilt animations for featured content

### Content Screens

- 🏠 Animated home screen with featured content
- 🔥 "New & Hot" section with Netflix-style layout
- 🎮 Mobile games showcase
- 🔍 Dynamic search with instant results
- ⬇️ Downloads management
- 📺 Teaser Video player
- 📋 Expandable categories list
- 🔤 Custom font

### Performance

- ⚡ Optimized animations using Reanimated
- 📊 Efficient list rendering [wip]
- 🎯 Native gesture handling
- 🔄 Smart transition management

## Tech Stack

- [Expo](https://expo.dev) - React Native development platform
- [Expo Router](https://docs.expo.dev/router/introduction) - File-based routing
- [React Native Reanimated](https://docs.swmansion.com/react-native-reanimated/) - Smooth animations
- [React Native Gesture Handler](https://docs.swmansion.com/react-native-gesture-handler/) - Native gestures
- [Expo Haptics](https://docs.expo.dev/versions/latest/sdk/haptics/) - Haptic feedback
- [Expo AV](https://docs.expo.dev/versions/latest/sdk/av/) - Audio/video playback

## Implementation Details

### Animation System

- Custom tab screen wrapper for consistent transitions
- Worklet-based animations for optimal performance
- Shared element transitions for content previews
- Gesture-based modal interactions

### State Management

- Context-based profile management
- Animation state coordination
- Tab navigation state handling

### UI Components

- Reusable animated components
- Custom Netflix-style icons and layouts

## Project Structure

```
project-root/
├── app/
│   ├── (tabs)/
│   │   ├── (profile)/        # Profile section
│   │   ├── index.tsx         # Home screen
│   │   └── new.tsx          # New & Hot screen
│   ├── movie/
│   ├── _layout.tsx          # Root layout
│   └── search.tsx           # Search functionality
├── components/
│   ├── MovieList/           # Movie listings
│   ├── GameList/            # Games section
│   ├── FeaturedContent/     # Featured content
│   ├── BottomSheet/         # Bottom sheets
│   ├── navigation/          # Navigation components
│   └── WhoIsWatching/       # Profile selection
├── hooks/
│   ├── useCachedResources.ts
│   ├── useColorScheme.ts
│   ├── useDeviceMotion.ts
│   └── useOverlayView.ts
├── data/
│   ├── movies.json          # Movie data
│   ├── new.json            # New content data
│   └── users.json          # User profiles
└── contexts/               # App-wide state management
```

## TODO

- [ ] Shared transition on modal navigation
- [ ] Bug: Disable shift animation on back (fixed on branch router-4 (React Navigation 7))
- [ ] X-Ray style content details
- [ ] Full screen video player
- [ ] Color extraction from images for dynamic theming

## Contributing

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## License

MIT License

## Live Netflix India catalog (always up to date, zero API keys)

The bundled catalog is refreshed automatically by the
`refresh-catalog.yml` GitHub Action:

- **Daily** it scrapes FlixPatrol's *TOP 10 on Netflix in India* (movies +
  TV shows, updated every day), pulls each title's poster/description and
  commits the result to `data/movies.json`. **No API key, no sign-up.**
- Poster images are downloaded into `assets/posters/` and shipped inside the
  app bundle (poster hosts block hotlinking, so bundling keeps every card
  crisp forever). The catalog references them via `local:<id>` URLs.
- You can also trigger it any time from the repository's
  **Actions → Refresh Netflix India catalog → Run workflow**.
- Once this branch is merged into `main`, the daily schedule activates
  automatically.

### Optional extras
- **TMDB (free key)**: if you ever create a key, put it in `.env` as
  `EXPO_PUBLIC_TMDB_API_KEY` (runtime freshness, Hindi metadata) or as the
  `TMDB_API_KEY` repository secret (the script then prefers TMDB).
  Everything works without it.

## Nxsha embeds — play any TV episode from a single IMDb ID

Add a series from one IMDb ID and every episode becomes playable through
third-party TV embed hosts, no API keys anywhere.

### How it works

- **Providers** (`services/embedProviders.ts`) — URL templates with
  `{id}` (IMDb ID), `{s}` (season), `{e}` (episode):
  - `Nxsha (Hindi)`: `https://nxsha.space/embed/tv/{id}/{s}/{e}?lang=hi&server=GbruHindi&one_server=true&disable_app_ad=true`
  - `NHD`: `https://nhdapi.com/tv/{id}/{s}/{e}`
  - **Custom template** — paste any host's embed URL (Nxsha domains change
    sometimes, e.g. `web.nxsha.app`). It is **rejected unless it contains
    all three placeholders** before the series is saved.
- **Admin flow** (`/admin`, "Add Series" button in the web nav bar):
  enter name + IMDb ID + seasons + episodes/season, pick a provider, save.
  Every episode's embed URL is generated by string-replacing the template
  (loop `s` × `e`) and stored **per episode** in `localStorage`.
- **Metadata, keyless**:
  - **AniList** (`services/anilist.ts`) — poster, banner, genres, year,
    description by name search (IMDb ID used to disambiguate), and the full
    season chain via `SEQUEL`/`PREQUEL` relations for multi-season series.
  - **Jikan** (`services/jikan.ts`) — episode titles + thumbnails per season
    (via the season's MAL id) for the episode grid.
  - Both are best-effort: if they fail the series is still saved with
    synthesized episodes (`Episode 1…N`).
- **Player** (`/watch/{id}?s=&e=`, `components/SeriesEmbedPlayer.tsx`):
  fullscreen `<iframe>` with the exact proven attribute set —
  `allow="accelerometer; autoplay; clipboard-write; encrypted-media;
  gyroscope; picture-in-picture; fullscreen"`, `allowFullScreen`,
  `referrerPolicy="no-referrer-when-downgrade"`, and **no `sandbox`
  attribute** (it breaks these players). A dismissable overlay hint covers
  the first-click popup ("Popup aaye to close karke video par dobara click
  karo"), and a **Switch player** button swaps Nxsha ↔ NHD for the same
  `{id}/{s}/{e}` as fallback.
- **Constraint honored**: the iframe is cross-origin — the app never reads
  playback state from it (no postMessage tracking). It just renders the URL.
- **UI flow**: series card (Home "My Series" row) → banner/season picker →
  episode grid with thumbnails → click → fullscreen iframe player.
