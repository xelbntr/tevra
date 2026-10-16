# Attendance front-end plan

## Goal

Replace the `/attendance` placeholder with a lecturer view for reviewing one
class's attendance on a selected date. Reuse the authenticated app shell and
existing attendance API. The first release is read-only because the backend
only exposes `GET /api/attendance`; it must not imply that statuses can be
changed or saved.

## Existing pieces

- `frontend/src/App.tsx` already has an Attendance navigation item, but currently
  renders the generic “coming soon” view for that route.
- `frontend/src/api.ts` has `fetchClassStudents()`, which calls the attendance
  endpoint but discards attendance fields and summary data. Its URL defaults to
  `localhost` even in production.
- `backend/ATTENDANCE.md` documents the response, query parameters, auth, status
  meanings, error codes, and count rules.
- `GET /api/dashboard` supplies the lecturer's classes and class IDs.

## Page layout and flow

1. Keep the existing page heading and app navigation. Add a class selector and
   date input near the top of the page. Default the date to the user's local
   calendar date, formatted as `YYYY-MM-DD`.
2. Populate the class selector from `fetchDashboard()`. Show each class name,
   course code, academic year, and semester. If there are no classes, show an
   empty state explaining that a class is needed to view attendance.
3. Once a class and date are selected, request
   `GET /api/attendance?class_id=<id>&date=<YYYY-MM-DD>`.
4. Show four summary values: total students, present (including late), absent
   (including excused), and unmarked. Show attendance rate only when the API
   returns a number; label it as a rate among all active students and make the
   unmarked count visible beside it.
5. Show a recap by stored status (`Present`, `Late`, `Excused`, `Absent`,
   `Unmarked`) and a roster table with row number, student number, student name,
   status, and notes when present. Treat a `null` status as “Unmarked”; never
   display it as absent. Do not add a “Sick” status because the API/database has
   no such field.
6. The initial version has no status-edit controls, popups, save button, or
   export action. Those require a write API and a defined interaction contract.

## Front-end data contract

Add typed attendance models in `frontend/src/api.ts` for the class metadata,
student rows, summary, recap, and full response. Replace `fetchClassStudents()`
with `fetchAttendance(classId, date, signal?)`, retaining runtime validation
for the complete response rather than trusting JSON casts.

Use the current Supabase session token in `Authorization: Bearer ...`, set
`cache: 'no-store'`, and pass an abort signal. URL selection should follow the
project's deployment convention: `/api/attendance` in production, and a
configurable `VITE_ATTENDANCE_URL` base (defaulting to the local backend) in
development, with `class_id` and `date` added as query parameters. Do not put
the query string into an environment variable.

When the user changes class or date, abort the previous request and ignore any
late result. Clear the previous class's data while loading the new selection
so stale roster data is not mistaken for the requested date.

## States and errors

- **Loading classes:** status message or skeleton while the dashboard loads.
- **No classes:** explanatory empty state; no attendance request.
- **No class selected:** prompt to choose a class if classes exist.
- **Loading attendance:** visible progress status while the roster loads.
- **Empty class:** show the normal summary with zero students and an empty
  roster message.
- **No records for date:** show all students as unmarked, with a null attendance
  rate, as defined by the API.
- **Request error:** show the API message and a retry action. Handle 401 through
  the existing authentication error behavior; distinguish inaccessible or
  missing class (404) from transient server/network failures where possible.
- **Invalid date:** rely on the native date input and validate the
  `YYYY-MM-DD` value before sending the request.

## Component plan

- `AttendancePage`: owns selected class/date, class list, request state, retry,
  and cancellation lifecycle.
- `AttendanceSummary`: summary cards and status recap, consuming only API
  values (no duplicate business-rule calculations in the UI).
- `AttendanceRoster`: semantic table on desktop and a readable stacked layout
  on narrow screens; includes an empty-state message.
- `api.ts`: attendance types, response validator, and authenticated fetch.
- `App.tsx`: route `/attendance` to `AttendancePage` and update the page eyebrow
  or heading only if needed to match existing pages.
- `App.css`: scoped attendance styles, responsive behavior, and status styling
  that uses text labels as well as color.

## Accessibility and responsive behavior

- Associate visible labels with the class and date controls.
- Keep keyboard focus visible and use native select/date controls.
- Announce loading and request failures with `role="status"` and `role="alert"`.
- Use table headers and captions for the roster; preserve status text for users
  who cannot distinguish color.
- At small widths, allow the roster to become cards or scroll horizontally
  without clipping controls or student names.

## Delivery steps and acceptance criteria

1. **API layer:** define and validate the response; use the authenticated,
   environment-aware URL and cancellation behavior. Acceptance: malformed
   responses fail clearly; 401 and network/server errors remain understandable.
2. **Page shell and selectors:** load classes, select class/date, and handle
   empty class lists. Acceptance: the first class can be selected by default
   when available; no request occurs without a class.
3. **Read-only results:** show summary, recap, and sorted roster from the server.
   Acceptance: late counts as present in summary, excused counts as absent in
   summary, but recap keeps statuses separate; null remains unmarked; rate
   renders as unavailable when null.
4. **Polish:** responsive layout, accessibility labels, loading/error/empty
   states, retry, and request cancellation. Acceptance: changing selection
   never leaves a stale roster visible as current.

## Outside the first release

Attendance marking/editing, note changes, persistence, Figma-style edit popups,
and a Sick category need product decisions plus corresponding backend/schema
support. Keep the UI read-only until those contracts exist.
