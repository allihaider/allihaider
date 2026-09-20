# Ali Fitness Log

Minimal Progressive Web App for workout logging and meal tracking with photo-based macro estimation.

## Live URL

**https://allihaider.github.io/allihaider/fitness/**

## Features

### Three Tabs

1. **Workout** — Mon Push / Wed Pull / Fri Legs+posture plans with editable sets (kg + reps/seconds)
2. **Food** — Meal logging with photo capture, automatic macro estimation (optional), and daily history
3. **Me** — Personal profile, goals, schedule, and API key settings

### Photo-Based Macro Estimation

- Take or upload a meal photo
- Optional: Add an OpenAI or Google Gemini API key in the Me tab
- Tap "Estimate macros from photo" to auto-fill calories, protein, carbs, and fat
- All macros are editable before saving
- Photos are stored locally in IndexedDB

### Data Storage

- All data stays on your device (localStorage + IndexedDB)
- No login, no ads, no server
- API key stored only on device, never sent anywhere except to the AI provider

## Install on iPhone (Safari)

1. Open **https://allihaider.github.io/allihaider/fitness/** in Safari
2. Tap **Share** → **Add to Home Screen**
3. Confirm the name and tap **Add**

## Tech Stack

- Vanilla HTML/CSS/JS (no build step)
- Dark mobile-first UI with iOS safe-area insets
- Service Worker for offline caching
- IndexedDB for photo storage

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell with three tabs |
| `app.js` | Core logic, IndexedDB, API integration |
| `styles.css` | Dark theme, responsive layout |
| `sw.js` | Service worker for offline use |
| `manifest.webmanifest` | PWA manifest |
| `icon-*.png`, `icon.svg` | App icons |

## Privacy

Everything is local to the device. The only external requests are:
- When you tap "Estimate macros" with an API key configured, the photo is sent to OpenAI or Gemini for analysis
- No analytics, no tracking, no third-party scripts

Clearing Safari data / site data will erase all logs and photos.
