import { localStatus } from '../../integration/local-supabase.ts'

const localHosts = new Set(['127.0.0.1', 'localhost'])

export interface LocalTarget {
  apiUrl: string
  anonKey: string
  serviceRoleKey: string
}

/**
 * The running local Supabase stack. Throws unless its API is on this machine,
 * because the suite resets tournament progress on whatever it targets.
 */
export function localTarget(): LocalTarget {
  const status = localStatus()
  const { hostname } = new URL(status.apiUrl)
  if (!localHosts.has(hostname)) {
    throw new Error(`Refusing to run end-to-end tests against ${hostname}; only a local stack is allowed`)
  }
  return status
}
