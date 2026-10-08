import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

import { messages } from '@/i18n/messages'


const stageBackgrounds = ['bg-mist', 'bg-ice/75', 'bg-peach/75'] as const
const rowKeys = ['who', 'fixture', 'match', 'pairs'] as const

function SectionHeading({ children }: { children: string }) {
  return <h2 className="mb-[1.125rem] text-lg font-semibold tracking-[-0.033em]">{children}</h2>
}

function RuleDetails({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <details className="group border-b border-line">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy [&::-webkit-details-marker]:hidden">
        {heading}
        <ChevronDown className="size-4 shrink-0 text-muted-ink group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="max-w-3xl pb-5 text-sm/[1.75]">{children}</div>
    </details>
  )
}

/**
 * The published rules as a standalone page, laid out stage by stage so players
 * can scan them from a shared link. It loads no tournament data and links
 * nowhere else.
 */
export function RulesPage() {
  return (
    <main className="app-shell view-enter space-y-[2.125rem]">
      <header>
        <h1 className="text-[clamp(1.4375rem,4vw,1.875rem)] font-extrabold tracking-[-0.0433em]">
          <span className="brand-mark" aria-hidden="true" />
          {messages.publicView.rules.heading}
        </h1>
        <p className="ml-[2.5625rem] mt-[7px] text-xs text-muted-ink">{messages.publicView.rules.summary}</p>
      </header>

      <div>
        <SectionHeading>{messages.publicView.rules.formatHeading}</SectionHeading>
        <p className="mb-2 text-sm/[1.65]">{messages.publicView.rules.teamRule}</p>
        <p className="mb-5 max-w-3xl text-sm/[1.65] text-muted-ink">{messages.publicView.rules.formatNote}</p>
        <ol className="grid gap-4 md:grid-cols-3">
          {messages.publicView.rules.stages.map((stage, index) => (
            <li className={`rounded-card border border-ink/10 p-5 ${stageBackgrounds[index]}`} key={stage.name}>
              <h3 className="text-[0.9375rem] font-semibold">{stage.name}</h3>
              <div className="mt-4 min-w-0">
                <p className="text-sm/[1.65] font-semibold">{stage.match}</p>
                <p className="mt-1 max-w-2xl text-sm/[1.65] text-muted-ink">{stage.overview}</p>
                <details className="group mt-2">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-navy focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy [&::-webkit-details-marker]:hidden">
                    {messages.publicView.rules.stageDetails}
                    <ChevronDown className="size-4 shrink-0 group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <dl className="max-w-2xl space-y-4 py-3 text-sm/[1.65]">
                    {rowKeys.map((key) => (
                      <div key={key}>
                        <dt className="text-xs font-semibold text-muted-ink">{messages.publicView.rules.rowLabels[key]}</dt>
                        <dd className="mt-0.5">{key === 'match' ? <strong className="font-semibold">{stage[key]}</strong> : stage[key]}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-sm/[1.65] font-medium">{messages.publicView.rules.gameRule}</p>
        <details className="mt-2 text-sm/[1.65]">
          <summary className="w-fit cursor-pointer rounded-field text-navy underline decoration-navy/30 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy">{messages.publicView.rules.scoringDetails}</summary>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-ink">
            {messages.publicView.rules.gameExamples.map((example) => <li key={example}>{example}</li>)}
          </ul>
        </details>
      </div>

      <section className="space-y-4">
        <SectionHeading>{messages.publicView.rules.pairingHeading}</SectionHeading>
        <p className="max-w-2xl text-sm/[1.75]">{messages.publicView.rules.pairingSummary}</p>
        <p className="max-w-2xl text-sm/[1.75] text-muted-ink">{messages.publicView.rules.pairingReminder}</p>
        <RuleDetails heading={messages.publicView.rules.pairingDetails}>
          <ol className="list-decimal space-y-1.5 pl-5">
            {messages.publicView.rules.pairing.map((item) => <li key={item}>{item}</li>)}
          </ol>
        </RuleDetails>
      </section>

      <section>
        <SectionHeading>{messages.publicView.rules.detailsHeading}</SectionHeading>
        <div className="border-t border-line">
          <RuleDetails heading={messages.publicView.rules.rankingHeading}>
            <ol className="list-decimal space-y-1 pl-5">
              {messages.publicView.rules.ranking.map((item) => <li key={item}>{item}</li>)}
            </ol>
            <p className="mt-3 text-sm text-muted-ink">{messages.publicView.rules.rankingNote}</p>
          </RuleDetails>
          <RuleDetails heading={messages.publicView.rules.playoffHeading}>
            <p className="mb-3">{messages.publicView.rules.playoffIntro}</p>
            <ul className="list-disc space-y-1.5 pl-5">
              {messages.publicView.rules.playoffs.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p className="mt-3">{messages.publicView.rules.playoffRepeat}</p>
          </RuleDetails>
          <RuleDetails heading={messages.publicView.rules.walkoverHeading}>
            <p>{messages.publicView.rules.walkover}</p>
          </RuleDetails>
        </div>
      </section>
    </main>
  )
}
