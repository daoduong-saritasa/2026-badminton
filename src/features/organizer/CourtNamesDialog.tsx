import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'

import { mutateTournament } from '@/data/tournament'
import { courtNameIssues, courtNameMaxLength } from '@/domain/courts'
import type { TournamentSnapshot } from '@/domain/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessage } from '@/i18n/errors'
import { messages } from '@/i18n/messages'


function CourtNamesForm({ snapshot, resetGeneration, onSaved }: {
  snapshot: TournamentSnapshot
  resetGeneration: number
  onSaved: () => void
}) {
  const [names, setNames] = useState<[string, string]>(snapshot.tournament.courtNames)
  const issues = courtNameIssues(names)
  const unchanged = names.every((name, index) => name.trim() === snapshot.tournament.courtNames[index])
  const mutation = useMutation({
    mutationFn: () => mutateTournament('rename_courts', {
      requestId: crypto.randomUUID(),
      resetGeneration,
      expectedVersion: snapshot.tournament.version,
      payload: { names: [names[0].trim(), names[1].trim()] },
    }),
    onSuccess: onSaved,
  })

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (issues.length === 0 && !unchanged) mutation.mutate()
      }}
    >
      <DialogHeader>
        <DialogTitle>{messages.organizer.courts.title}</DialogTitle>
        <DialogDescription>{messages.organizer.courts.description}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        {([0, 1] as const).map((index) => (
          <div className="space-y-2" key={index}>
            <Label htmlFor={`court-name-${index + 1}`}>{messages.organizer.courts.label(index + 1)}</Label>
            <Input
              id={`court-name-${index + 1}`}
              value={names[index]}
              maxLength={courtNameMaxLength + 10}
              onChange={(event) => {
                const value = event.target.value
                setNames((current) => (index === 0 ? [value, current[1]] : [current[0], value]))
              }}
            />
          </div>
        ))}
      </div>
      {issues.length > 0 ? (
        <ul className="space-y-0.5 text-[0.8125rem] text-destructive" role="status">
          {issues.map((issue) => <li key={issue}>{messages.organizer.courts.issues[issue]}</li>)}
        </ul>
      ) : null}
      {mutation.isError ? <p className="text-[0.8125rem] text-destructive" role="alert">{errorMessage(mutation.error)}</p> : null}
      <DialogFooter>
        <Button type="submit" disabled={issues.length > 0 || unchanged || mutation.isPending}>
          {mutation.isPending ? messages.common.saving : messages.organizer.courts.save}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** The organizer's button and dialog for naming courts 1 and 2. */
export function CourtNamesDialog({ snapshot, resetGeneration }: {
  snapshot: TournamentSnapshot
  resetGeneration: number
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Pencil /> {messages.organizer.courts.rename}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          {open ? <CourtNamesForm snapshot={snapshot} resetGeneration={resetGeneration} onSaved={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
