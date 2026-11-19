# Build status — 19 Nov 2026

- UUIDv7 unit tests: PASS (3/3).
- JSX parser check (`src/App.jsx`, `src/main.jsx`): PASS.
- JavaScript syntax checks for Supabase/profile/UUID helpers: PASS.
- JSON syntax checks for `package.json` and PWA manifest: PASS.
- Vite production build: NOT RUN. `npm install` exceeded the available execution window while reaching the package registry; `node_modules` was not created.
- Browser E2E against a real user session: NOT RUN.

No `service_role` key or database password is present in this source package. `.env.example` contains only the Supabase project URL and public publishable key. Authenticated data is never cached by the service worker.
