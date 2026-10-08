import { useSyncExternalStore } from 'react'

export type Locale = 'vi' | 'en'

const storageKey = 'badminton:locale'
const listeners = new Set<() => void>()

/** The device's saved choice; storage may be unavailable, which means Vietnamese. */
function storedLocale(): Locale {
  try {
    return window.localStorage.getItem(storageKey) === 'en' ? 'en' : 'vi'
  } catch {
    return 'vi'
  }
}

let current: Locale = typeof window === 'undefined' ? 'vi' : storedLocale()
if (typeof document !== 'undefined') document.documentElement.lang = current

export function currentLocale(): Locale {
  return current
}

/** Switches the interface language and remembers it on this device. */
export function setLocale(next: Locale): void {
  if (next === current) return
  current = next
  try {
    window.localStorage.setItem(storageKey, next)
  } catch {
    // The switch still applies until the page reloads.
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next
  for (const listener of listeners) listener()
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, currentLocale, () => 'vi')
}
