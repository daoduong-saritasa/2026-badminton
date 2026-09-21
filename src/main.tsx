import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
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
const isRulesPath = /^\/rules\/?$/.test(window.location.pathname)
if (isRulesPath) document.title = messages.publicView.rules.heading

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isRulesPath ? (
      <RulesPage />
    ) : (
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    )}
  </StrictMode>,
)
