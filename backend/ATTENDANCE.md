# Attendance API

`GET /api/attendance?class_id=<class UUID>&date=2026-10-14`

Send `Authorization: Bearer <Supabase access token>`. Both query parameters are
required. This endpoint only reads data; it does not save attendance or implement
the Figma popups. Class IDs are available from the existing `GET /api/dashboard`.

The code is in `src/attendance.ts`: verify the session, then find the lecturer's
class and read its active roster with that day's attendance concurrently before
counting the statuses.
It reuses the existing authentication helper and row access policies.

`GET /api/attendance/roster?class_id=<class UUID>` uses the same authentication
and class access checks, but returns only `{ students: [{ student_id,
student_number, full_name }] }` for active enrollments. Grading & Reports uses
this lightweight endpoint without loading attendance records or summaries.

Example response for a class with one present student and one unmarked student:

```json
{
  "class": {
    "id": "00000000-0000-4000-8000-000000000001",
    "name": "12A",
    "course_code": "MATH101",
    "academic_year": "2026/2027",
    "semester": "1"
  },
  "date": "2026-10-14",
  "students": [
    {
      "enrollment_id": "00000000-0000-4000-8000-000000000002",
      "student_id": "00000000-0000-4000-8000-000000000003",
      "student_number": "2026001",
      "full_name": "Andi Pratama",
      "status": "present",
      "notes": null
    },
    {
      "enrollment_id": "00000000-0000-4000-8000-000000000004",
      "student_id": "00000000-0000-4000-8000-000000000005",
      "student_number": "2026002",
      "full_name": "Budi Santoso",
      "status": null,
      "notes": null
    }
  ],
  "summary": {
    "totalStudents": 2,
    "present": 1,
    "absent": 0,
    "unmarked": 1,
    "attendanceRate": 50
  },
  "recap": { "present": 1, "late": 0, "excused": 0, "absent": 0, "unmarked": 1 }
}
```

- Students are sorted by name. Their array position plus one gives the row number.
  Dropped enrollments are excluded; the roster uses current enrollment status.
- `status` is the database value: `present`, `late`, `excused`, or `absent`.
  A missing record produces `null` and counts as `unmarked`, never as absent.
- The summary's `present` includes late arrivals; `absent` includes excused
  absences. The recap keeps each stored status separate. Figma's Permission /
  Excused corresponds to `excused`, and Unexcused corresponds to `absent`.
  The database has no separate Sick status, so this API cannot supply a Sick
  count. It does not guess from notes or change the database schema.
- `attendanceRate` is `(present + late) / total active students * 100`, rounded
  to a whole percentage, matching the Figma display. It is `null` if there are
  no students or no attendance records that day. Unmarked students remain in
  the denominator, so check `unmarked` when showing a partially recorded day.
- Empty classes return empty students and zero counts. Missing/inaccessible
  classes return 404, invalid query parameters 400, missing/expired sessions 401,
  and database failures 500. Responses use `Cache-Control: no-store`. A roster
  exceeding the database's response row cap returns 500 rather than partial
  totals; pagination is intentionally outside this single-class endpoint.

Use the backend's existing `SUPABASE_URL` and `SUPABASE_ANON_KEY` settings.
Run `npm test`, `npm run typecheck`, and `npm run build` from `backend/`.
