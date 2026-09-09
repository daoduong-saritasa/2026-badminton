import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, KeyRound, RefreshCw } from 'lucide-react'

import { fetchTournament, subscribeTournament, TournamentNotConfiguredError } from '@/data/tournament'
import { getStaffAccess } from '@/data/staff'
import type { StaffAccess, TournamentSnapshot, TournamentStage } from '@/domain/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StaffAccessDialog } from '@/features/staff/StaffAccessDialog'
import { StaffMenu } from '@/features/staff/StaffMenu'
import { ScoreTracker } from '@/features/scoring/ScoreTracker'
import { OrganizerPage } from '@/features/organizer/OrganizerPage'
import { SetupForm } from '@/features/organizer/SetupForm'
import { KnockoutBracket } from '@/features/tournament/KnockoutBracket'
import { StandingsTable } from '@/features/tournament/StandingsTable'
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
 * and offset so it sits on the rule rather than 5px below it.
 */
const tabTriggerClass = 'min-h-11 min-w-[4.375rem] flex-none rounded-none px-0 pb-3 text-[0.8125rem] text-muted-ink data-active:font-semibold data-active:text-ink after:inset-x-0 after:-bottom-px after:h-[3px] after:rounded-[3px] after:bg-orange'

function defaultView(stage: TournamentStage): PublicView {
  if (stage === 'knockouts' || stage === 'completed') return 'knockouts'
  return 'matches'
}

function isStaffView(view: AppView): view is StaffView {
  return view === 'scoring' || view === 'organizer'
}

function LoadingScreen() {
  return (
    <main className="grid min-h-svh place-items-center px-6 text-center">
      <div>
        <span className="brand-mark" aria-hidden="true" />
        <p className="mt-5 text-sm font-medium">Loading tournament…</p>
      </div>
    </main>
  )
}

function ErrorScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <main className="grid min-h-svh place-items-center px-6">
      <Alert variant="destructive" className="max-w-lg rounded-card bg-white">
        <AlertCircle />
        <AlertTitle>Tournament unavailable</AlertTitle>
        <AlertDescription>
          <p>{error.message}</p>
          <Button className="mt-5" variant="outline" onClick={onRetry}>
            <RefreshCw /> Retry
          </Button>
        </AlertDescription>
      </Alert>
    </main>
  )
}

function SetupRequiredScreen({
  isStaff,
  staffDialogOpen,
  onStaffDialogChange,
  onStaffGranted,
}: {
  isStaff: boolean
  staffDialogOpen: boolean
  onStaffDialogChange: (open: boolean) => void
  onStaffGranted: (access: StaffAccess) => void
}) {
  return (
    <main className="app-shell">
      <header className="mb-8">
        <p className="text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-muted-ink">Tournament setup</p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight"><span className="brand-mark" aria-hidden="true" />Create the tournament</h1>
        <p className="ml-[2.5625rem] mt-2 text-xs text-muted-ink">Staff access is required for initial configuration.</p>
      </header>
      {isStaff ? (
        <SetupForm snapshot={null} />
      ) : (
        <section className="rounded-card border border-ink/5 bg-white p-8 text-center shadow-card">
          <KeyRound className="mx-auto size-6" />
          <h2 className="mt-4 text-lg font-semibold">Enter the staff PIN to begin</h2>
          <Button className="mt-6" onClick={() => onStaffDialogChange(true)}>Staff access</Button>
        </section>
      )}
      <StaffAccessDialog open={staffDialogOpen} onOpenChange={onStaffDialogChange} onGranted={onStaffGranted} />
    </main>
  )
}

function renderView(snapshot: TournamentSnapshot, view: AppView, onStartScoring: () => void) {
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
      return <OrganizerPage snapshot={snapshot} onStartScoring={onStartScoring} />
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
  const handleStaffGranted = (access: NonNullable<typeof staffAccess>) => {
    queryClient.setQueryData(staffQueryKey, access)
    setSelectedView('organizer')
  }

  useEffect(() => subscribeTournament((snapshot) => {
    // A local mutation hands over the snapshot it already fetched; a remote
    // change only says that something moved, so that one has to go and look.
    if (snapshot) queryClient.setQueryData(tournamentQueryKey, snapshot)
    else void queryClient.invalidateQueries({ queryKey: tournamentQueryKey })
  }), [queryClient])

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
  if (tournamentQuery.isError) {
    if (tournamentQuery.error instanceof TournamentNotConfiguredError) {
      return (
        <SetupRequiredScreen
          isStaff={isStaff}
          staffDialogOpen={staffDialogOpen}
          onStaffDialogChange={setStaffDialogOpen}
          onStaffGranted={handleStaffGranted}
        />
      )
    }
    return <ErrorScreen error={tournamentQuery.error} onRetry={() => void tournamentQuery.refetch()} />
  }

  const snapshot = tournamentQuery.data
  const accessibleSelection = selectedView !== null && isStaffView(selectedView) && !isStaff
    ? null
    : selectedView
  const view = accessibleSelection ?? defaultView(snapshot.tournament.stage)
  const handleViewChange = (nextView: string) => setSelectedView(nextView as AppView)
  const handleStaffAction = () => {
    if (isStaff) setSelectedView('organizer')
    else setStaffDialogOpen(true)
  }
  const handleSignedOut = () => {
    queryClient.setQueryData(staffQueryKey, null)
    setSelectedView(null)
  }
  if (view === 'scoring') {
    return <ScoreTracker snapshot={snapshot} onExit={() => setSelectedView('matches')} />
  }
  const viewContent = renderView(snapshot, view, () => setSelectedView('scoring'))
  const tabs: { value: AppView; label: string }[] = [
    { value: 'matches', label: 'Matches' },
    { value: 'standings', label: 'Standings' },
    { value: 'knockouts', label: 'Knockouts' },
    ...(isStaff ? ([{ value: 'scoring', label: 'Referee' }, { value: 'organizer', label: 'Organizer' }] as const) : []),
  ]

  return (
    <div className="app-shell">
      <header className="mb-9 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[clamp(1.4375rem,4vw,1.875rem)] font-extrabold tracking-[-0.0433em]">
            <span className="brand-mark" aria-hidden="true" />
            {snapshot.tournament.name}
          </h1>
          <p className="ml-[2.5625rem] mt-[7px] text-xs capitalize text-muted-ink">
            {snapshot.tournament.stage} stage
          </p>
        </div>
        {isStaff ? (
          <StaffMenu onNavigate={setSelectedView} onSignedOut={handleSignedOut} />
        ) : (
          <Button
            variant="outline"
            className="border-rule bg-transparent text-muted-ink hover:bg-white"
            onClick={handleStaffAction}
          >
            <KeyRound /> Staff access
          </Button>
        )}
      </header>

      <Tabs value={view} onValueChange={handleViewChange} className="gap-8">
        <TabsList variant="line" className="h-auto w-full justify-start gap-[1.375rem] overflow-x-auto rounded-none border-b border-line p-0">
          {tabs.map((tab) => (
            <TabsTrigger className={tabTriggerClass} key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {viewContent}
      </Tabs>

      <footer className="mt-[2.625rem] flex flex-wrap justify-between gap-4 text-[0.625rem] text-muted-ink">
        <span>First to 21 · Win by 2 · Cap at 30</span>
        <span aria-live="polite">{tournamentQuery.isFetching ? 'Updating…' : 'Live updates ready'}</span>
      </footer>

      <StaffAccessDialog
        open={staffDialogOpen}
        onOpenChange={setStaffDialogOpen}
        onGranted={handleStaffGranted}
      />
    </div>
  )
}
