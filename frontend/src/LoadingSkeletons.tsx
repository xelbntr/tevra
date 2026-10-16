import type { ReactNode } from 'react'
import './LoadingSkeletons.css'

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <span className={`skeleton-block ${className}`} />
}

function LoadingState({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="loading-skeleton" role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <LoadingState label="Loading your dashboard…">
      <div className="metrics-grid">
        {[0, 1, 2, 3].map(index => (
          <div className="metric-card" key={index}>
            <div className="metric-icon"><SkeletonBlock className="skeleton-icon" /></div>
            <div className="metric-copy skeleton-stack">
              <SkeletonBlock className="skeleton-metric-value" />
              <SkeletonBlock className="skeleton-metric-label" />
            </div>
          </div>
        ))}
      </div>
      <div className="class-list">
        <h2>Your classes</h2>
        <ul>
          {[0, 1, 2].map(index => (
            <li className="skeleton-stack" key={index}>
              <SkeletonBlock className="skeleton-title" />
              <SkeletonBlock className="skeleton-detail" />
            </li>
          ))}
        </ul>
      </div>
    </LoadingState>
  )
}

export function AttendanceSkeleton({ showFilters = false }: { showFilters?: boolean }) {
  return (
    <LoadingState label={showFilters ? 'Loading your classes…' : 'Loading attendance…'}>
      <div className="attendance-page">
        {showFilters && (
          <div className="attendance-toolbar">
            {[0, 1].map(index => (
              <div className="skeleton-stack" key={index}>
                <SkeletonBlock className="skeleton-detail" />
                <SkeletonBlock className="skeleton-input" />
              </div>
            ))}
          </div>
        )}
        <div className="attendance-overview">
          <div className="attendance-overview-heading">
            <div className="skeleton-stack skeleton-heading">
              <SkeletonBlock className="skeleton-detail" />
              <SkeletonBlock className="skeleton-title" />
            </div>
            <SkeletonBlock className="skeleton-rate" />
          </div>
          <div className="attendance-stat-grid">
            {[0, 1, 2, 3].map(index => (
              <div className="attendance-stat" key={index}>
                <SkeletonBlock className="skeleton-detail" />
                <SkeletonBlock className="skeleton-number" />
              </div>
            ))}
          </div>
        </div>
        <div className="attendance-recap">
          <SkeletonBlock className="skeleton-title" />
          <div className="attendance-recap-items">
            {[0, 1, 2, 3, 4].map(index => <SkeletonBlock className="skeleton-recap" key={index} />)}
          </div>
        </div>
        <div className="attendance-roster">
          <SkeletonBlock className="skeleton-title" />
          <div className="skeleton-roster">
            {[0, 1, 2, 3, 4].map(index => (
              <div className="skeleton-roster-row" key={index}>
                <SkeletonBlock /><SkeletonBlock /><SkeletonBlock />
              </div>
            ))}
          </div>
        </div>
      </div>
    </LoadingState>
  )
}

export function GradesSkeleton() {
  return (
    <LoadingState label="Loading grades…">
      <div className="grades-skeleton">
        <div className="grades-card grades-toolbar">
          {[0, 1].map(index => (
            <div className="skeleton-stack" key={index}>
              <SkeletonBlock className="skeleton-detail" />
              <SkeletonBlock className="skeleton-input" />
            </div>
          ))}
          <SkeletonBlock className="skeleton-input grades-skeleton-action" />
        </div>
        <div className="grades-card grades-book">
          <div className="grades-book-heading">
            <SkeletonBlock className="skeleton-title" />
            <SkeletonBlock className="skeleton-detail grades-skeleton-count" />
          </div>
          <div className="grades-table-scroll">
            <div className="grades-skeleton-row grades-skeleton-table-heading">
              {[0, 1, 2, 3].map(index => (
                <div className="skeleton-stack" key={index}>
                  <SkeletonBlock className="skeleton-title" />
                  <SkeletonBlock className="skeleton-detail" />
                </div>
              ))}
            </div>
            {[0, 1, 2, 3, 4, 5].map(index => (
              <div className="grades-skeleton-row" key={index}>
                <div className="skeleton-stack">
                  <SkeletonBlock className="skeleton-title" />
                  <SkeletonBlock className="skeleton-detail" />
                </div>
                {[0, 1, 2].map(column => <SkeletonBlock className="grades-skeleton-score" key={column} />)}
              </div>
            ))}
          </div>
          <div className="grades-footnote"><SkeletonBlock className="skeleton-detail" /></div>
        </div>
      </div>
    </LoadingState>
  )
}

export function LoadingSelect({ loading, children }: { loading: boolean; children: ReactNode }) {
  return (
    <div className={`loading-select${loading ? ' is-loading' : ''}`}>
      {children}
      {loading && <span className="skeleton-block skeleton-select-placeholder" aria-hidden="true" />}
    </div>
  )
}

export function ReportSkeleton() {
  return (
    <LoadingState label="Reviewing this student’s recorded information…">
      <div className="report-skeleton">
        <div className="report-metrics">
          {[0, 1, 2].map(index => (
            <article key={index}>
              <SkeletonBlock className="skeleton-detail" />
              <SkeletonBlock className="skeleton-number" />
              <SkeletonBlock className="skeleton-detail" />
            </article>
          ))}
        </div>
        <div className="report-section skeleton-stack">
          <SkeletonBlock className="skeleton-title" />
          {[0, 1].map(index => (
            <div className="skeleton-paragraph skeleton-stack" key={index}>
              <SkeletonBlock className="skeleton-detail" />
              <SkeletonBlock /><SkeletonBlock /><SkeletonBlock className="skeleton-title" />
            </div>
          ))}
        </div>
      </div>
    </LoadingState>
  )
}
