# Tevra frontend

## Authentication and dashboard

Copy `.env.example` to `.env` and set `VITE_SUPABASE_PUBLISHABLE_KEY` to this
project's public publishable key. The project URL is already in the example.
These Vite variables are visible in the browser; never put a service-role or
secret key here. Vite loads `.env` automatically, so browser source does not use
`dotenv` or `process.env`. Restart Vite after changing environment variables.

- `src/supabase.ts` owns the shared browser client and session persistence.
- `src/AuthGate.tsx` restores login, listens for auth changes, and shows the
  email/password login form for signed-out users.
- `src/api.ts` gets the current session and attaches its access token to the
  dashboard request. It validates the response and handles authentication,
  network, and server errors.
- `src/App.tsx` shows the signed-in account, sign-out, course/student counts,
  and class rows. Requests are cancelled when leaving the dashboard; signing
  out or switching accounts unmounts the previous account's data.

Supabase persists access and refresh tokens in browser storage and refreshes
the session. The password is only submitted to Supabase Auth and cleared from
form state afterward. Existing accounts sign in; registration is not added.

`VITE_DASHBOARD_URL` defaults to `http://localhost:5000/api/dashboard`. It is
separate from the existing `VITE_API_URL` because that variable includes `/api/v1`,
while the current dashboard route uses `/api/dashboard`.

Follow [BACKEND_SETUP.md](./BACKEND_SETUP.md) for the exact backend implementation
and response shape. Until that backend handler is added, the frontend displays
an error when it receives the old placeholder response instead of sample data.

## AI assistant

`src/api.ts` sends each prompt to `POST /submit` as `{ "text": "Your question" }`
and extracts the assistant's reply from `result.choices[0].message.content`.
The transcript stays visible in the UI, but the backend receives only the current
prompt. Set `VITE_AI_CHAT_URL` to the full submit URL for a deployed backend;
the default is `http://localhost:5000/submit`. If your existing `.env` points to
`/api/v1/ai/chat`, change it to `/submit` and restart Vite.

Run `npm test` for dashboard and AI request tests. They use mocked sessions and HTTP
responses and do not create accounts or write database data.
The integration test also starts the backend and a local mock AI provider;
install dependencies in both packages first. It needs no real API keys or AI credits.

## Tooling

This frontend uses React and Vite with TypeScript, HMR, and Oxlint. Components live in `.tsx` files; other TypeScript files use `.ts`.

Run `npm run dev` to develop, `npm run typecheck` to check types, `npm run lint` to lint, and `npm run build` to check types and create the production build. Vite transforms TypeScript; the build script runs the TypeScript compiler separately to catch type errors.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

Strict TypeScript checks are configured in `tsconfig.json`. Oxlint supplies lint rules; `npm run typecheck` supplies compiler type checks.
