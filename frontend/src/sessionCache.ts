type Entry = { promise: Promise<unknown>; controller: AbortController }

// Private data lives only in this browser page and is discarded on sign-out.
// Token refreshes keep the same owner, so they do not evict useful data.
export class SessionCache {
  private owner: string | null = null
  private entries = new Map<string, Entry>()
  private revision = 0

  get version() { return this.revision }

  accepts(version: number) {
    return this.revision === version
  }

  get<T>(key: string): Promise<T> | undefined {
    return this.entries.get(key)?.promise as Promise<T> | undefined
  }

  setOwner(owner: string | null) {
    if (owner === this.owner) return
    this.clear()
    this.owner = owner
  }

  clear() {
    this.revision += 1
    for (const entry of this.entries.values()) entry.controller.abort()
    this.entries.clear()
  }

  load<T>(key: string, loader: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    let entry = this.entries.get(key)
    if (!entry) {
      const controller = new AbortController()
      const created: Entry = {
        controller,
        promise: Promise.resolve().then(() => {
          controller.signal.throwIfAborted()
          return loader(controller.signal)
        }).then(value => {
          controller.signal.throwIfAborted()
          return value
        }).catch(error => {
          // Failed loads may be retried; old requests cannot remove newer entries.
          if (this.entries.get(key) === created) this.entries.delete(key)
          throw error
        }),
      }
      entry = created
      this.entries.set(key, entry)
    }
    // Leaving one tab cancels that subscriber, not a load shared by other tabs.
    return withCancellation(entry.promise as Promise<T>, signal)
  }
}

function withCancellation<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => {
      signal.removeEventListener('abort', abort)
      if (!signal.aborted) resolve(value)
    }, error => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
  })
}

export const sessionCache = new SessionCache()
