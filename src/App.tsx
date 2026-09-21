import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ArrowLeft, KeyRound, RefreshCw } from 'lucide-react'

import { fetchTournament, subscribeTournament } from '@/data/tournament'
import { getStaffAccess } from '@/data/staff'
import type { StaffAccess, TournamentSnapshot, TournamentStage } from '@/domain/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StaffAccessDialog } from '@/features/staff/StaffAccessDialog'
import { errorMessage } from '@/i18n/errors'
import { messages } from '@/i18n/vi'
import { StaffMenu } from '@/features/staff/StaffMenu'
import { ScoreTracker } from '@/features/scoring/ScoreTracker'
import { OrganizerPage } from '@/features/organizer/OrganizerPage'
import { SetupForm } from '@/features/organizer/SetupForm'
import { KnockoutBracket } from '@/features/tournament/KnockoutBracket'
import { StandingsTable } from '@/features/tournament/StandingsTable'
import { tournamentTitle } from '@/features/tournament/document-title'
import { TournamentPage } from '@/features/tournament/TournamentPage'

import './App.css'

type PublicView = 'matches' | 'standings' | 'knockouts'
type StaffView = 'scoring' | 'organizer'
type AppView = PublicView | StaffView

const tournamentQueryKey = ['tournament'] as const
const staffQueryKey = ['staff-access'] as const

/*
 * Underlined tabs: a hairline rule with a 3px orange bar under the active tab.
 * The `line` variant already renders the bar; these override its colour, weight
 * and offset so it overlaps the rule rather than sitting 5px below it. The list
 * never scrolls: on narrow screens the tabs share the row equally and long labels
 * wrap inside their tab, so the rule and the active bar always stay in view.
 */
const tabTriggerClass = 'h-auto min-h-11 min-w-0 flex-1 whitespace-normal rounded-none px-0 pb-3 text-center text-[0.8125rem] leading-tight text-muted-ink sm:min-w-[4.375rem] sm:flex-none data-active:font-semibold data-active:text-ink after:inset-x-0 after:-bottom-px after:h-[3px] after:rounded-[3px] after:bg-orange'

function defaultView(stage: TournamentStage): PublicView {
  if (stage === 'knockouts' || stage === 'completed') return 'knockouts'
  return 'matches'
}

function LoadingScreen() {
  return (
    <main className="grid min-h-svh place-items-center px-6 text-center">
      <div>
        <span className="brand-mark" aria-hidden="true" />
        <p className="mt-5 text-sm font-medium">{messages.app.loading}</p>
      </div>
    </main>
  )
}

function ErrorScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <main className="grid min-h-svh place-items-center px-6">
      <Alert variant="destructive" className="max-w-lg rounded-card bg-white">
        <AlertCircle />
        <AlertTitle>{messages.app.unavailableTitle}</AlertTitle>
        <AlertDescription>
          <p>{errorMessage(error)}</p>
          <Button className="mt-5" variant="outline" onClick={onRetry}>
            <RefreshCw /> {messages.app.retry}
          </Button>
        </AlertDescription>
      </Alert>
    </main>
  )
}

function SetupRequiredScreen({
  isOrganizer,
  staffDialogOpen,
  onStaffDialogChange,
  onStaffGranted,
  resetGeneration,
}: {
  isOrganizer: boolean
  staffDialogOpen: boolean
  onStaffDialogChange: (open: boolean) => void
  onStaffGranted: (access: StaffAccess) => void
  resetGeneration: number
}) {
  return (
    <main className="app-shell">
      <header className="mb-8">
        <p className="text-[0.625rem] font-semibold tracking-[0.08em] text-muted-ink">{messages.app.setupEyebrow}</p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight"><span className="brand-mark" aria-hidden="true" />{messages.app.setupHeading}</h1>
        <p className="ml-[2.5625rem] mt-2 text-xs text-muted-ink">{messages.app.setupNote}</p>
      </header>
      {isOrganizer ? (
        <SetupForm snapshot={null} resetGeneration={resetGeneration} />
      ) : (
        <section className="rounded-card border border-ink/5 bg-white p-8 text-center shadow-card">
          <KeyRound className="mx-auto size-6" />
          <h2 className="mt-4 text-lg font-semibold">{messages.app.enterPinHeading}</h2>
          <Button className="mt-6" onClick={() => onStaffDialogChange(true)}>{messages.app.staffAccess}</Button>
        </section>
      )}
      <StaffAccessDialog open={staffDialogOpen} onOpenChange={onStaffDialogChange} onGranted={onStaffGranted} />
    </main>
  )
}

function renderView(snapshot: TournamentSnapshot, resetGeneration: number, view: AppView, onStartScoring: () => void) {
  switch (view) {
    case 'matches':
      return <TournamentPage snapshot={snapshot} />
    case 'standings':
      return <StandingsTable snapshot={snapshot} />
    case 'knockouts':
      return <KnockoutBracket snapshot={snapshot} />
    case 'scoring':
      return null
    case 'organizer':
      return <OrganizerPage snapshot={snapshot} resetGeneration={resetGeneration} onStartScoring={onStartScoring} />
  }
}

export default function App() {
  const queryClient = useQueryClient()
  const [selectedView, setSelectedView] = useState<AppView | null>(null)
  const [staffDialogOpen, setStaffDialogOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const tournamentQuery = useQuery({ queryKey: tournamentQueryKey, queryFn: fetchTournament })
  const staffQuery = useQuery({
    queryKey: staffQueryKey,
    queryFn: getStaffAccess,
    refetchInterval: 30_000,
  })

  const staffAccess = staffQuery.data ?? null
  const isStaff = staffAccess !== null && Date.parse(staffAccess.expiresAt) > now
  const isOrganizer = isStaff && staffAccess.role === 'organizer'
  const handleStaffGranted = (access: NonNullable<typeof staffAccess>) => {
    queryClient.setQueryData(staffQueryKey, access)
    setSelectedView(access.role === 'organizer' ? 'organizer' : 'scoring')
  }

  useEffect(() => subscribeTournament((state) => {
    // A local mutation hands over the state it already fetched; a remote
    // change only says that something moved, so that one has to go and look.
    if (state) queryClient.setQueryData(tournamentQueryKey, state)
    else void queryClient.invalidateQueries({ queryKey: tournamentQueryKey })
  }), [queryClient])

  const tournamentName = tournamentQuery.data?.snapshot?.tournament.name ?? null
  useEffect(() => {
    document.title = tournamentTitle(tournamentName)
  }, [tournamentName])

  useEffect(() => {
    if (staffAccess === null) return
    const expiresIn = Math.max(0, Date.parse(staffAccess.expiresAt) - Date.now())
    const timeout = window.setTimeout(() => {
      setNow(Date.now())
      void queryClient.invalidateQueries({ queryKey: staffQueryKey })
    }, expiresIn)
    return () => window.clearTimeout(timeout)
  }, [queryClient, staffAccess])

  if (tournamentQuery.isPending) return <LoadingScreen />
  if (tournamentQuery.isError) return <ErrorScreen error={tournamentQuery.error} onRetry={() => void tournamentQuery.refetch()} />

  const tournamentState = tournamentQuery.data
  const snapshot = tournamentState.snapshot
  if (snapshot === null) {
    return (
      <SetupRequiredScreen
        isOrganizer={isOrganizer}
        staffDialogOpen={staffDialogOpen}
        onStaffDialogChange={setStaffDialogOpen}
        onStaffGranted={handleStaffGranted}
        resetGeneration={tournamentState.resetGeneration}
      />
    )
  }
  const accessibleSelection =
    (selectedView === 'scoring' && !isStaff) ||
    (selectedView === 'organizer' && !isOrganizer)
      ? null
      : selectedView
  const view = accessibleSelection ?? defaultView(snapshot.tournament.stage)
  const handleViewChange = (nextView: string) => setSelectedView(nextView as AppView)
  const handleStaffAction = () => {
    if (isStaff) setSelectedView(isOrganizer ? 'organizer' : 'scoring')
    else setStaffDialogOpen(true)
  }
  const handleSignedOut = () => {
    queryClient.setQueryData(staffQueryKey, null)
    setSelectedView(null)
  }
  if (view === 'scoring') {
    return <ScoreTracker snapshot={snapshot} resetGeneration={tournamentState.resetGeneration} onExit={() => setSelectedView('matches')} />
  }
  if (view === 'organizer' && staffAccess) {
    return (
      <div className="app-shell">
        <header className="mb-8">
          <div className="flex items-center justify-between gap-4">
            <Button variant="ghost" className="-ml-3 text-muted-ink" onClick={() => setSelectedView('matches')}>
              <ArrowLeft /> {messages.organizer.returnToTournament}
            </Button>
            <StaffMenu role={staffAccess.role} onSignedOut={handleSignedOut} />
          </div>
          <div className="mt-6">
            <h1 className="text-[clamp(1.5rem,5vw,2rem)] font-extrabold tracking-[-0.0433em]">
              <span className="brand-mark" aria-hidden="true" />
              {snapshot.tournament.name}
            </h1>
            <p className="ml-[2.5625rem] mt-2 text-sm text-muted-ink">{messages.app.stage[snapshot.tournament.stage]}</p>
          </div>
        </header>
        <OrganizerPage
          snapshot={snapshot}
          resetGeneration={tournamentState.resetGeneration}
          onStartScoring={() => setSelectedView('scoring')}
        />
      </div>
    )
  }
  const viewContent = renderView(snapshot, tournamentState.resetGeneration, view, () => setSelectedView('scoring'))
  const tabs: { value: PublicView; label: string }[] = [
    { value: 'matches', label: messages.app.tabs.matches },
    { value: 'standings', label: messages.app.tabs.standings },
    { value: 'knockouts', label: messages.app.tabs.knockouts },
  ]

  return (
    <div className="app-shell">
      <header className="mb-8 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:gap-5">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.4375rem,4vw,1.875rem)] font-extrabold tracking-[-0.0433em]">
            <span className="brand-mark" aria-hidden="true" />
            {snapshot.tournament.name}
          </h1>
          <p className="ml-[2.5625rem] mt-[7px] text-xs text-muted-ink">
            {messages.app.stage[snapshot.tournament.stage]}
          </p>
        </div>
        {isStaff ? (
          <StaffMenu role={staffAccess.role} onOpenWorkspace={handleStaffAction} onSignedOut={handleSignedOut} />
        ) : (
          <Button
            variant="outline"
            className="shrink-0 border-rule bg-transparent px-3 text-muted-ink hover:bg-white sm:px-4"
            aria-label={messages.app.staffAccess}
            onClick={handleStaffAction}
          >
            <KeyRound /> <span className="hidden sm:inline">{messages.app.staffAccess}</span>
          </Button>
        )}
      </header>

      <Tabs value={view} onValueChange={handleViewChange} className="gap-8">
        <TabsList variant="line" className="w-full items-stretch justify-start gap-3 rounded-none p-0 group-data-horizontal/tabs:h-auto sm:gap-[1.375rem]">
          {tabs.map((tab) => (
            <TabsTrigger className={tabTriggerClass} key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {viewContent}
      </Tabs>

      <footer className="mt-[2.625rem] flex flex-wrap justify-between gap-4 text-xs text-muted-ink">
        <span>{messages.app.scoringRule}</span>
        <span aria-live="polite">{tournamentQuery.isFetching ? messages.app.updating : messages.app.liveReady}</span>
      </footer>

      <StaffAccessDialog
        open={staffDialogOpen}
        onOpenChange={setStaffDialogOpen}
        onGranted={handleStaffGranted}
      />
    </div>
  )
}
