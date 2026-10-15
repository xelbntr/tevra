import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, supabase, supabaseConfigurationError } from './supabase'

export function AuthGate({ children }: { children: (session: Session) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    // INITIAL_SESSION restores saved login; later events include token refreshes
    // and sign-outs, including changes made in another browser tab.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setInitializing(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw error
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not sign in. Please try again.')
    } finally {
      setPassword('')
      setSubmitting(false)
    }
  }

  if (!supabaseConfigurationError && !initializing && session) return children(session)

  return (
    <main className="app-frame">
      <section className="dashboard-shell auth-shell">
        <div className="auth-card">
          <div className="brand-mark"><span className="brand-symbol">L</span><span className="brand-name">learnly</span></div>
          {supabaseConfigurationError ? (
            <>
              <h1>Finish setting up Learnly</h1>
              <p role="alert">{supabaseConfigurationError}</p>
            </>
          ) : initializing ? (
            <p role="status">Restoring your session…</p>
          ) : (
            <>
              <h1>Welcome back</h1>
              <p>Sign in to see your classes and students.</p>
              <form className="auth-form" onSubmit={signIn} aria-busy={submitting}>
                <label htmlFor="login-email">Email</label>
                <input id="login-email" type="email" autoComplete="username" required value={email}
                  onChange={(event) => setEmail(event.target.value)} disabled={submitting} />
                <label htmlFor="login-password">Password</label>
                <input id="login-password" type="password" autoComplete="current-password" required value={password}
                  onChange={(event) => setPassword(event.target.value)} disabled={submitting} />
                {error && <p className="error-message" role="alert">{error}</p>}
                <button className="primary-button" type="submit" disabled={submitting}>
                  {submitting ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
