import { useEffect, useState } from 'react'
import confetti from 'canvas-confetti'
import { Trophy } from 'lucide-react'

import { finalPositions } from '@/domain/progression'
import type { TournamentSnapshot, UUID } from '@/domain/types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { messages } from '@/i18n/messages'

import { teamName } from './labels'

function storageKey(tournamentId: UUID, positions: readonly UUID[]): string {
  return `badminton:celebrated:${tournamentId}:${positions.join(',')}`
}

/** Whether this device already celebrated these final positions; storage may be unavailable. */
function wasCelebrated(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function markCelebrated(key: string): void {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // The popup still closes; it may show again on the next visit.
  }
}

/** Paper bursts from both lower corners for about two seconds. */
function launchConfetti(): () => void {
  const end = Date.now() + 2_000
  let frame = 0
  const burst = () => {
    for (const x of [0, 1]) {
      void confetti({
        particleCount: 6,
        angle: x === 0 ? 60 : 120,
        spread: 70,
        startVelocity: 55,
        origin: { x, y: 0.9 },
        zIndex: 60,
        disableForReducedMotion: true,
      })
    }
    if (Date.now() < end) frame = requestAnimationFrame(burst)
  }
  burst()
  return () => {
    cancelAnimationFrame(frame)
    confetti.reset()
  }
}

/**
 * Announces the final positions once per device when the last placement
 * fixture ends, with the champion first and largest.
 */
export function FinalCelebration({ snapshot }: { snapshot: TournamentSnapshot }) {
  const positions = finalPositions(snapshot.fixtures, snapshot.matches)
  const key = positions ? storageKey(snapshot.tournament.id, positions) : null
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const open = key !== null && key !== dismissedKey && !wasCelebrated(key)

  useEffect(() => {
    if (!open) return
    return launchConfetti()
  }, [open])

  if (!positions || key === null) return null
  const [champion, ...others] = positions
  const close = () => {
    markCelebrated(key)
    setDismissedKey(key)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-md">
        <div className="bg-orange px-6 pb-8 pt-10 text-center text-white">
          <Trophy className="mx-auto size-12" aria-hidden="true" />
          <p className="mt-4 text-xs font-semibold tracking-[0.12em]">{messages.fixtures.championLabel}</p>
          <DialogTitle className="mt-2 text-4xl font-extrabold tracking-tight [overflow-wrap:anywhere] sm:text-5xl">
            {teamName(snapshot, champion)}
          </DialogTitle>
        </div>
        <div className="px-6 pb-6">
          <DialogDescription className="text-sm font-semibold text-ink">{messages.fixtures.positionsHeading}</DialogDescription>
          <ol className="mt-3 space-y-2">
            {others.map((teamId, index) => (
              <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 text-[0.9375rem]" key={teamId}>
                <span className="text-muted-ink">{messages.fixtures.position(index + 2)}</span>
                <span className="font-semibold [overflow-wrap:anywhere]">{teamName(snapshot, teamId)}</span>
              </li>
            ))}
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  )
}
