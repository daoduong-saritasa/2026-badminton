import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, Minus, Plus } from 'lucide-react'

import { mutateTournament } from '@/data/tournament'
import { isValidGroupSplit } from '@/domain/setup'
import type { CourtCount, Group, Seed, SetupInput, SetupPairInput, TournamentSnapshot } from '@/domain/types'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { errorMessage } from '@/i18n/errors'
import { messages } from '@/i18n/vi'

function blankPair(index: number, count: number): SetupPairInput {
  const group: Group = index < Math.ceil(count / 2) ? 'A' : 'B'
  return {
    teamName: null,
    group,
    players: [{ name: '', seed: 1 }, { name: '', seed: 2 }],
  }
}

function setupFromSnapshot(snapshot: TournamentSnapshot | null): SetupInput {
  if (snapshot === null) {
    return {
      tournamentName: '',
      pairs: Array.from({ length: 4 }, (_, index) => blankPair(index, 4)),
      courtCount: null,
    }
  }
  const playerById = new Map(snapshot.players.map((player) => [player.id, player]))
  return {
    tournamentName: snapshot.tournament.name,
    courtCount: snapshot.tournament.courtCount,
    pairs: snapshot.pairs.map((pair) => {
      const playerA = playerById.get(pair.playerAId)
      const playerB = playerById.get(pair.playerBId)
      return {
        teamName: pair.teamName,
        group: pair.group,
        players: [
          { name: playerA?.name ?? '', seed: playerA?.seed ?? 1 },
          { name: playerB?.name ?? '', seed: playerB?.seed ?? 2 },
        ],
      }
    }),
  }
}

export function SetupForm({ snapshot, resetGeneration }: { snapshot: TournamentSnapshot | null; resetGeneration: number }) {
  const initial = useMemo(() => setupFromSnapshot(snapshot), [snapshot])
  const [setup, setSetup] = useState(initial)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const locked = snapshot !== null && (snapshot.tournament.setupLockedAt !== null
    || snapshot.matches.some((match) => match.state !== 'unstarted'))
  const hasFixtures = (snapshot?.matches.length ?? 0) > 0
  const sameSeedPairs = setup.pairs.filter((pair) => pair.players[0].seed === pair.players[1].seed)
  const groupsValid = isValidGroupSplit(setup.pairs)
  const valid = setup.tournamentName.trim().length > 0
    && setup.pairs.length >= 4
    && setup.pairs.length <= 10
    && groupsValid
    && setup.pairs.every((pair) => pair.players.every((player) => player.name.trim().length > 0))

  const saveMutation = useMutation({
    mutationFn: () => mutateTournament('save_setup', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: snapshot?.tournament.version ?? 0,
      payload: {
        setup: {
          tournamentName: setup.tournamentName.trim(),
          courtCount: setup.courtCount,
          pairs: setup.pairs.map((pair) => ({
            ...pair,
            teamName: pair.teamName?.trim() || null,
            players: [
              { ...pair.players[0], name: pair.players[0].name.trim() },
              { ...pair.players[1], name: pair.players[1].name.trim() },
            ],
          })),
        },
      },
    }),
    onSuccess: () => setConfirmationOpen(false),
  })

  const updatePair = (index: number, update: (pair: SetupPairInput) => SetupPairInput) => {
    setSetup((current) => ({
      ...current,
      pairs: current.pairs.map((pair, pairIndex) => pairIndex === index ? update(pair) : pair),
    }))
  }

  const updatePlayer = (pairIndex: number, playerIndex: 0 | 1, field: 'name' | 'seed', value: string) => {
    updatePair(pairIndex, (pair) => {
      const players: SetupPairInput['players'] = [{ ...pair.players[0] }, { ...pair.players[1] }]
      players[playerIndex] = field === 'seed'
        ? { ...players[playerIndex], seed: Number(value) as Seed }
        : { ...players[playerIndex], name: value }
      return { ...pair, players }
    })
  }

  const addPair = () => {
    setSetup((current) => {
      const groupACount = current.pairs.filter((pair) => pair.group === 'A').length
      const groupBCount = current.pairs.length - groupACount
      const group: Group = groupACount <= groupBCount ? 'A' : 'B'
      return {
        ...current,
        pairs: [...current.pairs, { ...blankPair(current.pairs.length, current.pairs.length + 1), group }],
      }
    })
  }

  const removePair = (index: number) => {
    setSetup((current) => ({
      ...current,
      pairs: current.pairs.filter((_, pairIndex) => pairIndex !== index),
    }))
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!valid || locked) return
    if (hasFixtures) setConfirmationOpen(true)
    else saveMutation.mutate()
  }

  return (
    <section className="rounded-card border border-ink/5 bg-white p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{messages.setup.heading}</h3>
          <p className="mt-1.5 text-[0.6875rem] text-muted-ink">{messages.setup.description}</p>
        </div>
        <Badge variant="secondary">{setup.pairs.length} pairs</Badge>
      </div>

      {locked ? (
        <Alert className="mt-4 rounded-field">
          <AlertTriangle />
          <AlertTitle>{messages.setup.lockedTitle}</AlertTitle>
          <AlertDescription>{messages.setup.lockedBody}</AlertDescription>
        </Alert>
      ) : null}
      {sameSeedPairs.length > 0 ? (
        <Alert className="mt-4 rounded-field border-peach-line bg-[#fff7f3]">
          <AlertTriangle />
          <AlertTitle>{messages.setup.seedAdvisoryTitle}</AlertTitle>
          <AlertDescription>{messages.setup.seedAdvisory(sameSeedPairs.length)}</AlertDescription>
        </Alert>
      ) : null}

      <form className="mt-5 space-y-5" onSubmit={submit}>
        <div className="space-y-2">
          <Label htmlFor="tournament-name">{messages.setup.tournamentName}</Label>
          <Input
            id="tournament-name"
            value={setup.tournamentName}
            disabled={locked}
            onChange={(event) => setSetup((current) => ({ ...current, tournamentName: event.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="court-count">{messages.setup.courts}</Label>
          <Select
            value={setup.courtCount === null ? '' : String(setup.courtCount)}
            disabled={locked}
            onValueChange={(value) => setSetup((current) => ({ ...current, courtCount: Number(value) as CourtCount }))}
          >
            <SelectTrigger id="court-count" className="w-full sm:w-56">
              <SelectValue placeholder={messages.setup.selectCourts} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">{messages.setup.courtOption(1)}</SelectItem>
              <SelectItem value="2">{messages.setup.courtOption(2)}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-ink">{messages.setup.courtsHint}</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {setup.pairs.map((pair, pairIndex) => (
            <fieldset key={pairIndex} className="rounded-field border border-hairline p-4" disabled={locked}>
              <legend className="sr-only">{messages.setup.pairLegend(pairIndex + 1)}</legend>
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="numeric text-[0.625rem] text-dim-ink">{String(pairIndex + 1).padStart(2, '0')}</span>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={messages.setup.removePair(pairIndex + 1)}
                  disabled={setup.pairs.length <= 4}
                  onClick={() => removePair(pairIndex)}
                >
                  <Minus />
                </Button>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_7.5rem]">
                <Input
                  aria-label={messages.setup.teamNameLabel(pairIndex + 1)}
                  placeholder={messages.setup.teamNamePlaceholder}
                  value={pair.teamName ?? ''}
                  onChange={(event) => updatePair(pairIndex, (current) => ({ ...current, teamName: event.target.value }))}
                />
                <Select
                  value={pair.group}
                  disabled={locked}
                  onValueChange={(value) => updatePair(pairIndex, (current) => ({ ...current, group: value as Group }))}
                >
                  <SelectTrigger
                    className="w-full"
                    tone={pair.group === 'A' ? 'groupA' : 'groupB'}
                    aria-label={messages.setup.groupFor(pairIndex + 1)}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">{messages.common.group('A')}</SelectItem>
                    <SelectItem value="B">{messages.common.group('B')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {[0, 1].map((playerIndex) => (
                <div className="mt-2.5 grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_7.5rem]" key={playerIndex}>
                  <Input
                    aria-label={messages.setup.playerLabel(pairIndex + 1, playerIndex + 1)}
                    placeholder={messages.setup.playerPlaceholder(playerIndex + 1)}
                    value={pair.players[playerIndex as 0 | 1].name}
                    onChange={(event) => updatePlayer(pairIndex, playerIndex as 0 | 1, 'name', event.target.value)}
                  />
                  <Select
                    value={String(pair.players[playerIndex as 0 | 1].seed)}
                    disabled={locked}
                    onValueChange={(value) => updatePlayer(pairIndex, playerIndex as 0 | 1, 'seed', value)}
                  >
                    <SelectTrigger className="w-full" aria-label={messages.setup.seedFor(pairIndex + 1, playerIndex + 1)}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">{messages.setup.seedOption(1)}</SelectItem>
                      <SelectItem value="2">{messages.setup.seedOption(2)}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </fieldset>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" disabled={locked || setup.pairs.length >= 10} onClick={addPair}>
            <Plus /> {messages.setup.addPair}
          </Button>
          <Button disabled={locked || !valid || saveMutation.isPending}>
            {saveMutation.isPending ? messages.common.saving : messages.setup.save}
          </Button>
        </div>
        {!groupsValid ? <p className="text-sm text-destructive" role="alert">{messages.setup.groupsInvalid}</p> : null}
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
