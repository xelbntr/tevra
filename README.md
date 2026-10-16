# Learnly

Learnly is an academic management web application with a Vite and React frontend and a separate Express backend running on Node.js. Both packages use TypeScript with strict type checking.

## Project structure

- `backend/` — Express API; `src/server.ts` defines routes, `src/auth.ts` verifies sessions, `src/reports/` builds student reports, and `src/coach.ts` connects the AI coach to Groq.
- `frontend/` — Vite React application; components use `.tsx` and other source files use `.ts`.
- `frontend/.env.example` — frontend environment variable template. Copy it to `frontend/.env` and fill in local values when needed. Create `backend/.env` for backend settings.

## Install dependencies

Install each package separately from its own folder:

```sh
cd backend
npm install
```

```sh
cd frontend
npm install
```

Use Node.js 22.12+ or a newer supported release. Install development dependencies in both packages for local development and builds.

## Development

Run `npm run dev` in each package in separate terminals:

- `frontend/`: starts the Vite frontend.
- `backend/`: starts `src/server.ts` with automatic restarts through `tsx`. The default port is 5000; override it with `PORT` in `backend/.env`.

The backend health endpoint is `GET http://localhost:5000/api/v1/health`.
The AI Assistant page sends the current prompt to `POST http://localhost:5000/submit` as `{ "text": "Your question" }` and reads the reply from `result.choices[0].message.content`. The backend handles each prompt independently; previous messages remain visible in the frontend but are not sent as conversation history. `VITE_AI_CHAT_URL` can override the submit URL; update any existing `/api/v1/ai/chat` setting in `frontend/.env` to `/submit` and restart Vite. Put the Groq API key in `backend/.env` as `AI_API_KEY`; keep it out of frontend environment files.

## Type checks and builds

Run these commands from the relevant package folder:

| Command | Frontend | Backend |
| --- | --- | --- |
| `npm run typecheck` | Checks React and Vite configuration types | Checks all backend source types |
| `npm run build` | Checks types and creates `dist/` | Checks types and compiles TypeScript into `dist/` |
| `npm run lint` | Runs Oxlint | Not configured |
| `npm test` | Checks dashboard and AI request contracts | Runs Node's test runner with TypeScript support |

For a production backend, run `npm run build` followed by `npm start`. To preview the frontend build locally, run `npm run preview`.

TypeScript checks code during development and builds; it does not validate external data at runtime. Backend authentication requires `SUPABASE_URL` and `SUPABASE_ANON_KEY`, and AI features require `AI_API_KEY`. These helpers are not called by the health endpoint.

Use `.js` extensions for relative imports between backend source modules (for example, `import { askAI } from './coach.js'`). TypeScript resolves these to `.ts` source files and preserves working imports in the compiled Node.js output.

## Vercel deployment

For backend startup errors, missing initialization logs, or `FUNCTION_INVOCATION_FAILED`, see the [2026-10-16 incident and verified fix](docs/troubleshooting/vercel-backend-startup.md).

Deploy from the repository root using `vercel.json`. The frontend serves the SPA, while `/api/*` and `/submit` route to the Express backend. Production frontend requests use these same-origin paths.

The backend service runs `npm run typecheck`; Vercel bundles `backend/src/server.ts` and its dependencies. Do not change this to `npm run build` or upload local `dist/` folders: Vercel can select the compiled directory instead of bundling the source, losing the ES module package context and dependency paths. `.vercelignore` excludes generated builds, local environment files, and temporary files from CLI uploads.

Configure `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `AI_API_KEY` in the deployment environment. Despite its legacy name, `SUPABASE_ANON_KEY` can hold the same publishable key used by the frontend; user access tokens still determine access. Store `AI_API_KEY` as a server-only Secret.

After deploying, verify `/api/v1/health` returns `200` with `status: "ok"`, `/api/dashboard` returns `401` without a session, and `/submit` returns an AI completion. Use `vercel curl` for deployments protected by Vercel Authentication. A deployment marked Ready confirms the build, not runtime health.

