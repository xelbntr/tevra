import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getSupabase } from './supabase'
import './SampleWorkspace.css'

// Mount once per authenticated user, before any classroom view can fetch data.
export function SampleWorkspace({ children, onSignOut }: {
  children: (sampleData: boolean) => ReactNode
  onSignOut: () => Promise<void>
}) {
  const [sampleData, setSampleData] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        const { data, error } = await getSupabase().rpc('ensure_sample_workspace')
        if (error) throw error
        if (typeof data !== 'boolean') throw new Error('Invalid workspace response')
        if (active) setSampleData(data)
      } catch {
        if (active) setError('We could not prepare your classroom workspace. Please try again.')
      }
    }
    void initialize()
    return () => { active = false }
  }, [attempt])

  async function signOut() {
    setSigningOut(true)
    try { await onSignOut() }
    catch { setError('Could not sign out. Please try again.') }
    finally { setSigningOut(false) }
  }

  if (sampleData !== null) return children(sampleData)

  return (
    <main className="app-frame">
      <section className="dashboard-shell workspace-setup" aria-label="Classroom setup">
        <div className="workspace-setup-card">
          <img src="/tevra-app-icon.svg" width="48" height="48" alt="Tevra" />
          <h1>{error ? 'Your workspace needs another try' : 'Preparing your classroom'}</h1>
          {error ? <p role="alert">{error}</p> : <p role="status">Getting your workspace ready. New accounts start with fictional sample classes, students, grades, and attendance.</p>}
          <div className="workspace-setup-actions">
            {error && <button type="button" onClick={() => { setError(''); setAttempt(value => value + 1) }}>Try again</button>}
            <button type="button" disabled={signingOut} onClick={signOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
          </div>
        </div>
      </section>
    </main>
  )
}
