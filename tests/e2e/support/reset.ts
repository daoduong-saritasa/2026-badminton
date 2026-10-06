import { runMaintenance } from '../../../scripts/reset-tournament.ts'
import { localTarget } from './target.ts'

const confirmationPattern = /^Type (.+) to continue: $/

function maintenanceEnvironment(): NodeJS.ProcessEnv {
  const target = localTarget()
  return {
    BADMINTON_MAINTENANCE_URL: target.apiUrl,
    BADMINTON_MAINTENANCE_SERVICE_ROLE_KEY: target.serviceRoleKey,
  }
}

const silentIo = {
  write: () => undefined,
  confirm: async (prompt: string) => {
    const phrase = confirmationPattern.exec(prompt)?.[1]
    if (!phrase) throw new Error(`Unexpected maintenance prompt: ${prompt}`)
    return phrase
  },
}

/**
 * Clears all play on the local tournament and returns it to setup, keeping the
 * roster, fixtures, courts, and PINs. Leaves reset disabled afterwards, even
 * when the reset fails.
 */
export async function resetProgress(): Promise<void> {
  const environment = maintenanceEnvironment()
  await runMaintenance({ kind: 'enable' }, environment, silentIo)
  try {
    await runMaintenance({ kind: 'reset', mode: 'progress' }, environment, silentIo)
  } finally {
    await runMaintenance({ kind: 'disable' }, environment, silentIo)
  }
}
