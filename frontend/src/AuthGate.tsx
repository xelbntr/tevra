import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, supabase, supabaseConfigurationError } from './supabase'
import { sessionCache } from './sessionCache'

export function AuthGate({ children }: { children: (session: Session) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!supabase) return
    // INITIAL_SESSION restores saved login; later events include token refreshes
    // and sign-outs, including changes made in another browser tab.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      sessionCache.setOwner(nextSession?.user.id ?? null)
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

  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const { data, error } = await getSupabase().auth.signUp({ email: email.trim(), password })
      if (error) throw error
      if (!data.session) {
        setMessage('Account created. Check your email for a confirmation link, then sign in.')
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not create your account. Please try again.')
    } finally {
      setPassword('')
      setConfirmPassword('')
      setSubmitting(false)
    }
  }

  if (!supabaseConfigurationError && !initializing && session) return children(session)

  return (
    <main className="app-frame">
      <section className="dashboard-shell auth-shell">
        <div className="auth-card">
          <div className="brand-mark"><img className="brand-icon" src="/tevra-app-icon.svg" alt="Tevra" /></div>
          {supabaseConfigurationError ? (
            <>
              <h1>Finish setting up Tevra</h1>
              <p role="alert">{supabaseConfigurationError}</p>
            </>
          ) : initializing ? (
            <p role="status">Restoring your session…</p>
          ) : (
            <>
              <h1>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
              <p>{mode === 'signin' ? 'Sign in to see your classes and students.' : 'Sign up with your email to get started.'}</p>
              <form key={mode} id={`${mode}-form`} className="auth-form" onSubmit={mode === 'signin' ? signIn : signUp} aria-busy={submitting}>
                <label htmlFor={`${mode}-email`}>Email</label>
                <input id={`${mode}-email`} name="email" type="email" autoComplete={mode === 'signin' ? 'username' : 'email'} required value={email}
                  onChange={(event) => setEmail(event.target.value)} disabled={submitting} />
                <label htmlFor={`${mode}-password`}>Password</label>
                <input id={`${mode}-password`} name={mode === 'signin' ? 'password' : 'new-password'} type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required minLength={6} value={password}
                  onChange={(event) => setPassword(event.target.value)} disabled={submitting} />
                {mode === 'signup' && <>
                  <label htmlFor="confirm-password">Confirm password</label>
                  <input id="confirm-password" name="confirm-password" type="password" autoComplete="new-password" required minLength={6} value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)} disabled={submitting} />
                </>}
                {error && <p className="error-message" role="alert">{error}</p>}
                {message && <p role="status">{message}</p>}
                <button className="primary-button" type="submit" disabled={submitting}>
                  {submitting ? (mode === 'signin' ? 'Signing in…' : 'Creating account…') : (mode === 'signin' ? 'Sign in' : 'Sign up')}
                </button>
              </form>
              <p className="auth-switch">
                {mode === 'signin' ? 'New to Tevra?' : 'Already have an account?'}{' '}
                <button className="text-button" type="button" disabled={submitting} onClick={() => {
                  setMode(mode === 'signin' ? 'signup' : 'signin')
                  setPassword('')
                  setConfirmPassword('')
                  setError('')
                  setMessage('')
                }}>
                  {mode === 'signin' ? 'Sign up' : 'Sign in'}
                </button>
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
