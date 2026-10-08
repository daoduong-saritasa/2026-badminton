import { useEffect, useState } from 'react'
import confetti from 'canvas-confetti'
import { Trophy, X } from 'lucide-react'

import { finalPositions } from '@/domain/progression'
import type { TournamentSnapshot, UUID } from '@/domain/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { messages } from '@/i18n/messages'
import { cn } from '@/lib/utils'

import { teamName } from './labels'

/** Paper colours drawn from the court palette, plus gold for the win. */
const confettiColors = ['#f15d27', '#00448c', '#23c0c3', '#ffd166', '#ffffff']

/** Rank chip colours for second to fourth place. */
const placeStyles = ['bg-mist text-navy', 'bg-peach text-ink', 'bg-well text-muted-ink'] as const

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

/**
 * An opening burst from the top, then paper streams from both lower corners
 * for about six seconds, with a second burst halfway. Returns a stop function.
 */
function launchConfetti(): () => void {
  const shared = { colors: confettiColors, zIndex: 60, disableForReducedMotion: true, scalar: 1.1 }
  const end = Date.now() + 6_000
  let frame = 0
  const centreBurst = () => void confetti({ ...shared, particleCount: 140, spread: 100, startVelocity: 45, origin: { x: 0.5, y: 0.3 } })
  const stream = () => {
    for (const x of [0, 1]) {
      void confetti({ ...shared, particleCount: 3, angle: x === 0 ? 60 : 120, spread: 60, startVelocity: 60, drift: x === 0 ? 0.4 : -0.4, ticks: 260, origin: { x, y: 0.95 } })
    }
    if (Date.now() < end) frame = requestAnimationFrame(stream)
  }
  centreBurst()
  stream()
  const secondBurst = window.setTimeout(centreBurst, 3_000)
  return () => {
    cancelAnimationFrame(frame)
    window.clearTimeout(secondBurst)
    confetti.reset()
  }
}

/**
 * Announces the final positions once per device when the last placement
 * fixture ends, with the champion first and largest. It opens on any screen
 * as soon as the snapshot shows the result, and on later visits until closed.
 */
export function FinalCelebration({ snapshot, onClose }: {
  snapshot: TournamentSnapshot
  /** Runs after the viewer closes the popup. */
  onClose?: () => void
}) {
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
    onClose?.()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden border-0 p-0 shadow-final sm:max-w-xl">
        <div className="relative overflow-hidden bg-orange px-6 pb-10 pt-12 text-center text-white sm:px-10">
          <div className="pointer-events-none absolute -left-16 -top-20 size-56 rounded-full bg-white/10" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-24 -right-12 size-64 rounded-full bg-white/10" aria-hidden="true" />
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" className="absolute right-3 top-3 text-white hover:bg-white/15 hover:text-white">
              <X />
              <span className="sr-only">{messages.common.close}</span>
            </Button>
          </DialogClose>
          <div className="relative">
            <span className="mx-auto flex size-20 items-center justify-center rounded-full bg-white text-orange shadow-[0_0_0_8px_rgb(255_255_255/18%)] animate-in zoom-in-50 duration-500">
              <Trophy className="size-10" aria-hidden="true" />
            </span>
            <p className="mt-6 inline-block rounded-pill bg-white/18 px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.18em]">
              {messages.fixtures.championLabel}
            </p>
            <DialogTitle className="mx-auto mt-3 max-w-[30ch] text-[clamp(2rem,7vw,3.25rem)] font-extrabold leading-[1.05] tracking-[-0.03em] text-balance [overflow-wrap:anywhere] animate-in fade-in slide-in-from-bottom-3 delay-150 duration-700 fill-mode-both">
              {teamName(snapshot, champion)}
            </DialogTitle>
            <p className="mt-3 text-sm text-white/85 [overflow-wrap:anywhere]">{snapshot.tournament.name}</p>
          </div>
        </div>
        <div className="px-6 pb-6 pt-6 sm:px-8">
          <DialogDescription className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-ink">
            {messages.fixtures.positionsHeading}
          </DialogDescription>
          <ol className="mt-3 divide-y divide-hairline">
            {others.map((teamId, index) => (
              <li className="flex items-center gap-4 py-3" key={teamId}>
                <span className={cn('numeric shrink-0 whitespace-nowrap rounded-chip px-2.5 py-1 text-xs font-bold', placeStyles[index])}>
                  {messages.fixtures.position(index + 2)}
                </span>
                <span className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">{teamName(snapshot, teamId)}</span>
              </li>
            ))}
          </ol>
          <DialogClose asChild>
            <Button className="mt-5 w-full">{messages.fixtures.viewResults}</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}
