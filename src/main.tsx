import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import './App.css'
import { RulesPage } from './features/tournament/RulesPage.tsx'
import { messages } from './i18n/vi.ts'

const App = lazy(() => import('./App.tsx'))
const GuidePage = lazy(() => import('./features/guide/GuidePage.tsx').then((module) => ({ default: module.GuidePage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
    },
  },
})

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
