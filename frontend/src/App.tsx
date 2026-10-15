import { useEffect, useState } from 'react'
import type { FormEvent, MouseEvent, SVGProps } from 'react'
import { AuthGate } from './AuthGate'
import { AuthenticationError, fetchDashboard } from './api'
import type { DashboardData } from './api'
import { getSupabase } from './supabase'
import './App.css'

type IconName = 'grid' | 'calendar' | 'grading' | 'report' | 'person' | 'book' | 'paper' | 'send' | 'arrow'

type IconProps = {
  name: IconName
  size?: number
  strokeWidth?: number
}

function Icon({ name, size = 18, strokeWidth = 1.8 }: IconProps) {
  const common: SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }

  const paths = {
    grid: <><rect x="4" y="4" width="5" height="5" rx="1" /><rect x="15" y="4" width="5" height="5" rx="1" /><rect x="4" y="15" width="5" height="5" rx="1" /><rect x="15" y="15" width="5" height="5" rx="1" /></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h6" /></>,
    grading: <><path d="M8 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /><path d="M8 2h12v13H8zM11 7h6M11 10h4M11 13h2" /><path d="m16 4 2 2 3-3" /></>,
    report: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /><path d="M7 3v18" /></>,
    person: <><circle cx="12" cy="8" r="3.3" /><path d="M5 20a7 7 0 0 1 14 0M12 2v1" /></>,
    book: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 4v16M12 8h4M12 11h4M12 14h3" /></>,
    paper: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="m8 12 2.5 2.5L16 9M8 7h8M8 17h3" /></>,
    send: <><path d="m21 3-7.2 18-3.8-7-7-3.8L21 3Z" /><path d="M10 14 21 3" /></>,
    arrow: <><path d="M7 17 17 7M8 7h9v9" /></>,
  }

  return <svg {...common}>{paths[name]}</svg>
}

const navigation = [
  { label: 'Dashboard', icon: 'grid', href: '/dashboard' },
  { label: 'Attendance', icon: 'calendar', href: '/attendance' },
  { label: 'Grading', icon: 'grading', href: '/grading' },
  { label: 'Reports', icon: 'report', href: '/reports' },
] satisfies { label: string; icon: IconName; href: string }[]

function App() {
  return (
    <AuthGate>
      {(session) => <Dashboard key={session.user.id} email={session.user.email} />}
    </AuthGate>
  )
}

function Dashboard({ email }: { email: string | undefined }) {
  const [pathname, setPathname] = useState(window.location.pathname)
  const [prompt, setPrompt] = useState('')
  const [notice, setNotice] = useState('')
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    function syncPathname() {
      setPathname(window.location.pathname)
    }

    window.addEventListener('popstate', syncPathname)
    return () => window.removeEventListener('popstate', syncPathname)
  }, [])

  const currentPath = pathname.replace(/\/+$/, '') || '/'
  const currentPage = navigation.find((item) => item.href === currentPath)
  const isDashboard = currentPath === '/' || currentPath === '/dashboard'

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
    if (window.location.pathname !== href) window.history.pushState({}, '', href)
    setPathname(href)
  }

  function showNotice(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2600)
  }

  function askAssistant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!prompt.trim()) return
    showNotice('AI assistant will be available when the service is connected.')
    setPrompt('')
  }

  return (
    <main className="app-frame">
      <section className="dashboard-shell" aria-label="Learnly dashboard">
        <header className="topbar">
          <a className="brand-mark" href="/dashboard" aria-label="Learnly home" onClick={(event) => navigate(event, '/dashboard')}>
            <span className="brand-symbol">L</span>
            <span className="brand-name">learnly</span>
          </a>
          <div className="account-controls">
            <span className="account-email" title={email}>{email}</span>
            <button className="secondary-button" type="button" disabled={signingOut} onClick={signOut}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </header>

        <div className="dashboard-layout">
          <nav className="side-nav" aria-label="Main navigation">
            {navigation.map((item) => (
              <a
                className={`nav-button ${(currentPath === item.href || (item.label === 'Dashboard' && currentPath === '/')) ? 'is-active' : ''}`}
                href={item.href}
                key={item.label}
                aria-label={item.label}
                title={item.label}
                aria-current={(currentPath === item.href || (item.label === 'Dashboard' && currentPath === '/')) ? 'page' : undefined}
                onClick={(event) => navigate(event, item.href)}
              >
                <Icon name={item.icon} size={18} />
              </a>
            ))}
          </nav>

          <div className="dashboard-content">
            <div className="heading-row">
              <div>
                <p className="eyebrow">{isDashboard ? 'YOUR CLASSROOM AT A GLANCE' : 'LEARNLY CLASSROOM'}</p>
                <h1>{currentPage?.label ?? (isDashboard ? 'Dashboard' : 'Page not found')}</h1>
              </div>
              {isDashboard && <span className="today-pill">Overview</span>}
            </div>

            {isDashboard ? (
              <>
                <form className="ask-bar" onSubmit={askAssistant}>
                  <label className="sr-only" htmlFor="ask-ai">Ask AI</label>
                  <input
                    id="ask-ai"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Ask AI anything about your class..."
                  />
                  <button type="submit" aria-label="Send question"><Icon name="send" size={16} /></button>
                </form>

                <DashboardResults />

                <section className="quick-actions" aria-label="Quick actions">
                  <button className="action-card" type="button" onClick={() => showNotice('Report generation is coming soon.')}>
                    <span className="action-icon"><Icon name="report" size={17} /></span>
                    <span className="action-label">Generate Report</span>
                    <span className="action-arrow"><Icon name="arrow" size={15} /></span>
                  </button>
                  <button className="action-card" type="button" onClick={() => showNotice('Quick grading is coming soon.')}>
                    <span className="action-icon"><Icon name="paper" size={17} /></span>
                    <span className="action-label">Quick Grading</span>
                    <span className="action-arrow"><Icon name="arrow" size={15} /></span>
                  </button>
                </section>
              </>
            ) : (
              <section className="coming-soon" aria-live="polite">
                <div className="coming-soon-icon"><Icon name={currentPage?.icon ?? 'book'} size={25} /></div>
                <h2>{currentPage ? `${currentPage.label} is coming soon` : 'This page is coming soon'}</h2>
                <p>We’re getting this part of Learnly ready. Check back soon.</p>
                <a href="/dashboard" onClick={(event) => navigate(event, '/dashboard')}>Back to dashboard</a>
              </section>
            )}
          </div>
        </div>
        {notice && <div className="notice" role="status">{notice}</div>}
      </section>
    </main>
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
  if (!dashboard) return <p role="status">Loading your dashboard…</p>

  const metrics = [
    { label: 'Students', value: dashboard.totalStudents, icon: 'person' },
    { label: 'Courses', value: dashboard.classes.length, icon: 'book' },
  ] satisfies { label: string; value: number; icon: IconName }[]

  return (
    <>
      <section className="metrics-grid" aria-label="Class statistics">
        {metrics.map((metric, index) => (
          <article className={`metric-card metric-card-${index + 1}`} key={metric.label}>
            <span className="metric-icon"><Icon name={metric.icon} size={16} /></span>
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
