import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ArrowLeft, KeyRound, RefreshCw, ListOrdered, Trophy, Volleyball } from 'lucide-react'

import { fetchTournament, subscribeTournament } from '@/data/tournament'
import { getStaffAccess } from '@/data/staff'
import type { StaffAccess, TournamentSnapshot, TournamentStage } from '@/domain/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { LoadingScreen } from '@/components/LoadingScreen'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StaffAccessDialog } from '@/features/staff/StaffAccessDialog'
import { errorMessage } from '@/i18n/errors'
import { messages } from '@/i18n/vi'
import { StaffMenu } from '@/features/staff/StaffMenu'
import { ScoreTracker } from '@/features/scoring/ScoreTracker'
import { OrganizerPage, type OrganizerSection } from '@/features/organizer/OrganizerPage'
import { SetupForm } from '@/features/organizer/SetupForm'
import { KnockoutBracket } from '@/features/tournament/KnockoutBracket'
import { StandingsTable } from '@/features/tournament/StandingsTable'
import { tournamentTitle } from '@/features/tournament/document-title'
import { TournamentPage } from '@/features/tournament/TournamentPage'

type PublicView = 'matches' | 'standings' | 'knockouts'
type StaffView = 'scoring' | 'organizer'
type AppView = PublicView | StaffView

const tournamentQueryKey = ['tournament'] as const
const staffQueryKey = ['staff-access'] as const

const tabTriggerClass = 'min-h-14 min-w-0 flex-1 flex-col gap-1 whitespace-normal rounded-field px-2 py-2 text-center text-xs font-medium text-muted-ink hover:bg-peach hover:text-navy data-active:bg-orange data-active:text-white data-active:hover:bg-orange data-active:hover:text-white after:hidden sm:flex-row sm:gap-2 sm:text-sm'

function defaultView(stage: TournamentStage): PublicView {
  if (stage === 'knockouts' || stage === 'completed') return 'knockouts'
  return 'matches'
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
        <h1 className="text-2xl font-extrabold tracking-tight"><span className="brand-mark" aria-hidden="true" />{messages.app.setupHeading}</h1>
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
      // Staff views render outside the public tabs.
      return null
  }
}

export default function App() {
  const queryClient = useQueryClient()
  const [selectedView, setSelectedView] = useState<AppView | null>(null)
  const [organizerSection, setOrganizerSection] = useState<OrganizerSection>('overview')
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
    setOrganizerSection('overview')
  }
  if (view === 'scoring' && staffAccess) {
    return <ScoreTracker snapshot={snapshot} resetGeneration={tournamentState.resetGeneration} role={staffAccess.role} onExit={() => setSelectedView(isOrganizer ? 'organizer' : 'matches')} />
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
            <h1 className="text-[clamp(1.5rem,5vw,2rem)] font-extrabold tracking-[-0.0433em] [overflow-wrap:anywhere]">
              <span className="brand-mark" aria-hidden="true" />
              {snapshot.tournament.name}
            </h1>
          </div>
        </header>
        <OrganizerPage
          snapshot={snapshot}
          resetGeneration={tournamentState.resetGeneration}
          selectedSection={organizerSection}
          onSectionChange={setOrganizerSection}
          onOpenScoring={() => setSelectedView('scoring')}
        />
      </div>
    )
  }
  const viewContent = renderView(snapshot, view)
  const tabs: { value: PublicView; label: string }[] = [
    { value: 'matches', label: messages.app.tabs.matches },
    { value: 'standings', label: messages.app.tabs.standings },
    { value: 'knockouts', label: messages.app.tabs.knockouts },
  ]

  return (
    <div className="app-shell public-shell">
      <a className="skip-link" href="#tournament-content">{messages.app.skipToContent}</a>
      <header className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:gap-5">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.4375rem,4vw,1.875rem)] font-extrabold tracking-[-0.0433em] [overflow-wrap:anywhere]">
            <span className="brand-mark" aria-hidden="true" />
            {snapshot.tournament.name}
          </h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-ink">
            <span className="size-2 rounded-full bg-navy" aria-hidden="true" />
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

      <a href="/guide" className="mb-4 inline-block text-sm font-medium text-navy underline underline-offset-4">{messages.guide.heading}</a>
      <Tabs value={view} onValueChange={handleViewChange} className="gap-6">
        <TabsList variant="default" className="court-navigation w-full items-stretch gap-1 rounded-card p-1.5 group-data-horizontal/tabs:h-auto">
          {tabs.map((tab) => (
            <TabsTrigger className={tabTriggerClass} key={tab.value} value={tab.value}>
              {tab.value === 'matches' ? <Volleyball className="size-5" aria-hidden="true" /> : null}
              {tab.value === 'standings' ? <ListOrdered className="size-5" aria-hidden="true" /> : null}
              {tab.value === 'knockouts' ? <Trophy className="size-5" aria-hidden="true" /> : null}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <main id="tournament-content" tabIndex={-1}>{viewContent}</main>
      </Tabs>

      <StaffAccessDialog
        open={staffDialogOpen}
        onOpenChange={setStaffDialogOpen}
        onGranted={handleStaffGranted}
      />
    </div>
  )
}
