import { readState } from './api.ts'

export interface RosterTeam {
  id: string
  name: string
  players: Array<{ id: string; name: string; seed: 1 | 2 }>
}

export interface Roster {
  tournamentId: string
  tournamentName: string
  teams: RosterTeam[]
}

/** The tournament's identity, teams, players, and seeds, in a stable order. */
export async function readRoster(): Promise<Roster> {
  const { snapshot } = await readState()
  const teams = snapshot.teams
    .map((team) => ({
      id: team.id,
      name: team.name,
      players: snapshot.players
        .filter((player) => player.team_id === team.id)
        .map(({ id, name, seed }) => ({ id, name, seed }))
        .sort((first, second) => first.id.localeCompare(second.id)),
    }))
    .sort((first, second) => first.id.localeCompare(second.id))
  return { tournamentId: snapshot.tournament.id, tournamentName: snapshot.tournament.name, teams }
}

/** Describes why the roster cannot run the suite, or null when it can. */
export function rosterProblem(roster: Roster): string | null {
  if (roster.teams.length !== 4) return `expected 4 teams, found ${roster.teams.length}`
  for (const team of roster.teams) {
    const seedOne = team.players.filter((player) => player.seed === 1).length
    const seedTwo = team.players.filter((player) => player.seed === 2).length
    if (seedOne !== 2 || seedTwo !== 2) {
      return `${team.name} needs two players at each seed, found ${seedOne} at seed 1 and ${seedTwo} at seed 2`
    }
  }
  return null
}
