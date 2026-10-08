import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { PairAssignmentView } from '@/features/scoring/PairAssignmentView'
import { ScoreTrackerView, ScoreConfirmationView } from '@/features/scoring/ScoreTrackerView'
import { StaffAccessView } from '@/features/staff/StaffAccessView'
import { MatchPickerView } from '@/features/scoring/MatchPickerView'
import { messages } from '@/i18n/messages'
import { guidePicks } from './guide-data'
import { guideExample, guideSteps } from './guide-state'
import { createGuideTour } from './guide-tour'
import 'driver.js/dist/driver.css'
import './guide.css'

const noop = () => {}

export function GuidePage() {
  const [index, setIndex] = useState<number | null>(null)
  const [visited, setVisited] = useState(false)
  const tour = useRef<ReturnType<typeof createGuideTour> | null>(null)
  const startButton = useRef<HTMLButtonElement>(null)
  const { step, snapshot, match, state } = guideExample(index ?? 0)
  const handleRender = (next: number | null) => {
    setIndex(next)
    if (next === null) requestAnimationFrame(() => startButton.current?.focus())
  }
  const handleStart = () => {
    tour.current?.destroy()
    setVisited(true)
    tour.current = createGuideTour(handleRender)
    tour.current.start()
  }
  useEffect(() => () => tour.current?.destroy(), [])
  const blockExampleClick = (event: React.SyntheticEvent) => { event.preventDefault(); event.stopPropagation() }
  const blockExampleKey = (event: React.KeyboardEvent) => {
    if (['Enter', ' ', 'ArrowUp', 'ArrowDown'].includes(event.key)) blockExampleClick(event)
  }
  const hasForm = index !== null && (step.screen === 'access' || step.screen === 'pairs')
  return <div className="app-shell guide-shell" data-guide-total={guideSteps.length}>
    <header className="guide-header">
      <a href="/" className="inline-flex items-center gap-2 text-sm text-navy"><ArrowLeft className="size-4" />{messages.guide.live}</a>
      <h1 className="text-[clamp(1.5rem,3vw,2rem)] font-bold tracking-tight">{messages.guide.heading}</h1>
      <p className="text-sm text-muted-ink">{messages.guide.notice}</p>
    </header>
    <section data-guide="intro" className="guide-intro">
      <p className="max-w-xl text-sm leading-relaxed text-muted-ink">{messages.guide.intro}</p>
      <Button ref={startButton} onClick={handleStart} disabled={index !== null}>{visited ? messages.guide.restart : messages.guide.start}</Button>
    </section>
    <div className="guide-example" onClickCapture={blockExampleClick} onKeyDownCapture={blockExampleKey} data-step={index ?? 'closed'} data-target={step.target}>
      {(step.screen === 'picker' || step.screen === 'intro' || hasForm) && <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{snapshot.tournament.name}</h2>
          <Button data-guide="access" variant="outline"><KeyRound />{messages.app.staffAccess}</Button>
        </div>
        {step.completed && <p data-guide="completed" className="text-sm font-semibold">{messages.guide.completed}</p>}
        <MatchPickerView snapshot={snapshot} onSelect={noop} onExit={noop} onAssign={noop} onStart={noop} />
      </section>}
      {step.screen === 'score' && <ScoreTrackerView snapshot={snapshot} match={match} state={state}
        sidesSwapped={step.swapped} screenOrder={step.swapped ? ['b', 'a'] : ['a', 'b']} actionPending={false} actionFailure={null}
        takeoverOpen={false} takeoverPending={false} dialogs={false} onExit={noop} toggleSides={noop} handlePoint={noop} handleRetry={noop}
        onUndo={noop} onConfirm={noop} onTakeover={noop} onReconcile={noop} onDismissReview={noop} setTakeoverOpen={noop} />}
      {step.dialog && <section data-guide="confirmation" role="dialog" aria-modal="false" aria-label={step.title} className="guide-confirmation rounded-card border border-line bg-white">
        <ScoreConfirmationView inline kind={step.dialog} gameNumber={step.gameNumber} score={[step.score.a, step.score.b]} onCancel={noop} onConfirm={noop} />
      </section>}
      {step.screen === 'finish' && <section data-guide="finish" className="space-y-3"><h2 className="text-lg font-semibold">{step.title}</h2><p>{messages.guide.finish}</p></section>}
    </div>
    <Dialog open={hasForm} modal={false} onOpenChange={noop}>
      <DialogContent showCloseButton={false} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}
        onClickCapture={blockExampleClick} onKeyDownCapture={blockExampleKey}
        className={step.screen === 'pairs' ? 'guide-form guide-pair-form flex max-h-[65dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl' : 'guide-form guide-access-form sm:max-w-sm'}>
        {step.screen === 'access' ? <div data-guide="pin" className="space-y-4">
          <StaffAccessView pin="1234" onPinChange={noop} onSubmit={blockExampleClick} />
          <p className="text-sm text-muted-ink">{messages.guide.examplePin}</p>
        </div> : <div data-guide="pairs" className="flex min-h-0 flex-1 flex-col">
          <PairAssignmentView key={index} snapshot={snapshot} fixtureId="guide-fixture" role="referee" onSave={noop} initialPicks={index === 6 ? guidePicks : {}} />
        </div>}
      </DialogContent>
    </Dialog>
    {index === null && visited && <footer className="mt-6"><p className="mb-3 text-sm">{messages.guide.finish}</p><a href="/" className="text-navy underline">{messages.guide.live}</a></footer>}
  </div>
}
