# Backend setup for the frontend login flow

The frontend logs in directly through Supabase Auth, persists the session, and
sends the current access token to `GET /api/dashboard` in the `Authorization`
header. No backend login endpoint or password storage is needed.

The backend implementation uses the existing RLS policies without schema changes.

## 1. Configure shared authentication

`backend/src/auth.ts` creates an authenticated client for each request and
verifies the session. Keep `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `backend/.env`.
Use a publishable or legacy anon key for these user-scoped queries.

`backend/src/dashboard.ts` calls `authenticate()` and fetches the class list and
student count. Report-specific queries live separately in `backend/src/reports/`.

The classes filter uses the verified user ID. The existing RLS policies also
enforce ownership: the student count includes only students enrolled in that
lecturer's classes, counting each student once across classes. Never replace the
key with a service-role key for these queries or trust a user ID sent by the
browser. The class list uses Supabase's configured maximum rows per response;
add pagination when supporting more classes than that limit (usually 1,000).

## 2. Dashboard route in `backend/src/server.ts`

The route uses these imports (the `.js` extension is intentional):

```ts
import { AuthenticationError } from './auth.js'
import { requestDashboardData } from './dashboard.js'
```

The handler returns the dashboard or an authentication/database error:

```ts
app.get('/api/dashboard', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const match = req.get('authorization')?.match(/^Bearer\s+(\S+)$/i)
  if (!match) {
    res.status(401).json({ error: 'Please sign in' })
    return
  }

  try {
    res.json(await requestDashboardData(match[1]))
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.status(401).json({ error: 'Invalid or expired session' })
      return
    }
    console.error('Dashboard query failed:', error)
    res.status(500).json({ error: 'Could not load dashboard' })
  }
})
```

Your existing `app.use(cors())` handles the frontend's cross-origin requests and
Authorization-header preflight in local development. Use your deployed frontend
origin in the production CORS configuration. Keep this route before `app.listen()`.

## Response expected by the frontend

```json
{
  "classes": [
    {
      "id": "class-uuid",
      "name": "Introduction to Programming",
      "course_code": "CS101",
      "academic_year": "2026/2027",
      "semester": "1"
    }
  ],
  "totalStudents": 32
}
```

An empty account should return `{ "classes": [], "totalStudents": 0 }`.
The frontend calculates the displayed course count from `classes.length`.
The old `{ totalStudents, activeCourses }` placeholder is rejected because it
does not contain the class rows.

## Run and verify

1. Start the backend on port 5000 and the frontend with `npm run dev`.
2. Sign in with an existing Supabase Auth email/password account. This frontend
   adds login, not account registration; account creation remains managed by Auth.
3. In browser Network tools, check that `/api/dashboard` receives a Bearer token
   and returns the response above. Don't copy or log the token.
4. Reload: the session should restore and dashboard data should load again.
5. Sign out: the login form should return and previous dashboard data disappears.
6. With two accounts and different classes, confirm each sees its own rows. A
   missing/invalid token should return 401. Do not disable RLS to make queries work.

If you change the endpoint, update `VITE_DASHBOARD_URL` in `frontend/.env` and
restart Vite. Use HTTPS URLs when deploying.
