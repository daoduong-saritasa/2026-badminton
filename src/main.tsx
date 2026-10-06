import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
const App = lazy(() => import('./App.tsx'))
const GuidePage = lazy(() => import('./features/guide/GuidePage.tsx').then((module) => ({ default: module.GuidePage })))
import { RulesPage } from './features/tournament/RulesPage.tsx'
import { messages } from './i18n/vi.ts'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
    },
  },
})

// The rules page is shared as a plain link, so it renders on its own without
// the tournament app, its data, or its navigation.
const isGuidePath = /^\/guide\/?$/.test(window.location.pathname)
const isRulesPath = /^\/rules\/?$/.test(window.location.pathname)
if (isGuidePath) document.title = messages.guide.heading
if (isRulesPath) document.title = messages.publicView.rules.heading

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<p>{messages.app.loading}</p>}>
    {isGuidePath ? <GuidePage /> : isRulesPath ? (
      <RulesPage />
    ) : (
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    )}
    </Suspense>
  </StrictMode>,
)
