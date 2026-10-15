# Student reports

Call `generateReport(accessToken, { student_id, class_id })` from `src/reports/report.ts`.
Both IDs must be UUIDs. Supabase verifies the session and applies the lecturer's
existing row access policies. A missing or inaccessible enrollment returns `null`.
Database, validation, authentication, and AI failures throw an error.

Successful calls return:

```ts
{
  report: {
    title: string,
    academic_summary: string,
    attendance_summary: string,
    strengths: string[],
    areas_for_support: string[],
    recommended_next_steps: string[],
    data_limitations: string[],
    grade_summary: {
      graded_assessments: number,
      average_percentage: number | null,
      basis: 'unweighted_assessment_percentages'
    },
    attendance_totals: {
      total: number, present: number, late: number, absent: number, excused: number
    }
  },
  grade: number | null,
  attendance: number | null
}
```

- `grade`: arithmetic mean of `(score / max_score) * 100` for each recorded
  assessment. For example, 40/50 and 9/10 produce 85%. Assessment weights are not
  applied because the database does not establish a complete course grading
  policy. This is not a final course grade; recorded extra credit can exceed 100%.
- `attendance`: `(present + late) / total recorded entries * 100`. Excused entries
  count in the denominator. This describes recorded attendance, not all scheduled
  sessions. Dates without records are not assumed absent.
- Both percentages are rounded to two decimals. No recorded grades or attendance
  yields `null` for the corresponding percentage; actual zero remains `0`.

Attendance and grade histories are fetched concurrently with cursor pagination
and exact counts, so a server row cap does not silently truncate summaries.
The AI's user message is only the queried records serialized as JSON; it receives
no coach conversation or derived metrics. `src/reports/report.ts` validates those records,
calculates all numeric metrics in the backend, and validates the AI's JSON
narrative with Zod and Groq's strict JSON schema output format. Backend-calculated
grade summaries and attendance totals are attached after generation. Empty
histories produce a factual draft without a model request. Incomplete, empty,
malformed, or structurally invalid AI responses are rejected.

## Where to read the code

- `src/reports/report.ts`: start with `generateReport()`. It fetches the records,
  then calls `buildStudentReport()` to validate them, calculate metrics, generate
  the narrative, and assemble the response.
- `src/reports/data.ts`: database queries, record validation rules, and pagination.
- `src/reports/narrative.ts`: AI instructions, empty-record draft, and response checks.
- `src/auth.ts`: shared session verification and authenticated database client.

Reports describe one student's enrollment in one subject class and semester.
They are drafts for teacher review. The prompt requests evidence-based support
observations and acknowledges insufficient history rather than inventing trends.
JSON validation checks structure; it cannot prove the AI's narrative is accurate.

Run `npm test` and `npm run typecheck` in `backend` to verify the report pipeline.
The tests use the real SDKs with in-memory HTTP responses, without live student
records or paid AI calls.
