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
- 🎬 Separate Netflix-style Movies and TV Shows shelves
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
│   │   ├── movies.tsx        # Movies shelves
│   │   └── tv.tsx            # TV Shows shelves
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

## Deploy on Vercel (web)

This is an Expo Router app, not a Next.js app. Import the repository with the
**Other** framework preset and the repository root as the Root Directory.
`vercel.json` sets the build command to `npm run build:web`, the output directory
to `dist`, clean URLs for static pages, and rewrites for movie/shelf deep links.
Do **not** deploy the Expo development server (`npm run web`).

The build copies the locally bundled poster images into `dist/assets/posters`;
Expo's static export alone does not include the URL-based poster files. To test
locally, run `npm run build:web` and check that these exported files exist:
`dist/index.html`, `dist/movie/[id].html`, and
`dist/assets/posters/catalog/billboard-jawan.jpg`.

After deployment, check `/`, `/browse/movies`, a movie URL such as
`/movie/jw-catalog-movie-vishwanath-and-sons`, and a local poster URL such as
`/assets/posters/catalog/billboard-jawan.jpg`. No API key is required for the
bundled catalog. Video playback runs in third-party iframe providers (Nxsha or
NHD), so availability of a particular stream cannot be guaranteed by Vercel.

## Smart TV remote mode (Samsung Tizen / LG webOS / Android TV)

The web build is still a website, not a native TV app. Its spatial-navigation
engine (`lib/spatialNavigation.ts`) handles the remote **when the TV browser
forwards keyboard or pointer events to the page**:

- **Arrow-key browsers:** Down on hero Play/More Info focuses a poster in the
  first shelf and scrolls the *inner page ScrollView* (the body does not scroll).
  Up from that shelf returns to the actual Play button, not the hero artwork.
  Left/Right moves through posters; OK/Enter selects; Return/Escape goes back.
- **Pointer-only browsers:** when the D-pad moves the TV's cursor instead of
  sending Arrow keys, a small directional movement *within* Play, blank hero
  art, or a focused poster also steps the focus ring and scrolls to the next
  shelf. Pointing directly at a different card selects it; OK activates the
  ring even if the OS cursor has not yet left the hero. The screen-edge scroll
  assist is still available.
- **Fast shelves:** only the destination row is measured on each D-pad step.
  Deferred shelves mount on demand rather than hydrating the whole catalog;
  a pending step waits for its poster to exist, and a virtualized carousel can
  bring the next unmounted card into its render window without jumping rows.
  The focused row settles around 32% from the top with direct, non-animated
  scrollTop/scrollLeft assignments.
- **Manual settings:** navbar TV Mode and the `?` guide offer *Auto detect ·
  Pointer arrow · Arrow keys*. Choices are stored locally; the guide reports
  the last input seen (`keys`, `pointer`, or `Waiting for remote input`).

**Test on the TV:** reload the *new build*, focus Play, press Down, then press
Down again, Up, and Right/OK on a poster. In a pointer-only browser, move the
cursor a little downward while it is over Play or a poster instead. If the
status stays `Waiting for remote input`, the browser is not forwarding those
presses/moves; TV Mode alone cannot intercept hardware events the TV firmware
never gives a web page. The OS-drawn mouse arrow may remain visible despite
CSS cursor hiding. In that case note the TV model, browser, and guide status;
if your TV has a pointer/Link Browsing toggle, arrow-key mode may feel closer
to a native app. Do not evaluate a development-server preview for performance:
use `npm run build:web` and serve the exported `dist` build.

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

## Live Netflix India catalog (public discovery, optional OMDb enrichment)

The bundled catalog is refreshed automatically by the
`refresh-catalog.yml` GitHub Action:

- **Daily** it first crawls the public IsItInMyCountry title sitemap and keeps
  titles whose page lists India availability. It pulls the title poster,
  description, year, type, rating, runtime, seasons and episode total, then
  commits the result to `data/movies.json`. **No discovery API key or sign-up.**
- The Home screen keeps a separate current **Top 10 Movies** and **Top 10 TV
  Shows** presentation pair above the broad catalog. Those small daily rows
  are supplemented from JustWatch's India Netflix provider page; the broad
  availability source remains IsItInMyCountry.
- A full refresh also merges JustWatch's current paginated Netflix India
  popularity catalog (new releases, Korean series, anime and current movies)
  into dedicated current rows, while retaining the older IsItInMyCountry
  availability catalog. A JustWatch failure never replaces the broad source.
- Each refresh adds a curated official-Netflix supplement from Netflix's India
  `/in/title/<id>` pages plus Netflix genre/editorial shelves: **Netflix
  Originals & Series**, **Netflix Korean Originals**, **Netflix Anime &
  Animation**, **Netflix Original Movies**, and **Netflix Documentaries**.
  These are real title records with bundled posters, Netflix IDs and episode
  lists where available—not empty editorial labels. This keeps older
  Netflix-owned titles together with current availability instead of treating
  a popularity page as the full Netflix catalogue. OMDb remains the
  server-side fallback for posters, IMDb IDs, plots and episode metadata.
- Manual workflow modes include `refresh-current` (current shelves plus the
  official Netflix supplement), `enrich-existing` (fill provider IDs without a
  full crawl), and `refresh-top10` (refresh only the Hero/Top 10 rows).
- If the broad public source is unavailable, it safely falls back to
  FlixPatrol's daily *TOP 10 on Netflix in India* rather than erasing the
  previous catalog.
- Poster images downloaded from the refresh source are shipped inside the app
  bundle; broader catalogue entries retain their public Netflix artwork URL.
- You can also trigger it any time from the repository's
  **Actions → Refresh Netflix India catalog → Run workflow**.
- Once this branch is merged into `main`, the daily schedule activates
  automatically.
- If FlixPatrol is temporarily unavailable or changes its HTML, the job exits
  successfully without replacing the last known-good catalog. A partial chart
  also carries forward whichever chart is missing.

### Optional extras
- **OMDb (metadata enrichment)**: put the key in the GitHub Actions repository
  secret `OMDB_API_KEY` (or local `.env` for a refresh run). The workflow uses
  it to enrich discovered titles with IMDb id, plot, cast, IMDb rating,
  certification, runtime, seasons, episode counts and episode names. The key
  is never bundled into the client app.

### Coverage note
The public availability index is broader than a Top 10 chart, but it is not an
official Netflix API and can lag licensing changes or omit a title. India
availability is filtered from the source's country rows; OMDb enriches those
records but does not determine availability. The refresh keeps a safe fallback
instead of claiming an unverifiable official 100% catalogue.
