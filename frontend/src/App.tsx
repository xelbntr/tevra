import { useEffect, useState } from 'react'
import type { FormEvent, MouseEvent, SVGProps } from 'react'
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

const metrics = [
  { label: 'Students', value: '32', icon: 'person' },
  { label: 'Average Grade', value: '82.5', icon: 'book' },
  { label: 'Attendance', value: '94%', icon: 'calendar' },
] satisfies { label: string; value: string; icon: IconName }[]

const navigation = [
  { label: 'Dashboard', icon: 'grid', href: '/dashboard' },
  { label: 'Assignments', icon: 'calendar', href: '/assignments' },
  { label: 'Grading', icon: 'grading', href: '/grading' },
  { label: 'Reports', icon: 'report', href: '/reports' },
] satisfies { label: string; icon: IconName; href: string }[]

function App() {
  const [pathname, setPathname] = useState(window.location.pathname)
  const [prompt, setPrompt] = useState('')
  const [notice, setNotice] = useState('')

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
          <button className="profile-button" type="button" aria-label="Profile" onClick={() => showNotice('Profile settings are coming soon.')}>
            <Icon name="person" size={20} />
          </button>
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

export default App
