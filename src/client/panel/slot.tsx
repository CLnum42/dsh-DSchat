/**
 * The slot entry: the DSchat panel behind its own crash fence.
 *
 * The shell already contains a throwing entry — a failed slot render is caught
 * per entry and logged as `slot entry crashed in '<slot>'`, which is why this
 * plugin must never let an error escape `apply` — but that containment is the
 * HOST's, and it is total: the entry goes blank and the reader is left with an
 * empty center column and no way to tell "the panel is broken" from "the panel
 * has nothing to show". A fence of our own keeps the failure legible — one
 * localized sentence plus the error message — and keeps the sidebar entry, the
 * composer and everything else on the page untouched.
 *
 * It is deliberately a class component: `componentDidCatch` /
 * `getDerivedStateFromError` have no hook equivalent.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { DSchatPanel, type DSchatPanelProps } from './DSchatPanel.tsx'

/** Props of the fence: one already-localized sentence, and what to guard. */
interface CrashFenceProps {
  readonly message: string
  readonly children: ReactNode
}

interface CrashFenceState {
  readonly error?: Error
}

/** Renders its children, or a localized notice once one of them has thrown. */
class CrashFence extends Component<CrashFenceProps, CrashFenceState> {
  override state: CrashFenceState = {}

  static getDerivedStateFromError(error: Error): CrashFenceState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The only channel left once the panel is down: the host prints slot-entry
    // crashes, and this keeps the component stack beside ours instead of
    // replacing it.
    console.error('[dsh-dschat] panel crashed:', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === undefined) return this.props.children
    return (
      <div className="dsh-dschat-panel dsh-dschat-crash" role="alert">
        <p className="dsh-dschat-crash-message">{this.props.message}</p>
        <pre className="dsh-dschat-crash-detail">{error.message}</pre>
      </div>
    )
  }
}

/**
 * Mount the panel under the fence.
 * @param props - the slot props the shell passes to the `main` entry.
 */
export function DSchatSlot(props: DSchatPanelProps): ReactNode {
  return (
    <CrashFence message={props.tt('panel.crashed')}>
      <DSchatPanel {...props} />
    </CrashFence>
  )
}
