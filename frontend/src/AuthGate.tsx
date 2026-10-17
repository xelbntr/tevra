import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { createAccount, getSupabase, supabase, supabaseConfigurationError } from './supabase'
import { sessionCache } from './sessionCache'

export function AuthGate({ children }: { children: (session: Session) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [email, setEmail] = useState('')
  const [emailInvalid, setEmailInvalid] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const passwordInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (message && mode === 'signin' && !submitting) passwordInput.current?.focus()
  }, [message, mode, submitting])

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
    setMessage('')
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
      const { data, error } = await createAccount(email.trim(), password)
      if (error) throw error
      if (!data.session) {
        throw new Error('Account creation could not be completed. Please try again.')
      }
      setEmail(email.trim())
      setEmailInvalid(false)
      setMode('signin')
      setMessage('Account successfully created. Please log in.')
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
              {message && <div className="auth-success" role="status" aria-live="polite" aria-atomic="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="m8 12 3 3 5-6" />
                </svg>
                <p>{message}</p>
              </div>}
              <form key={mode} id={`${mode}-form`} className="auth-form" onSubmit={mode === 'signin' ? signIn : signUp} aria-busy={submitting}>
                <label htmlFor={`${mode}-email`}>Email</label>
                <input id={`${mode}-email`} name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required value={email}
                  aria-invalid={emailInvalid || undefined} aria-describedby={emailInvalid ? `${mode}-email-error` : undefined}
                  onFocus={() => setEmailInvalid(false)}
                  onBlur={(event) => setEmailInvalid(!event.currentTarget.validity.valid)}
                  onInvalid={(event) => {
                    // Keep native submission blocking, but render feedback only after blur.
                    event.preventDefault()
                  }}
                  onChange={(event) => setEmail(event.target.value)} disabled={submitting} />
                {emailInvalid && <p id={`${mode}-email-error`} className="auth-field-error" role="alert">Email is invalid</p>}
                <label htmlFor={`${mode}-password`}>Password</label>
                <input ref={passwordInput} id={`${mode}-password`} name={mode === 'signin' ? 'password' : 'new-password'} type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required minLength={6} value={password}
                  onChange={(event) => setPassword(event.target.value)} disabled={submitting} />
                {mode === 'signup' && <>
                  <label htmlFor="confirm-password">Confirm password</label>
                  <input id="confirm-password" name="confirm-password" type="password" autoComplete="new-password" required minLength={6} value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)} disabled={submitting} />
                </>}
                {error && <p className="error-message" role="alert">{error}</p>}
                <button className="primary-button" type="submit" disabled={submitting}>
                  {submitting ? (mode === 'signin' ? 'Signing in…' : 'Creating account…') : (mode === 'signin' ? 'Sign in' : 'Sign up')}
                </button>
              </form>
              <p className="auth-switch">
                {mode === 'signin' ? 'New to Tevra?' : 'Already have an account?'}{' '}
                <button className="text-button" type="button" disabled={submitting} onClick={() => {
                  setMode(mode === 'signin' ? 'signup' : 'signin')
                  setEmailInvalid(false)
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
