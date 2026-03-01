# my-app — Expo Router Project

## Overview

A React Native / Expo Router application that runs on web (via Metro bundler), iOS, and Android. This project uses Expo Router for file-based routing and expo-sqlite for local database support.

## Project Structure

- `src/app/` — Expo Router file-based routes (tabs layout)
  - `(tabs)/index.tsx` — Home tab
  - `(tabs)/explore.tsx` — Explore tab
  - `_layout.tsx` — Root layout with navigation theme
  - `modal.tsx` — Modal screen
- `src/components/` — Shared UI components
- `src/constants/` — Theme and other constants
- `src/hooks/` — Custom React hooks
- `src/assets/` — Images and icons
- `src/backend.ts` — Bun static file server (for production preview)
- `src/@shared/` — Shared utilities (static file server, SQL client, patch-db)

## Tech Stack

- **Framework:** Expo / Expo Router ~6.0 with React Native 0.81
- **Runtime:** Node.js 20 + Bun 1.2 (for backend/scripts)
- **Language:** TypeScript
- **Package manager:** npm (node_modules installed)
- **Web bundler:** Metro (via Expo)

## Development

The app runs as a web app via Metro bundler on port 5000.

**Workflow:** `EXPO_NO_TELEMETRY=1 npx expo start --web --port 5000`

### Replit-specific Notes

- The CORS middleware in `node_modules/expo/node_modules/@expo/cli/build/src/start/server/middleware/CorsMiddleware.js` has been patched to allow all hosts (required for Replit's proxy/iframe preview). The `_isLocalHostname` function always returns `true`.
- After `npm install`, re-apply the patch if the middleware file gets overwritten.

## Deployment

Configured as a **static** deployment:
- **Build:** `npx expo export -p web` (outputs to `dist/`)
- **Serve:** Static files from `dist/`

The `src/backend.ts` Bun server can also serve the static export for self-hosted deployments.

## Scripts

- `npm run start` — Start Expo dev server
- `npm run web` — Start Expo web
- `npm run export:web` — Export static web build to `dist/`
- `npm run backend` — Run Bun static file server (serves `dist/`)
- `npm run lint` — ESLint
- `npm run tc` — TypeScript type check
