# Tevra

**Understand your classroom, support your students, and turn academic records into useful next steps.**

Tevra is an academic management website for teachers and lecturers who want a clearer view of their classes without repeatedly piecing together attendance, assessment scores, and student histories. It brings classroom summaries, attendance review, student reports, and an AI assistant into one workspace.

The goal is to make routine academic work easier while helping educators notice where a student may need attention and decide how to respond.

## Who it is for

Tevra is built for educators responsible for monitoring student progress across one or more classes. It supports teachers reviewing daily attendance, lecturers comparing performance across their classes, and educators preparing individual progress reports or planning additional support.

Its current workspace centers on the signed-in educator and the classes they can access.

## The problems Tevra helps solve

Classroom records are useful only when you can turn them into decisions. Looking through scores and attendance separately can make it difficult to see the full picture, compare classes, or prepare a meaningful student report.

Tevra connects these tasks so educators can:

- **Spend less time gathering information.** Review class summaries and ask questions about records from the same workspace.
- **Notice students who may need support.** Explore performance and attendance together, then investigate the patterns behind them.
- **Reduce repetitive report preparation.** Generate a student report draft with academic observations, attendance summaries, and suggested next steps.
- **Correct records with a clear review step.** Ask the assistant to prepare a grade or attendance change and inspect it before saving.
- **Connect analysis to teaching.** Use the available classroom evidence to explore lesson ideas, activities, learning strategies, and interventions.

## An AI assistant that works with your classroom

The AI Assistant is a central part of Tevra. You can ask questions in everyday language, and it can look up your classes, student rosters, assessments, recorded grades, and attendance to ground its answers in the information available to you.

Ask for a summary of a student's progress, compare students or classes, or explore patterns that may suggest someone needs extra support. From there, continue into practical teaching questions: what activity could help, which learning strategy might fit, or what intervention would be worth trying based on the records.

The conversation supports follow-up questions. After discussing a student, you can ask “What about her attendance?” without starting over or repeating the student's name. Recent conversation context helps the assistant connect the question to the discussion.

### Move from a question to a reviewed change

When a record needs correcting, the assistant can propose an update to an **existing assessment score**, within that assessment's allowed range. It can also record or correct attendance for a specific date using **present, late, excused, or absent**, including a date that has no attendance entry yet.

Every proposed edit appears in a review card identifying the student, class, assessment or attendance date, and the values before and after the change. You decide whether to **confirm or cancel**. A chat reply such as “yes” does not save the edit; saving requires the card's **Confirm change** button.

Once a change is saved, Tevra refreshes the affected data so the classroom views reflect the update. Each card is confirmed separately. If the underlying record changes before confirmation, a fresh preview is required.

### Questions to try

- “Compare attendance across my classes.”
- “Which students may need support in Math?”
- “Summarize Ada's progress, then suggest an activity to help her.”
- “What about her attendance?”
- “Change Ada's Quiz 1 score in Math to 85.”
- “Mark Ada present in Math on October 16, 2026.”

Score changes must fit the selected assessment's maximum score. Names, classes, assessments, and dates need to identify the intended record clearly.

### Access and boundaries

The assistant only accesses your own classes. Its editing abilities are limited to existing grade scores and attendance statuses: it cannot create or delete students, classes, enrollments, or assessments, and it cannot edit feedback, notes, or other fields.

Its analysis and teaching suggestions support professional judgment. Review the evidence and recommendations, just as you review a proposed record change. If a request exceeds the supported data limits, the assistant reports the limitation instead of presenting incomplete statistics as a complete answer.

## Your classroom workspace

### Dashboard

Start with an overview of your accessible classes, recorded average grade, and attendance rate. Open the assistant directly from the dashboard to investigate a question, or move into student reports for a closer look.

The average grade is the unweighted mean of recorded assessment percentages. Attendance rate counts present and late entries as attended out of all recorded attendance entries. These figures describe the available records; missing data appears as unavailable rather than being treated as zero.

### Attendance

Choose a class and date to review its active student roster, attendance entries, and status recap. Present, late, excused, absent, and unmarked records remain distinguishable, so a student with no entry is not automatically treated as absent.

Use the assistant when you need to record a missing attendance entry or correct an existing status, then confirm the proposed change before it is saved.

### Grading & Reports

Select a class and student to preview an individual report or generate a downloadable **Word document (.docx)** using the JOINTS student assessment template.

Reports bring together an academic summary, attendance summary, strengths, areas for support, recommended next steps, and data limitations. Recorded grade averages and attendance totals accompany the narrative, giving educators a starting point for review and student support conversations.

AI-written observations are drafts for teacher review. Report averages are unweighted summaries of recorded assessments, not final course grades. Missing information is identified explicitly, and dates without attendance records are not assumed to be absences.

## How it works

1. **Sign in.** Tevra uses Supabase Auth to establish your session. On first login, accounts without classes receive their own fictional sample workspace: two classes, 15 students, five assessments per class, recorded grades, and 14 days of attendance. Existing classrooms are preserved. A notice identifies sample workspaces, and changes stay within the signed-in account.
2. **Review the classroom picture.** Open the dashboard, select a class and attendance date, or choose a student for a report.
3. **Ask and explore.** The assistant retrieves relevant classroom records to help answer questions and suggest teaching approaches. Recent chat context supports follow-up questions.
4. **Review before changing a record.** Inspect any proposed score or attendance update and confirm or cancel it using its review card.
5. **Use the results.** Continue with refreshed classroom data, review a report draft, or download a Word report.

Loaded classroom views retain their selections while you switch between tabs. Data is cached in browser memory during the session, and confirmed assistant edits refresh the affected views. Reload the page to retrieve records changed outside the app. Chat context and pending edit cards persist during tab navigation but clear on reload or sign-out.

## Current scope

Tevra currently provides classroom overviews, attendance review, individual student report previews and Word downloads, and classroom-aware AI conversations with confirmed score and attendance edits.

The dashboard's **Quick Grading** shortcut is marked **Coming soon**. General student, class, enrollment, and assessment creation or deletion is outside the assistant's supported actions.

## Behind the website

### Sample workspace setup

Apply the sample workspace migrations in `backend/supabase/migrations/` before deploying this frontend. The authenticated app calls `ensure_sample_workspace()` before mounting any classroom view, including direct links to attendance, grades, reports, and the assistant. Failed setup can be retried or signed out of. Sample attendance covers the 14 days ending on the setup date in Jakarta time; it is generated once, so later logins do not add new dates.

The database initializes the entire workspace in one transaction. A profile row lock serializes concurrent requests, and a private completion record prevents repeated setup, even if sample classes are later deleted. Accounts that already have classes are recorded as existing workspaces and receive no sample data. The fixed fictional dataset never reads another account's records; student IDs, enrollments, assessments, grades, and attendance are independent for each account. Student numbers include the account ID because the existing schema requires globally unique numbers.

The exposed function runs as the caller and delegates only this fixed initialization to a function in a non-exposed schema. It takes no target user ID, requires a signed-in account with a profile, and has no anonymous execution permission. The private setup table is inaccessible to clients; existing classroom access policies continue to govern ordinary requests. No service key is needed in the browser or backend.

Run `backend/tests/sample-workspace.sql` through a privileged SQL connection to verify new and existing accounts, retries, record totals, saved edits, deletion behavior, and isolation between accounts. Its test users and records are rolled back. Frontend tests also cover waiting for setup on direct links, retrying a failure, signing out during setup, displaying the real account email, and ignoring late setup responses after account switches.

Tevra uses a React and Vite frontend with an Express backend, both written in TypeScript. Supabase provides authentication and classroom data access, while Groq powers the AI assistant and report narratives. The backend verifies user sessions and uses the signed-in user's access token for database requests so existing data access policies remain in effect. Relevant queried records are sent to the AI provider to generate answers and report drafts.

For implementation details, see the [frontend guide](frontend/README.md), [attendance API notes](backend/ATTENDANCE.md), [student report documentation](backend/REPORTS.md), and [deployment troubleshooting guide](docs/troubleshooting/vercel-backend-startup.md).

### Troubleshooting assistant requests

Assistant errors display a reference that matches the backend's diagnostic entry. Logs include the failure stage, message, stack frames, underlying cause, and available provider status/code and request ID. AI failures also include the model, lookup round, and input character count. Credentials and provider-generated error payloads are excluded. During local development, entries are also saved in `backend/logs/assistant-errors.log`; production uses the server console.

Class overviews use statistics calculated from complete accessible records on the server, keeping individual student rows out of the AI request. Detailed record lookups can be limited to an exact student name or number. If a raw result is too large, the assistant is directed to use a class summary or an individual lookup instead.
