import { useEffect, useId, useRef, useState } from 'react'

export function AccountMenu({ email, signingOut, onSignOut }: {
  email: string | undefined
  signingOut: boolean
  onSignOut: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    function dismissOutside(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [open])

  return (
    <div className="account-controls" ref={containerRef} onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}>
      <button
        className="profile-button"
        type="button"
        ref={triggerRef}
        aria-label="Account"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(value => !value)}
      >
        <img className="profile-image" src="/account/profile.svg" width="100" height="100" alt="" />
      </button>
      {open && (
        <div className="account-popup" id={panelId} role="dialog" aria-label="Account">
          <div className="account-details">
            <p className="account-label">Email</p>
            <p className="account-email">{email || 'Email unavailable'}</p>
          </div>
          <button
            className="sign-out-button"
            type="button"
            disabled={signingOut}
            aria-busy={signingOut}
            onClick={onSignOut}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  )
}
