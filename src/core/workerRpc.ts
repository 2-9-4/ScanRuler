// SPDX-License-Identifier: AGPL-3.0-only
/** Request failures and worker failures are different: an ordinary error
 *  rejects one job; a dead worker must release every waiter and stay dead until
 *  its owner has recreated the worker and restored any required state. */
export class WorkerRpc {
  private worker: Worker | null = null
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  /** Settles once every request sent so far has been answered or let go —
   *  where a later request's time limit starts. */
  private before: Promise<void> = Promise.resolve()
  dead = false
  onFailure: ((message: string) => void) | null = null

  constructor(private create: () => Worker, private name: string, private event?: (message: unknown) => boolean) {
    this.restart()
  }

  restart(): void {
    if (this.worker) this.fail(`${this.name} was restarted.`)
    const worker = this.create()
    this.worker = worker
    this.dead = false
    worker.onmessage = ({ data }) => {
      if (this.worker !== worker || this.dead) return
      if (this.event?.(data)) return
      const entry = this.pending.get(data.requestId)
      if (!entry) return
      this.pending.delete(data.requestId)
      if (data.type === 'error') entry.reject(new Error(data.message))
      else entry.resolve(data)
    }
    worker.onerror = (error) => {
      error.preventDefault?.()
      this.fail(`${this.name} failed${error.message ? `: ${error.message}` : '.'}`)
    }
    worker.onmessageerror = () => this.fail(`${this.name} returned an unreadable response.`)
  }

  fail(message: string): void {
    this.dead = true
    const worker = this.worker
    this.worker = null
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null
      worker.terminate()
    }
    const entries = [...this.pending.values()]
    this.pending.clear()
    for (const entry of entries) entry.reject(new Error(message))
    this.onFailure?.(message)
  }

  /** Ask the worker; resolves with its answer. With `limitMs`, a request not
   *  answered that long after the ones sent before it were — a worker runs
   *  them one at a time, so the clock starts when it can get to this one —
   *  is let go: it rejects saying which request it was, and an answer that
   *  comes later is dropped. */
  request<T>(message: { requestId: number }, transfer: Transferable[] = [], limitMs?: number): Promise<T> {
    if (this.dead || !this.worker) return Promise.reject(new Error(`${this.name} is unavailable. Retry the operation.`))
    const id = message.requestId
    let timer: ReturnType<typeof setTimeout> | undefined
    const answer = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject })
      try { this.worker!.postMessage(message, transfer) }
      catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    const settled = answer.then(() => {}, () => {})
    if (limitMs !== undefined) {
      void this.before.then(() => {
        if (!this.pending.has(id)) return
        timer = setTimeout(() => {
          const entry = this.pending.get(id)
          if (!entry) return
          this.pending.delete(id)
          const what = (message as { type?: unknown }).type
          entry.reject(new Error(`${this.name} did not answer${typeof what === 'string' ? ` the "${what}" request` : ''} in ${limitMs / 1000} s; it was let go.`))
        }, limitMs)
      })
    }
    this.before = Promise.all([this.before, settled]).then(() => {})
    return answer.finally(() => clearTimeout(timer))
  }

  post(message: unknown): void { this.worker?.postMessage(message) }
  dispose(): void {
    this.onFailure = null
    this.fail(`${this.name} was shut down.`)
  }
}

/** A worker's answer to the page — called inside the worker. The buffers in
 *  `transfer` are handed over rather than copied. */
export function reply(msg: unknown, transfer: Transferable[] = []): void {
  ;(self as unknown as Worker).postMessage(msg, transfer)
}
