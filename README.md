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

## Live Netflix India catalog (public discovery, optional OMDb enrichment)

The bundled catalog is refreshed automatically by the
`refresh-catalog.yml` GitHub Action:

- **Daily** it first crawls the public IsItInMyCountry title sitemap and keeps
  titles whose page lists India availability. It pulls the title poster,
  description, year, type, rating, runtime, seasons and episode total, then
  commits the result to `data/movies.json`. **No discovery API key or sign-up.**
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
