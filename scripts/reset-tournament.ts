import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'

type ResetMode = 'progress' | 'all'
type MaintenanceAction = { kind: 'enable' } | { kind: 'disable' } | { kind: 'reset'; mode: ResetMode }

interface TournamentTarget {
  resetGeneration: number
  id: string
  name: string
  version: number
}

interface RpcResult {
  data: unknown
  error: { message: string } | null
}

interface MaintenanceClient {
  rpc(operation: string, body?: Record<string, unknown>): PromiseLike<RpcResult>
}

interface MaintenanceIo {
  write(message: string): void
  confirm(prompt: string): Promise<string>
}

export function parseMaintenanceAction(argv: readonly string[]): MaintenanceAction {
  const [action, flag, value, ...extra] = argv
  if (extra.length > 0) throw new Error('Unexpected maintenance arguments')
  if (action === 'enable' && flag === undefined) return { kind: 'enable' }
  if (action === 'disable' && flag === undefined) return { kind: 'disable' }
  if (action === 'reset' && flag === '--mode' && (value === 'progress' || value === 'all')) {
    return { kind: 'reset', mode: value }
  }
  throw new Error('Usage: npm run maintenance -- enable | disable | reset --mode progress|all')
}

export function targetHost(url: string): string {
  const parsed = new URL(url)
  return `${parsed.protocol}//${parsed.host}`
}

export function resetConfirmation(target: TournamentTarget, mode: ResetMode): string {
  return `RESET ${target.id} ${mode}`
}

function parseTarget(value: unknown): TournamentTarget {
  if (typeof value !== 'object' || value === null) throw new Error('Snapshot response is invalid')
  const state = value as { resetGeneration?: unknown; snapshot?: unknown }
  if (!Number.isInteger(state.resetGeneration) || typeof state.snapshot !== 'object' || state.snapshot === null) {
    throw new Error('No configured tournament was found')
  }
  const snapshot = state.snapshot as { tournament?: unknown }
  if (typeof snapshot.tournament !== 'object' || snapshot.tournament === null) throw new Error('Snapshot response is invalid')
  const tournament = snapshot.tournament as { id?: unknown; name?: unknown; version?: unknown }
  if (typeof tournament.id !== 'string' || typeof tournament.name !== 'string' || !Number.isInteger(tournament.version)) {
    throw new Error('Snapshot tournament is invalid')
  }
  return {
    resetGeneration: state.resetGeneration as number,
    id: tournament.id,
    name: tournament.name,
    version: tournament.version as number,
  }
}

async function checkedRpc(client: MaintenanceClient, operation: string, body?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.rpc(operation, body)
  if (error) throw new Error(`${operation} failed: ${error.message}`)
  return data
}

export async function runMaintenance(
  action: MaintenanceAction,
  environment: NodeJS.ProcessEnv,
  io: MaintenanceIo,
  makeClient: (url: string, serviceRoleKey: string) => MaintenanceClient = (url, key) => createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
): Promise<void> {
  const url = environment.BADMINTON_MAINTENANCE_URL
  const serviceRoleKey = environment.BADMINTON_MAINTENANCE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error('Set BADMINTON_MAINTENANCE_URL and BADMINTON_MAINTENANCE_SERVICE_ROLE_KEY')
  }
  const client = makeClient(url, serviceRoleKey)
  const host = targetHost(url)

  if (action.kind === 'enable' || action.kind === 'disable') {
    const enabled = action.kind === 'enable'
    await checkedRpc(client, 'set_reset_enabled', { p_enabled: enabled })
    io.write(`Reset ${enabled ? 'enabled' : 'disabled'} for ${host}`)
    return
  }

  const target = parseTarget(await checkedRpc(client, 'get_tournament_snapshot'))
  const clearing = action.mode === 'progress'
    ? 'scores, results, ownership, withdrawals, tie decisions, and progression'
    : 'all tournament setup, fixtures, and play data'
  const phrase = resetConfirmation(target, action.mode)
  io.write(`Target: ${host}`)
  io.write(`Tournament: ${target.name} (${target.id})`)
  io.write(`Mode: ${action.mode}; clears ${clearing}`)
  const answer = await io.confirm(`Type ${phrase} to continue: `)
  if (answer !== phrase) {
    io.write('Reset cancelled')
    return
  }

  const requestId = crypto.randomUUID()
  await checkedRpc(client, 'reset_tournament', {
    p_request_id: requestId,
    p_expected_generation: target.resetGeneration,
    p_expected_tournament_id: target.id,
    p_expected_version: target.version,
    p_mode: action.mode,
    p_confirmation_name: target.name,
  })
  io.write(`Reset ${action.mode} completed for ${target.name} on ${host}`)
}

async function main(): Promise<void> {
  const action = parseMaintenanceAction(process.argv.slice(2))
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    await runMaintenance(action, process.env, {
      write: (message) => process.stdout.write(`${message}\n`),
      confirm: (prompt) => readline.question(prompt),
    })
  } finally {
    readline.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Maintenance command failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
