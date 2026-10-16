# Tevra rename inventory

Completed on 2026-10-16. The application was previously named Learnly.

## Frontend index

A case-insensitive substring scan found 24 occurrences in 10 frontend files.
All were renamed, preserving lowercase, title case, or uppercase as appropriate.
Line numbers below refer to the files at the time of the scan.

| File | Lines | Occurrences | Purpose |
| --- | --- | ---: | --- |
| `frontend/index.html` | 7 | 1 | Browser title |
| `frontend/src/App.tsx` | 121, 123, 125, 155, 203, 273, 277 | 7 | Dashboard labels, wordmark, classroom heading, placeholder and AI chat text |
| `frontend/src/AuthGate.tsx` | 76, 79, 107 | 3 | Sign-in wordmark, setup heading and sign-up text |
| `frontend/src/api.ts` | 93, 219, 313, 363 | 4 | Backend connection errors |
| `frontend/package.json` | 2 | 1 | Package name |
| `frontend/package-lock.json` | 2, 8 | 2 | Lockfile name and root package name |
| `frontend/README.md` | 1 | 1 | Frontend documentation heading |
| `frontend/tests/grading-reports.test.mjs` | 7 | 1 | Test origin |
| `frontend/tests/navigation-cache.test.mjs` | 8, 20 | 2 | Test origin and email domain |
| `frontend/tests/report-api.test.mjs` | 9, 57 | 2 | Test origins |

The two standalone `L` initials in `App.tsx` and `AuthGate.tsx` also became `T`.
The favicon already points to `/tevra-app-icon.svg`.

## Backend and packages

The backend can use the new name without a structural refactor. Five occurrences
in four files were renamed:

| File | Lines | Occurrences | Change |
| --- | --- | ---: | --- |
| `backend/package.json` | 2 | 1 | Package becomes `tevra-backend` |
| `backend/package-lock.json` | 2, 8 | 2 | Both root names become `tevra-backend` |
| `backend/src/server.ts` | 27 | 1 | Health message becomes `Tevra backend is running` |
| `backend/src/reports/narrative.ts` | 19 | 1 | Academic report writer identifies as Tevra |

The frontend package becomes `tevra-frontend`. Neither package has a dependency
on the other by its package name, or a local file/workspace dependency. Source
imports use relative paths or third-party package names. Dependency names,
versions and lockfile dependency entries do not need to change.

The root README title and description were also updated (two occurrences).

## Scope and external identities

- Checked frontend and backend source, tests, documentation, package metadata,
  public assets and repository configuration, including hidden/ignored local
  configuration outside dependencies and generated output. Local environment
  files contain no old-name matches; their values were not copied into this report.
- Vercel configuration uses `frontend` and `backend` service names and directory
  paths. Neither depends on the application/package name, so routing stays valid.
- Supabase's local `project_id` is `backend`. The configured hosted project is
  `joints-academic-assistant` (`bclblebgoptvgrrpmylz`). No database, Auth, URL,
  credential, or hosted project change is required for this code rename. Remote
  schema and provider settings were not inspected or changed.
- The checkout directory is still named `learnly`. Renaming this active workspace
  or a remote Git repository is separate from renaming the application.
- The old name remains intentionally in this inventory and in the recorded health
  response in `docs/troubleshooting/vercel-backend-startup.md:71`, which documents
  what was observed during that incident. The current health response uses Tevra.
- Git history, installed dependencies and generated output are outside the source
  rename. Both packages were rebuilt; an obsolete generated `backend/dist/report.js`
  and its source map were removed because their source module no longer exists.
  Production requires a deployment to receive the updated branding.

## Validation

- Frontend and backend builds passed, including TypeScript checks.
- All 37 frontend tests and 26 backend tests passed. Local HTTP tests required
  local network access beyond the default execution sandbox.
- Frontend lint completed with three warnings in unchanged hook/effect code.
- Package manifest and lockfile root names agree in both packages; dependency
  versions and entries are unchanged.
- A final case-insensitive scan found no old-name matches in frontend/backend
  source or their current generated output. Remaining repository mentions are
  the intentional records described above.
