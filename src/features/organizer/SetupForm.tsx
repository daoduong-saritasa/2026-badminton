import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'

import { mutateTournament } from '@/data/tournament'
import { validateRoster } from '@/domain/roster'
import type {
  RosterInput,
  RosterTeamInput,
  Team,
  TeamPlayer,
  TournamentSnapshot,
} from '@/domain/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessage } from '@/i18n/errors'
import { messages } from '@/i18n/vi'

type SetupIssue = keyof typeof messages.setup.issues

const seedsBySlot = [1, 1, 2, 2] as const

function blankTeam(): RosterTeamInput {
  return {
    name: '',
    players: [
      { name: '', seed: 1 },
      { name: '', seed: 1 },
      { name: '', seed: 2 },
      { name: '', seed: 2 },
    ],
  }
}

function rosterFromSnapshot(snapshot: TournamentSnapshot | null): RosterInput {
  if (snapshot === null || snapshot.teams.length === 0) {
    return {
      tournamentName: snapshot?.tournament.name ?? '',
      teams: Array.from({ length: 4 }, () => blankTeam()),
    }
  }
  return {
    tournamentName: snapshot.tournament.name,
    teams: snapshot.teams.map((team) => {
      const players = snapshot.players
        .filter((player) => player.teamId === team.id)
        .toSorted((first, second) => first.seed - second.seed)
      const slots = seedsBySlot.map((seed, index) => ({
        name: players[index]?.name ?? '',
        seed,
      })) as RosterTeamInput['players']
      return { name: team.name, players: slots }
    }),
  }
}

/**
 * The shared domain rule reads identities, so the form gives each draft team and
 * player a positional one. Names are checked here because the rule cannot see them.
 */
function rosterIssues(roster: RosterInput): SetupIssue[] {
  const teams: Team[] = roster.teams.map((team, index) => ({ id: `team-${index}`, name: team.name }))
  const players: TeamPlayer[] = roster.teams.flatMap((team, teamIndex) =>
    team.players.map((player, playerIndex) => ({
      id: `player-${teamIndex}-${playerIndex}`,
      teamId: `team-${teamIndex}`,
      name: player.name,
      seed: player.seed,
    })),
  )
  const issues = new Set<SetupIssue>(validateRoster(teams, players).map((issue) => issue.code))
  const names = [roster.tournamentName, ...roster.teams.flatMap((team) => [team.name, ...team.players.map((player) => player.name)])]
  if (names.some((name) => name.trim().length === 0)) issues.add('name-required')
  // Two players may share a name; two teams may not, because the server keys on it.
  const teamNames = roster.teams.map((team) => team.name.trim()).filter(Boolean)
  if (new Set(teamNames).size !== teamNames.length) issues.add('duplicate-name')
  return [...issues]
}

export function SetupForm({ snapshot, resetGeneration }: { snapshot: TournamentSnapshot | null; resetGeneration: number }) {
  const initial = useMemo(() => rosterFromSnapshot(snapshot), [snapshot])
  const [roster, setRoster] = useState(initial)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const locked = snapshot !== null && snapshot.tournament.stage !== 'setup'
  const hasLineups = (snapshot?.lineups.length ?? 0) > 0
  const issues = rosterIssues(roster)

  const saveMutation = useMutation({
    mutationFn: () => mutateTournament('save_roster', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: snapshot?.tournament.version ?? 0,
      payload: {
        tournamentName: roster.tournamentName.trim(),
        teams: roster.teams.map((team) => ({
          ...team,
          name: team.name.trim(),
          players: team.players.map((player) => ({ ...player, name: player.name.trim() })) as RosterTeamInput['players'],
        })),
      },
    }),
    onSuccess: () => setConfirmationOpen(false),
  })

  const updateTeam = (index: number, update: (team: RosterTeamInput) => RosterTeamInput) => {
    setRoster((current) => ({
      ...current,
      teams: current.teams.map((team, teamIndex) => teamIndex === index ? update(team) : team),
    }))
  }

  const updatePlayer = (teamIndex: number, playerIndex: number, name: string) => {
    updateTeam(teamIndex, (team) => ({
      ...team,
      players: team.players.map((player, index) => index === playerIndex ? { ...player, name } : player) as RosterTeamInput['players'],
    }))
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (issues.length > 0 || locked) return
    if (hasLineups) setConfirmationOpen(true)
    else saveMutation.mutate()
  }

  return (
    <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
      <div>
        <h3 className="text-sm font-semibold">{messages.setup.heading}</h3>
        <p className="mt-1.5 text-[0.6875rem] text-muted-ink">{messages.setup.description}</p>
      </div>

      {locked ? (
        <Alert className="mt-4 rounded-field">
          <AlertTriangle />
          <AlertTitle>{messages.setup.lockedTitle}</AlertTitle>
          <AlertDescription>{messages.setup.lockedBody}</AlertDescription>
        </Alert>
      ) : null}

      <form className="mt-5 space-y-5" onSubmit={submit}>
        <div className="space-y-2">
          <Label htmlFor="tournament-name">{messages.setup.tournamentName}</Label>
          <Input
            id="tournament-name"
            value={roster.tournamentName}
            disabled={locked}
            onChange={(event) => setRoster((current) => ({ ...current, tournamentName: event.target.value }))}
          />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {roster.teams.map((team, teamIndex) => (
            <fieldset key={teamIndex} className="rounded-field border border-hairline p-4" disabled={locked}>
              <legend className="sr-only">{messages.setup.teamLegend(teamIndex + 1)}</legend>
              <Input
                aria-label={messages.setup.teamNameLabel(teamIndex + 1)}
                placeholder={messages.setup.teamNamePlaceholder(teamIndex + 1)}
                value={team.name}
                onChange={(event) => updateTeam(teamIndex, (current) => ({ ...current, name: event.target.value }))}
              />
              {team.players.map((player, playerIndex) => (
                <div className="mt-2.5 grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2.5" key={playerIndex}>
                  <span className="text-[0.625rem] text-muted-ink">{messages.common.seed(player.seed)}</span>
                  <Input
                    aria-label={messages.setup.playerLabel(teamIndex + 1, playerIndex + 1)}
                    placeholder={messages.setup.playerPlaceholder(player.seed)}
                    value={player.name}
                    onChange={(event) => updatePlayer(teamIndex, playerIndex, event.target.value)}
                  />
                </div>
              ))}
            </fieldset>
          ))}
        </div>
        <div className="flex justify-end">
          <Button disabled={locked || issues.length > 0 || saveMutation.isPending}>
            {saveMutation.isPending ? messages.common.saving : messages.setup.save}
          </Button>
        </div>
        {!locked && issues.length > 0 ? (
          <ul className="space-y-1 text-sm text-destructive" role="alert">
            {issues.map((issue) => <li key={issue}>{messages.setup.issues[issue]}</li>)}
          </ul>
        ) : null}
        {saveMutation.isError ? <p className="text-sm text-destructive" role="alert">{errorMessage(saveMutation.error)}</p> : null}
      </form>

      <AlertDialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.setup.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{messages.setup.confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.setup.keepCurrent}</AlertDialogCancel>
            <AlertDialogAction onClick={() => saveMutation.mutate()}>{messages.setup.replace}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
