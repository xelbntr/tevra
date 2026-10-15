# Backend setup for the frontend login flow

The frontend logs in directly through Supabase Auth, persists the session, and
sends the current access token to `GET /api/dashboard` in the `Authorization`
header. No backend login endpoint or password storage is needed.

The backend implementation below is a handoff example; backend files have not
been edited. The table and ownership columns were checked against project
`bclblebgoptvgrrpmylz`. It uses the existing RLS policies without schema changes.

## 1. Replace `backend/src/db.ts`

The existing shared client and `loginWithEmail()` are replaced by a client created
for each request. Keep `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `backend/.env`.
Use a publishable or legacy anon key for these user-scoped queries.

```ts
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set')
}

export class AuthenticationError extends Error {}

export async function requestDashboardData(accessToken: string) {
  const db = createClient(supabaseUrl!, supabaseKey!, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  const { data: { user }, error: authError } = await db.auth.getUser(accessToken)
  if (authError || !user) {
    throw new AuthenticationError('Invalid or expired session')
  }

  const [classesResult, studentsResult] = await Promise.all([
    db.from('classes')
      .select('id, name, course_code, academic_year, semester')
      .eq('lecturer_id', user.id)
      .order('created_at', { ascending: false }),
    db.from('students').select('id', { count: 'exact', head: true }),
  ])

  if (classesResult.error) throw classesResult.error
  if (studentsResult.error) throw studentsResult.error

  return {
    classes: classesResult.data ?? [],
    totalStudents: studentsResult.count ?? 0,
  }
}
```

The classes filter uses the verified user ID. The existing RLS policies also
enforce ownership: the student count includes only students enrolled in that
lecturer's classes, counting each student once across classes. Never replace the
key with a service-role key for these queries or trust a user ID sent by the
browser. The class list uses Supabase's configured maximum rows per response;
add pagination when supporting more classes than that limit (usually 1,000).

## 2. Replace the dashboard route in `backend/src/server.ts`

Add this import alongside the other imports (the `.js` extension is intentional):

```ts
import { AuthenticationError, requestDashboardData } from './db.js'
```

Replace the placeholder `app.get('/api/dashboard', ...)` handler with:

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
