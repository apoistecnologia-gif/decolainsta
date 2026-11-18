'use client'

import { type ReactNode, useSyncExternalStore } from 'react'

/** True only after the component has mounted on the client. Use to gate browser-only values. */
const subscribeToMount = () => () => undefined

export function useMounted(): boolean {
  // false during SSR/hydration, true after client mount; no render-triggering effect.
  return useSyncExternalStore(subscribeToMount, () => true, () => false)
}

/**
 * Renders children only after client mount, so SSR output stays deterministic.
 * Use for anything that differs between server and client (window/localStorage reads,
 * user timezone/locale values, random ids, live clocks, third-party widgets).
 * Pass a `fallback` matching the final size to avoid layout shift.
 */
export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const mounted = useMounted()
  return <>{mounted ? children : fallback}</>
}
