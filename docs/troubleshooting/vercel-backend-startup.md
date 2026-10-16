# Vercel backend startup failure: FUNCTION_INVOCATION_FAILED

## Incident reference

- Date: 2026-10-16, Asia/Jakarta (GMT+7).
- Vercel project: `axel-bintoros-projects/tevra-wcs8s`.
- Failed deployment: `dpl_5x4WkkCrDWTVwntew56wuDAJGbmt`.
- Verified working deployment: `dpl_6GG9Xfc9HKtLvNHsUAp7hAPL12m8`.
- Fix committed to `main`: `346eab6` (`fix(deploy): preserve Vercel frontend and backend configuration`).

These identifiers describe this incident; inspect the current deployment before applying the same diagnosis to a new failure.

## Symptoms and error signatures

The frontend loaded and Vercel reported the deployment as Ready, but `GET /api/v1/health` returned HTTP 500 with `FUNCTION_INVOCATION_FAILED`. The backend failed before its startup callback could log anything. There were no outgoing API requests for the failed health invocation.

Original runtime error:

```text
Warning: Failed to load the ES module: /var/task/server.js.
/var/task/server.js:1
import 'dotenv/config';
^^^^^^
SyntaxError: Cannot use import statement outside a module
Node.js process exited with exit status: 1.
```

An intermediate attempted fix included the ES module declaration in `dist/package.json`. That cleared the syntax error but exposed another packaging failure:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'dotenv' imported from /var/task/server.js
```

## Confirmed cause

The backend's source `package.json` already contained `"type": "module"`. Adding that setting to the source manifest again would not fix this incident.

The backend build ran `tsc`, producing `dist/`. Vercel's backend builder selected that compiled directory and deployed its files without the necessary original package context and dependency resolution. The uploaded file list also confirmed stale local `backend/dist` files were being sent by CLI deployments, even though Git ignored them.

Changing the service build command alone did not fix the failure while stale `dist/` files were still uploaded. Both the source bundling configuration and upload exclusions were needed.

A separate configuration issue was found: production lacked `SUPABASE_ANON_KEY`, which `backend/src/auth.ts` requires during module loading. This was not the cause of the original syntax error, but could prevent startup after packaging was corrected.

## Working fix and invariants

1. Keep the backend service in root `vercel.json` configured with `root: "backend"`, `framework: "express"`, `entrypoint: "src/server.ts"`, `installCommand: "npm ci --include=dev"`, and `buildCommand: "npm run typecheck"`. Do not set its output directory to `dist`. Vercel handles source compilation and dependency bundling. The local `npm run build` command remains available for standalone Node deployments.
2. Keep root `.vercelignore` exclusions for `**/dist/**`, `**/node_modules/**`, `**/.vercel/**`, temporary folders, and local environment files. `.gitignore` alone did not exclude compiled output from these CLI uploads. Redeploy without build cache when validating this packaging failure.
3. Preserve public routing: `/api/(.*)` and `/submit` go to the backend; the final catch-all goes to the frontend. The Vite frontend keeps its service-local SPA rewrite to `/index.html`. Production frontend requests use relative `/api/dashboard` and `/submit` paths.
4. Configure production `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AI_API_KEY`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY`. This incident's missing `SUPABASE_ANON_KEY` was set in Vercel using the project's existing publishable key; the backend continues to use user access tokens. Keep the AI key server-only. Environment settings are stored in Vercel, not in Git; a new project or environment needs them configured separately.
5. Commit the deployment files and frontend request changes. A successful manual deployment alone does not ensure the next Git deployment includes its fix.

## Diagnose a recurrence

Inspect root `vercel.json`, `.vercelignore`, `backend/package.json`, and the current deployment's build and runtime logs. Determine whether the failure occurs before startup, in a handler, or in an external API call. Similar HTTP 500 responses can have different causes.

For the linked project, these commands were useful:

```sh
vercel --scope axel-bintoros-projects project inspect tevra-wcs8s --non-interactive
vercel --scope axel-bintoros-projects inspect <deployment-id-or-url> --logs
vercel logs --deployment <deployment-url> --scope axel-bintoros-projects --since 10m --limit 20 --json
vercel --scope axel-bintoros-projects curl /api/v1/health --deployment <deployment-url> -- -i
```

Check installed CLI help if syntax changes. Use `vercel curl` for deployments protected by Vercel Authentication; keep protection enabled. If configuration appears correct but the same compiled handler persists, inspect the deployment's uploaded file list for stale `dist` contents.

## Verification achieved

| Check | Observed result |
| --- | --- |
| Health on final deployment and production alias | HTTP 200; `{"status":"ok","message":"Learnly backend is running"}` |
| Frontend HTML and JavaScript asset | HTTP 200 with correct content types |
| SPA deep link during deployment checks | HTTP 200 |
| Dashboard and attendance without a session | HTTP 401; `{"error":"Please sign in"}` |
| POST `/submit` with a harmless test prompt | HTTP 200 with a valid AI completion |
| Final runtime logs | Startup messages and AI request activity; no errors in the inspected window |
| Local tests | 21 backend tests and 15 frontend tests passed |

Local HTTP tests initially failed with `connect EACCES 127.0.0.1` under the execution sandbox. They passed with local network access; that was a test environment restriction, not an application failure.

Signed-in production dashboard data was not verified in this incident because browser access required login. Do not interpret the unauthenticated 401 checks as proof that authenticated database queries work.
