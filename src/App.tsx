import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, KeyRound, RefreshCw } from 'lucide-react'

import { fetchTournament, subscribeTournament } from '@/data/tournament'
import { getStaffAccess } from '@/data/staff'
import type { TournamentSnapshot, TournamentStage } from '@/domain/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StaffAccessDialog } from '@/features/staff/StaffAccessDialog'
import { StaffMenu } from '@/features/staff/StaffMenu'
import { KnockoutBracket } from '@/features/tournament/KnockoutBracket'
import { StandingsTable } from '@/features/tournament/StandingsTable'
import { TournamentPage } from '@/features/tournament/TournamentPage'

import './App.css'

type PublicView = 'matches' | 'standings' | 'knockouts'
type StaffView = 'scoring' | 'organizer'
type AppView = PublicView | StaffView

const tournamentQueryKey = ['tournament'] as const
const staffQueryKey = ['staff-access'] as const

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
      <Alert variant="destructive" className="max-w-lg bg-white">
        <AlertCircle />
        <AlertTitle>Tournament unavailable</AlertTitle>
        <AlertDescription>
          <p>{error.message}</p>
          <Button className="mt-4" variant="outline" onClick={onRetry}>
            <RefreshCw /> Retry
          </Button>
        </AlertDescription>
      </Alert>
    </main>
  )
}

function StaffViewPlaceholder({ snapshot, view }: { snapshot: TournamentSnapshot; view: StaffView }) {
  const labels: Record<StaffView, string> = {
    scoring: 'Referee scoring',
    organizer: 'Tournament control',
  }

  return (
    <section className="view-enter rounded-2xl border bg-white p-8 shadow-[0_8px_0_rgb(15_43_41/0.03)]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {snapshot.tournament.stage}
      </p>
      <h2 className="mt-3 text-2xl font-bold tracking-tight">{labels[view]}</h2>
      <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
        {snapshot.pairs.length} pairs · {snapshot.matches.length} matches
      </p>
    </section>
  )
}

function renderView(snapshot: TournamentSnapshot, view: AppView) {
  switch (view) {
    case 'matches':
      return <TournamentPage snapshot={snapshot} />
    case 'standings':
      return <StandingsTable snapshot={snapshot} />
    case 'knockouts':
      return <KnockoutBracket snapshot={snapshot} />
    case 'scoring':
    case 'organizer':
      return <StaffViewPlaceholder snapshot={snapshot} view={view} />
  }
}

export default function App() {
  const queryClient = useQueryClient()
  const [selectedView, setSelectedView] = useState<AppView | null>(null)
  const [staffDialogOpen, setStaffDialogOpen] = useState(false)
  const tournamentQuery = useQuery({ queryKey: tournamentQueryKey, queryFn: fetchTournament })
  const staffQuery = useQuery({
    queryKey: staffQueryKey,
    queryFn: getStaffAccess,
    refetchInterval: 30_000,
  })

  const staffAccess = staffQuery.data ?? null
  const isStaff = staffAccess !== null && Date.parse(staffAccess.expiresAt) > Date.now()

  useEffect(() => subscribeTournament(() => {
    void queryClient.invalidateQueries({ queryKey: tournamentQueryKey })
  }), [queryClient])

  useEffect(() => {
    if (staffAccess === null) return
    const expiresIn = Math.max(0, Date.parse(staffAccess.expiresAt) - Date.now())
    const timeout = window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: staffQueryKey })
    }, expiresIn)
    return () => window.clearTimeout(timeout)
  }, [queryClient, staffAccess])

  useEffect(() => {
    if (!isStaff && selectedView !== null && isStaffView(selectedView)) setSelectedView(null)
  }, [isStaff, selectedView])

  if (tournamentQuery.isPending) return <LoadingScreen />
  if (tournamentQuery.isError) {
    return <ErrorScreen error={tournamentQuery.error} onRetry={() => void tournamentQuery.refetch()} />
  }

  const snapshot = tournamentQuery.data
  const view = selectedView ?? defaultView(snapshot.tournament.stage)
  const handleViewChange = (nextView: string) => setSelectedView(nextView as AppView)
  const handleStaffAction = () => {
    if (isStaff) setSelectedView('organizer')
    else setStaffDialogOpen(true)
  }
  const handleStaffGranted = (access: NonNullable<typeof staffAccess>) => {
    queryClient.setQueryData(staffQueryKey, access)
    setSelectedView('organizer')
  }
  const handleSignedOut = () => {
    queryClient.setQueryData(staffQueryKey, null)
    setSelectedView(null)
  }
  const viewContent = renderView(snapshot, view)

  return (
    <div className="app-shell">
      <header className="mb-9 flex items-start justify-between gap-5">
        <div>
          <h1 className="text-[clamp(1.45rem,4vw,1.9rem)] font-extrabold tracking-[-0.045em]">
            <span className="brand-mark" aria-hidden="true" />
            {snapshot.tournament.name}
          </h1>
          <p className="ml-10 mt-2 text-xs capitalize text-muted-foreground">
            {snapshot.tournament.stage} stage
          </p>
        </div>
        {isStaff ? (
          <StaffMenu onNavigate={setSelectedView} onSignedOut={handleSignedOut} />
        ) : (
          <Button
            variant="ghost"
            className="rounded-full text-xs text-muted-foreground"
            onClick={handleStaffAction}
          >
            <KeyRound /> Staff access
          </Button>
        )}
      </header>

      <Tabs value={view} onValueChange={handleViewChange} className="gap-7">
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-none border-b bg-transparent p-0">
          <TabsTrigger value="matches">Matches</TabsTrigger>
          <TabsTrigger value="standings">Standings</TabsTrigger>
          <TabsTrigger value="knockouts">Knockouts</TabsTrigger>
          {isStaff ? <TabsTrigger value="scoring">Referee</TabsTrigger> : null}
          {isStaff ? <TabsTrigger value="organizer">Organizer</TabsTrigger> : null}
        </TabsList>
        {viewContent}
      </Tabs>

      <footer className="mt-10 flex flex-wrap justify-between gap-3 text-[0.625rem] text-muted-foreground">
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
