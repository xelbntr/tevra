import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, MouseEvent, SVGProps } from 'react'
import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AuthGate } from './AuthGate'
import { AccountMenu } from './AccountMenu'
import { SampleWorkspace } from './SampleWorkspace'
import { AttendancePage } from './AttendancePage'
import { ReportsPage } from './ReportsPage'
import { GradesPage } from './GradesPage'
import { DashboardSkeleton } from './LoadingSkeletons'
import { AuthenticationError, fetchDashboard, sendAssistantChat, confirmAssistantEdit } from './api'
import type { AssistantMessage, AssistantProposal, DashboardData } from './api'
import { getSupabase } from './supabase'
import './App.css'
import './Prism.css'

type IconName = 'grid' | 'calendar' | 'grading' | 'report' | 'person' | 'book' | 'paper' | 'send' | 'arrow' | 'sparkles' | 'info'

type IconProps = {
  name: IconName
  size?: number
  strokeWidth?: number
}

function Icon({ name, size = 18, strokeWidth = 1.8 }: IconProps) {
  const gradientId = useId()
  const common: SVGProps<SVGSVGElement> = {
    width: `${size / 16}rem`,
    height: `${size / 16}rem`,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }

  const paths = {
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
    grid: <><rect x="4" y="4" width="5" height="5" rx="1" /><rect x="15" y="4" width="5" height="5" rx="1" /><rect x="4" y="15" width="5" height="5" rx="1" /><rect x="15" y="15" width="5" height="5" rx="1" /></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h6" /></>,
    grading: <><path d="M8 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /><path d="M8 2h12v13H8zM11 7h6M11 10h4M11 13h2" /><path d="m16 4 2 2 3-3" /></>,
    report: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /><path d="M7 3v18" /></>,
    person: <><circle cx="12" cy="8" r="3.3" /><path d="M5 20a7 7 0 0 1 14 0M12 2v1" /></>,
    book: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 4v16M12 8h4M12 11h4M12 14h3" /></>,
    paper: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="m8 12 2.5 2.5L16 9M8 7h8M8 17h3" /></>,
    send: <><path d="m21 3-7.2 18-3.8-7-7-3.8L21 3Z" /><path d="M10 14 21 3" /></>,
    arrow: <><path d="M7 17 17 7M8 7h9v9" /></>,
    sparkles: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /><path d="m5 2 .7 1.8L7.5 4.5l-1.8.7L5 7l-.7-1.8L2.5 4.5l1.8-.7L5 2Z" /></>,
  }

  return <svg {...common} stroke={name === 'sparkles' ? `url(#${gradientId})` : common.stroke}>
    {name === 'sparkles' && <defs>
      <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#168b98" />
        <stop offset="30%" stopColor="#5d73d9" />
        <stop offset="58%" stopColor="#a544b3" />
        <stop offset="80%" stopColor="#d46a95" />
        <stop offset="100%" stopColor="#b88531" />
      </linearGradient>
    </defs>}
    {paths[name]}
  </svg>
}

const navigation = [
  { label: 'Dashboard', icon: 'grid', href: '/dashboard' },
  { label: 'Attendance', icon: 'calendar', href: '/attendance' },
  { label: 'AI Assistant', icon: 'sparkles', href: '/assistant' },
  { label: 'Grades', icon: 'grading', href: '/grades' },
  { label: 'Reports', icon: 'report', href: '/reports' },
] satisfies { label: string; icon: IconName; href: string }[]

const sampleNoticeStorageKey = 'tevra:sample-notice-dismissed'

function App() {
  return (
    <AuthGate>
      {(session) => (
        <SampleWorkspace key={session.user.id} onSignOut={async () => {
          const { error } = await getSupabase().auth.signOut({ scope: 'local' })
          if (error) throw error
        }}>
          {(sampleData) => <Dashboard email={session.user.email} sampleData={sampleData} />}
        </SampleWorkspace>
      )}
    </AuthGate>
  )
}

function Dashboard({ email, sampleData }: { email: string | undefined; sampleData: boolean }) {
  const [pathname, setPathname] = useState(window.location.pathname)
  const [prompt, setPrompt] = useState('')
  const [assistantPrompt, setAssistantPrompt] = useState('')
  const [notice, setNotice] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [sampleNoticeDismissed, setSampleNoticeDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(sampleNoticeStorageKey) === 'true'
    } catch {
      return false
    }
  })
  const [dataRevision, setDataRevision] = useState(0)
  const [newScoreRequest, setNewScoreRequest] = useState(0)
  const [gradesOpened, setGradesOpened] = useState(() => window.location.pathname.replace(/\/+$/, '') === '/grades')

  useEffect(() => {
    function syncPathname() {
      setPathname(window.location.pathname)
      if (window.location.pathname.replace(/\/+$/, '') === '/grades') setGradesOpened(true)
    }

    window.addEventListener('popstate', syncPathname)
    return () => window.removeEventListener('popstate', syncPathname)
  }, [])

  const normalizedPath = pathname.replace(/\/+$/, '') || '/'
  const currentPath = normalizedPath === '/grading-reports' ? '/reports' : normalizedPath
  const currentPage = navigation.find((item) => item.href === currentPath)
  const isDashboard = currentPath === '/' || currentPath === '/dashboard'
  const isAttendance = currentPath === '/attendance'
  const isAssistant = currentPath === '/assistant'
  const isReports = currentPath === '/reports'
  const isGrades = currentPath === '/grades'
  const activeNavigationIndex = navigation.findIndex(item => item.href === (isDashboard ? '/dashboard' : currentPath))

  useEffect(() => {
    if (normalizedPath === '/grading-reports') {
      window.history.replaceState({}, '', '/reports')
    }
  }, [normalizedPath])

  async function signOut() {
    setSigningOut(true)
    try {
      const { error } = await getSupabase().auth.signOut({ scope: 'local' })
      if (error) throw error
    } catch {
      showNotice('Could not sign out. Please try again.')
    } finally {
      setSigningOut(false)
    }
  }

  function navigate(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (href === '/grades') setGradesOpened(true)
    if (window.location.pathname !== href) window.history.pushState({}, '', href)
    setPathname(href)
  }

  function showNotice(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2600)
  }

  function dismissSampleNotice() {
    setSampleNoticeDismissed(true)
    try {
      window.localStorage.setItem(sampleNoticeStorageKey, 'true')
    } catch {
      // Dismiss for this visit even when browser storage is unavailable.
    }
  }

  function askAssistant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!prompt.trim()) return
    setAssistantPrompt(prompt.trim())
    setPrompt('')
    window.history.pushState({}, '', '/assistant')
    setPathname('/assistant')
  }

  return (
    <main className="app-frame">
      <section className={`dashboard-shell${isDashboard ? ' dashboard-home' : ''}`} aria-label="Tevra dashboard">
        <header className="topbar">
          <a className="brand-mark" href="/dashboard" aria-label="Tevra home" onClick={(event) => navigate(event, '/dashboard')}>
            <img className="brand-icon" src="/tevra-app-icon.svg" alt="" />
          </a>
          <AccountMenu email={email} signingOut={signingOut} onSignOut={signOut} />
        </header>

        <div className="dashboard-layout">
          <nav className={`side-nav${isAssistant ? ' has-ai-active' : ''}`} aria-label="Main navigation" style={{
            '--active-tab': activeNavigationIndex,
            '--nav-count': navigation.length,
          } as CSSProperties}>
            {activeNavigationIndex >= 0 && <span className="nav-selection" aria-hidden="true" />}
            {navigation.map((item) => (
              <a
                className={`nav-button${item.href === '/assistant' ? ' nav-ai' : ''} ${(currentPath === item.href || (item.label === 'Dashboard' && currentPath === '/')) ? 'is-active' : ''}`}
                href={item.href}
                key={item.label}
                aria-label={item.label}
                title={item.label}
                aria-current={(currentPath === item.href || (item.label === 'Dashboard' && currentPath === '/')) ? 'page' : undefined}
                onClick={(event) => navigate(event, item.href)}
              >
                <span className="nav-icon"><Icon name={item.icon} size={18} /></span>
                <span className="nav-label" aria-hidden="true">{item.label === 'Dashboard' ? 'Home' : item.label === 'AI Assistant' ? 'Assistant' : item.label}</span>
              </a>
            ))}
          </nav>

          <div className="dashboard-content">
            {sampleData && !sampleNoticeDismissed && (
              <div className="sample-data-notice">
                <Icon name="info" size={16} />
                <p>Your workspace starts with fictional sample classroom data so you can explore Tevra. Changes you make are saved only to your account.</p>
                <button className="sample-data-dismiss" type="button" onClick={dismissSampleNotice}>I understand</button>
              </div>
            )}
            <div className="heading-row">
              <div>
                <p className="eyebrow">{isDashboard ? 'YOUR CLASSROOM AT A GLANCE' : isAssistant ? 'CLASSROOM INTELLIGENCE, WITH TEVRA' : 'TEVRA CLASSROOM'}</p>
                <h1>{isAssistant ? 'Tevra AI' : currentPage?.label ?? (isDashboard ? 'Dashboard' : 'Page not found')}</h1>
              </div>
              {isDashboard && <span className="today-pill">Overview</span>}
            </div>

            {/* Keep data views mounted: switching tabs preserves selections and renders
                loaded content immediately. Their shared requests are deduplicated. */}
            <div hidden={!isDashboard}>
              <>
                <div className="ask-heading"><Icon name="sparkles" size={15} /><span>Tevra AI</span></div>
                <form className="ask-bar prism-surface" onSubmit={askAssistant}>
                  <label className="sr-only" htmlFor="ask-ai">Ask AI</label>
                  <input
                    id="ask-ai"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Ask about your class…"
                  />
                  <button type="submit" aria-label="Send question"><Icon name="send" size={16} /></button>
                </form>

                <DashboardResults key={dataRevision} />

                <section className="quick-actions" aria-label="Quick actions">
                  <button className="action-card" type="button" onClick={() => {
                    window.history.pushState({}, '', '/reports')
                    setPathname('/reports')
                  }}>
                    <span className="action-icon"><img src="/dashboard/report.svg" alt="" /></span>
                    <span className="action-label">Generate Report</span>
                    <span className="action-arrow"><img src="/dashboard/arrow.svg" alt="" /></span>
                  </button>
                  <button className="action-card" type="button" onClick={() => {
                    window.history.pushState({}, '', '/grades')
                    setNewScoreRequest(value => value + 1)
                    setGradesOpened(true)
                    setPathname('/grades')
                  }}>
                    <span className="action-icon"><img src="/dashboard/grading.svg" alt="" /></span>
                    <span className="action-label">Quick Grading</span>
                    <span className="action-arrow"><img src="/dashboard/arrow.svg" alt="" /></span>
                  </button>
                </section>
              </>
            </div>
            <div hidden={!isAttendance}><AttendancePage key={dataRevision} /></div>
            <div hidden={!isReports}><ReportsPage key={dataRevision} /></div>
            <div hidden={!isGrades}>{(isGrades || gradesOpened) && <GradesPage revision={dataRevision} newScoreRequest={newScoreRequest} onRecordsChanged={() => setDataRevision(value => value + 1)} />}</div>
            <div hidden={!isAssistant}>
              <AssistantChat
                initialPrompt={assistantPrompt}
                onInitialPromptHandled={() => setAssistantPrompt('')}
                onRecordsChanged={() => setDataRevision(value => value + 1)}
              />
            </div>
            {!isAssistant && !isDashboard && !isAttendance && !isReports && !isGrades ? (
              <section className="coming-soon" aria-live="polite">
                <div className="coming-soon-icon"><Icon name={currentPage?.icon ?? 'book'} size={25} /></div>
                <h2>{currentPage ? `${currentPage.label} is coming soon` : 'This page is coming soon'}</h2>
                <p>We’re getting this part of Tevra ready. Check back soon.</p>
                <a href="/dashboard" onClick={(event) => navigate(event, '/dashboard')}>Back to dashboard</a>
              </section>
            ) : null}
          </div>
        </div>
        {notice && <div className="notice" role="status">{notice}</div>}
      </section>
    </main>
  )
}

const assistantMarkdownComponents: Components = {
  table: ({ children }) => (
    <div className="chat-table-wrapper" role="region" aria-label="Response table" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
}

function AssistantChat({ initialPrompt, onInitialPromptHandled, onRecordsChanged }: {
  initialPrompt: string
  onInitialPromptHandled: () => void
  onRecordsChanged: () => void
}) {
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [proposals, setProposals] = useState<AssistantProposal[]>([])
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)

  const sendMessage = useCallback(async (rawMessage: string) => {
    const content = rawMessage.trim()
    if (!content || busy.current) return
    busy.current = true
    setProposals([])
    const conversation: AssistantMessage[] = [...messages, { role: 'user' as const, content }].slice(-20)
    setMessages(conversation)
    setDraft('')
    setError('')
    setLoading(true)
    try {
      const { reply, proposals: changes } = await sendAssistantChat(content, messages)
      setMessages([...conversation, { role: 'assistant' as const, content: reply }].slice(-20))
      setProposals(changes)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The AI could not respond. Please try again.')
    } finally {
      setLoading(false)
      busy.current = false
    }
  }, [messages])

  useEffect(() => {
    if (!initialPrompt || busy.current) return
    void sendMessage(initialPrompt)
    onInitialPromptHandled()
  }, [initialPrompt, loading, saving, sendMessage, onInitialPromptHandled])

  async function confirmChange(proposal: AssistantProposal) {
    if (busy.current) return
    busy.current = true
    setSaving(true)
    setError('')
    try {
      const message = await confirmAssistantEdit(proposal.token)
      setMessages(current => [...current, { role: 'assistant' as const, content: message }].slice(-20))
      setProposals(current => current.filter(item => item.token !== proposal.token))
      onRecordsChanged()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the change.')
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void sendMessage(draft)
  }

  return (
    <section className="assistant-panel prism-surface" aria-label="AI Assistant">
      <div className="assistant-intro">
        <span className="assistant-icon"><Icon name="sparkles" size={20} /></span>
        <div>
          <span className="assistant-kicker">POWERED BY YOUR CLASSROOM</span>
          <h2>Your classroom, connected.</h2>
        </div>
      </div>
      <div className="chat-transcript" aria-live="polite" aria-busy={loading}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <span className="chat-empty-emblem"><Icon name="sparkles" size={34} /></span>
            <strong>What would you like help with?</strong>
            <span>Your classroom has a story. Let’s find the next step.</span>
            <div className="assistant-starters" aria-label="Suggested questions">
              {[
                { icon: 'person', title: 'Find who needs support', prompt: 'Which students need support based on their grades and attendance?' },
                { icon: 'grading', title: 'Update a student’s score', prompt: 'Help me update a student’s score. Ask me which student, class, assessment and new score, then show a preview before saving.' },
                { icon: 'calendar', title: 'Correct attendance', prompt: 'Help me correct an attendance record. Ask me which student, class, date and status, then show a preview before saving.' },
              ].map(item => <button key={item.title} type="button" disabled={loading || saving} onClick={() => void sendMessage(item.prompt)}>
                <Icon name={item.icon as IconName} size={18} />
                <span>{item.title}</span><Icon name="arrow" size={14} />
              </button>)}
            </div>
          </div>
        )}
        {messages.map((message, index) => (
          <article className={`chat-message chat-message-${message.role}`} key={`${index}-${message.role}`}>
            <span className="chat-speaker">{message.role === 'user' ? 'You' : 'Tevra AI'}</span>
            {message.role === 'assistant' ? (
              <div className="chat-markdown">
                <Markdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents} skipHtml>
                  {message.content}
                </Markdown>
              </div>
            ) : <p className="chat-user-content">{message.content}</p>}
          </article>
        ))}
        {loading && <p className="chat-pending" role="status"><Icon name="sparkles" size={16} />Tevra AI is thinking<span className="thinking-dots" aria-hidden="true">…</span></p>}
      </div>
      {proposals.length > 0 && <section className="assistant-changes" aria-label="Proposed changes">
        <p>Review before saving. Each preview expires after 15 minutes.</p>
        {proposals.map(proposal => <article className="assistant-change" key={proposal.token}>
          <strong>{proposal.label}</strong>
          <p>{proposal.before ?? 'Unmarked'} → {proposal.after}</p>
          <button className="primary-button" type="button" disabled={saving || loading} onClick={() => void confirmChange(proposal)}>{saving ? 'Saving…' : 'Confirm change'}</button>
          <button className="secondary-button" type="button" disabled={saving || loading} onClick={() => setProposals(current => current.filter(item => item.token !== proposal.token))}>Cancel</button>
        </article>)}
      </section>}
      {error && <p className="error-message chat-error" role="alert">{error}</p>}
      <form className="assistant-composer prism-surface" onSubmit={submit}>
        <label className="sr-only" htmlFor="assistant-prompt">Message the AI assistant</label>
        <textarea id="assistant-prompt" aria-describedby="assistant-disclaimer" rows={3} maxLength={5000} value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault()
              if (!event.repeat) event.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder="Write a message…" disabled={loading || saving} />
        <div className="composer-footer">
          <button className="primary-button" type="submit" disabled={loading || saving || !draft.trim()}>
            {loading ? 'Thinking…' : <><span>Send</span><Icon name="send" size={15} /></>}
          </button>
        </div>
      </form>
      <p className="assistant-disclaimer" id="assistant-disclaimer">AI responses can be inaccurate. Review materials before using them.</p>
    </section>
  )
}

function DashboardResults() {
  const [retry, setRetry] = useState(0)
  return <DashboardRequest key={retry} onRetry={() => setRetry((value) => value + 1)} />
}

function DashboardRequest({ onRetry }: { onRetry: () => void }) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [authenticationFailed, setAuthenticationFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchDashboard(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setDashboard(data)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setAuthenticationFailed(error instanceof AuthenticationError)
        setLoadError(error instanceof Error ? error.message : 'Could not load the dashboard.')
      })
    return () => controller.abort()
  }, [])

  if (loadError) return (
    <section className="dashboard-message" role="alert">
      <p>{loadError}</p>
      {!authenticationFailed && <button className="secondary-button" type="button" onClick={onRetry}>Try again</button>}
    </section>
  )
  if (!dashboard) return <DashboardSkeleton />

  const metrics = [
    { label: 'Students', value: dashboard.totalStudents, icon: 'person', asset: '/dashboard/students.svg' },
    { label: 'Courses', value: dashboard.classes.length, icon: 'book' },
    { label: 'Average Grade', value: dashboard.averageGrade == null ? '—' : dashboard.averageGrade.toFixed(1), icon: 'report', asset: '/dashboard/grade.svg' },
    { label: 'Attendance Rate', value: dashboard.attendanceRate == null ? '—' : `${dashboard.attendanceRate}%`, icon: 'calendar', asset: '/dashboard/attendance.svg' },
  ] satisfies { label: string; value: number | string; icon: IconName; asset?: string }[]

  return (
    <>
      <section className="metrics-grid" aria-label="Class statistics">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <span className="metric-icon">{metric.asset ? <img src={metric.asset} alt="" /> : <Icon name={metric.icon} size={24} />}</span>
            <div className="metric-copy">
              <p className="metric-value">{metric.value}</p>
              <h2>{metric.label}</h2>
            </div>
          </article>
        ))}
      </section>
      <section className="class-list" aria-label="Your classes">
        <h2>Your classes</h2>
        {dashboard.classes.length === 0 ? (
          <p>You don’t have any classes yet.</p>
        ) : (
          <ul>
            {dashboard.classes.map((item) => (
              <li key={item.id}>
                <h3>{item.name}</h3>
                <p>{item.course_code} · {item.academic_year} · Semester {item.semester}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

export default App
