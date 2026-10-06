import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

export interface StaffPins {
  organizer: string
  referee: string
}

function fromEnvFile(name: string): Record<string, string | undefined> {
  const file = path.join(projectRoot, name)
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}
}

/**
 * The organizer and referee PINs provisioned on the local stack, from
 * `E2E_ORGANIZER_PIN` and `E2E_REFEREE_PIN`. The process environment wins,
 * then `.env.local`. No other key is read from that file.
 */
export function staffPins(): StaffPins {
  const file = fromEnvFile('.env.local')
  const organizer = process.env.E2E_ORGANIZER_PIN ?? file.E2E_ORGANIZER_PIN
  const referee = process.env.E2E_REFEREE_PIN ?? file.E2E_REFEREE_PIN
  if (!organizer || !referee) {
    throw new Error('Set E2E_ORGANIZER_PIN and E2E_REFEREE_PIN in the environment or in .env.local')
  }
  return { organizer, referee }
}
