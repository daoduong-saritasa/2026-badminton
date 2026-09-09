import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, Minus, Plus } from 'lucide-react'

import { mutateTournament } from '@/data/tournament'
import type { Group, Seed, SetupInput, SetupPairInput, TournamentSnapshot } from '@/domain/types'
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
      pairs: Array.from({ length: 6 }, (_, index) => blankPair(index, 6)),
    }
  }
  const playerById = new Map(snapshot.players.map((player) => [player.id, player]))
  return {
    tournamentName: snapshot.tournament.name,
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

function normalizedGroups(pairs: SetupPairInput[]): SetupPairInput[] {
  const groupASize = Math.ceil(pairs.length / 2)
  return pairs.map((pair, index) => ({ ...pair, group: index < groupASize ? 'A' : 'B' }))
}

export function SetupForm({ snapshot }: { snapshot: TournamentSnapshot | null }) {
  const initial = useMemo(() => setupFromSnapshot(snapshot), [snapshot])
  const [setup, setSetup] = useState(initial)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const locked = snapshot !== null && (snapshot.tournament.setupLockedAt !== null
    || snapshot.matches.some((match) => match.state !== 'unstarted'))
  const hasFixtures = (snapshot?.matches.length ?? 0) > 0
  const sameSeedPairs = setup.pairs.filter((pair) => pair.players[0].seed === pair.players[1].seed)
  const groupACount = setup.pairs.filter((pair) => pair.group === 'A').length
  const groupBCount = setup.pairs.length - groupACount
  const groupsValid = (setup.pairs.length === 6 && groupACount === 3 && groupBCount === 3)
    || (setup.pairs.length === 7 && groupACount === 4 && groupBCount === 3)
    || (setup.pairs.length === 8 && groupACount === 4 && groupBCount === 4)
  const valid = setup.tournamentName.trim().length > 0
    && setup.pairs.length >= 6
    && setup.pairs.length <= 8
    && groupsValid
    && setup.pairs.every((pair) => pair.players.every((player) => player.name.trim().length > 0))

  const saveMutation = useMutation({
    mutationFn: () => mutateTournament('save_setup', {
      requestId: crypto.randomUUID(),
      expectedVersion: snapshot?.tournament.version ?? 0,
      payload: {
        setup: {
          tournamentName: setup.tournamentName.trim(),
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
      const pairs = [...current.pairs, blankPair(current.pairs.length, current.pairs.length + 1)]
      return { ...current, pairs: normalizedGroups(pairs) }
    })
  }

  const removePair = (index: number) => {
    setSetup((current) => ({
      ...current,
      pairs: normalizedGroups(current.pairs.filter((_, pairIndex) => pairIndex !== index)),
    }))
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!valid || locked) return
    if (hasFixtures) setConfirmationOpen(true)
    else saveMutation.mutate()
  }

  return (
    <section className="rounded-[1.375rem] border bg-white p-5 shadow-[0_6px_0_rgb(15_43_41/0.03)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Players and groups</h3>
          <p className="mt-1 text-xs text-muted-foreground">Six to eight pairs, split 3+3, 4+3, or 4+4.</p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{setup.pairs.length} pairs</span>
      </div>

      {locked ? (
        <Alert className="mt-4">
          <AlertTriangle />
          <AlertTitle>Setup is locked</AlertTitle>
          <AlertDescription>Player and group changes stop after play begins.</AlertDescription>
        </Alert>
      ) : null}
      {sameSeedPairs.length > 0 ? (
        <Alert className="mt-4 border-[#e9a589] bg-[#fff7f3]">
          <AlertTriangle />
          <AlertTitle>Seed advisory</AlertTitle>
          <AlertDescription>{sameSeedPairs.length} pair(s) contain players with the same seed. You can still save.</AlertDescription>
        </Alert>
      ) : null}

      <form className="mt-5 space-y-5" onSubmit={submit}>
        <div className="space-y-2">
          <Label htmlFor="tournament-name">Tournament name</Label>
          <Input
            id="tournament-name"
            value={setup.tournamentName}
            disabled={locked}
            onChange={(event) => setSetup((current) => ({ ...current, tournamentName: event.target.value }))}
          />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {setup.pairs.map((pair, pairIndex) => (
            <fieldset key={pairIndex} className="rounded-xl border p-4" disabled={locked}>
              <legend className="sr-only">Pair {pairIndex + 1}</legend>
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">Pair {pairIndex + 1}</span>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove pair ${pairIndex + 1}`}
                  disabled={setup.pairs.length <= 6}
                  onClick={() => removePair(pairIndex)}
                >
                  <Minus />
                </Button>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
                <Input
                  aria-label={`Pair ${pairIndex + 1} team name`}
                  placeholder="Team name (optional)"
                  value={pair.teamName ?? ''}
                  onChange={(event) => updatePair(pairIndex, (current) => ({ ...current, teamName: event.target.value }))}
                />
                <select
                  className="h-9 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Group for pair ${pairIndex + 1}`}
                  value={pair.group}
                  onChange={(event) => updatePair(pairIndex, (current) => ({ ...current, group: event.target.value as Group }))}
                >
                  <option value="A">Group A</option>
                  <option value="B">Group B</option>
                </select>
              </div>
              {[0, 1].map((playerIndex) => (
                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_5rem] gap-2" key={playerIndex}>
                  <Input
                    aria-label={`Pair ${pairIndex + 1} player ${playerIndex + 1}`}
                    placeholder={`Player ${playerIndex + 1}`}
                    value={pair.players[playerIndex as 0 | 1].name}
                    onChange={(event) => updatePlayer(pairIndex, playerIndex as 0 | 1, 'name', event.target.value)}
                  />
                  <select
                    className="h-9 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Pair ${pairIndex + 1} player ${playerIndex + 1} seed`}
                    value={pair.players[playerIndex as 0 | 1].seed}
                    onChange={(event) => updatePlayer(pairIndex, playerIndex as 0 | 1, 'seed', event.target.value)}
                  >
                    <option value="1">Seed 1</option>
                    <option value="2">Seed 2</option>
                  </select>
                </div>
              ))}
            </fieldset>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" disabled={locked || setup.pairs.length >= 8} onClick={addPair}>
            <Plus /> Add pair
          </Button>
          <Button disabled={locked || !valid || saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save setup'}
          </Button>
        </div>
        {!groupsValid ? <p className="text-sm text-destructive" role="alert">Use group sizes 3+3, 4+3, or 4+4.</p> : null}
        {saveMutation.isError ? <p className="text-sm text-destructive" role="alert">{saveMutation.error.message}</p> : null}
      </form>

      <AlertDialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace setup and fixtures?</AlertDialogTitle>
            <AlertDialogDescription>All unstarted fixtures and existing setup entries will be rebuilt from this form.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current setup</AlertDialogCancel>
            <AlertDialogAction onClick={() => saveMutation.mutate()}>Replace setup</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
