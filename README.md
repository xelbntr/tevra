# Learnly

Learnly is an academic management web application with a Vite and React frontend and a separate Express backend running on Node.js. Both packages use TypeScript with strict type checking.

## Project structure

- `backend/` — Express API; `src/server.ts` serves the health endpoint, `src/db.ts` contains the Supabase query script, and `src/coach.ts` exports the AI coach helper.
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

## Type checks and builds

Run these commands from the relevant package folder:

| Command | Frontend | Backend |
| --- | --- | --- |
| `npm run typecheck` | Checks React and Vite configuration types | Checks all backend source types |
| `npm run build` | Checks types and creates `dist/` | Checks types and compiles TypeScript into `dist/` |
| `npm run lint` | Runs Oxlint | Not configured |
| `npm test` | Not configured | Runs Node's test runner with TypeScript support |

For a production backend, run `npm run build` followed by `npm start`. To preview the frontend build locally, run `npm run preview`.

TypeScript checks code during development and builds; it does not validate external data at runtime. The standalone database script requires `SUPABASE_URL` and `SUPABASE_ANON_KEY`, and the AI coach requires `AI_API_KEY`. These helpers are not called by the health endpoint.

Use `.js` extensions for relative imports between backend source modules (for example, `import { askAI } from './coach.js'`). TypeScript resolves these to `.ts` source files and preserves working imports in the compiled Node.js output.

