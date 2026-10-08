import { messages } from '@/i18n/messages'

export function LoadingScreen({ label = messages.app.loading }: { label?: string }) {
  return (
    <main className="app-shell" aria-busy="true" aria-label={label}>
      <span className="brand-mark" aria-hidden="true" />
      <p className="sr-only" role="status">{label}</p>
      <div className="loading-skeleton mt-8 h-14 rounded-field" />
      <div className="mt-6 grid gap-4 md:grid-cols-2" aria-hidden="true">
        <div className="loading-skeleton h-72 rounded-card" />
        <div className="loading-skeleton h-72 rounded-card" />
      </div>
    </main>
  )
}

