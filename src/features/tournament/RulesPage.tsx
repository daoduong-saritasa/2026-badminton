import type { ReactNode } from 'react'

import { messages } from '@/i18n/vi'

const { rules } = messages.publicView

/** Stage accents in playing order: qualifying, third place, final. */
const stageAccents = ['bg-cyan/10', 'bg-orange/10', 'bg-navy/10'] as const
const rowKeys = ['who', 'fixture', 'match', 'pairs'] as const

function SectionHeading({ children }: { children: string }) {
  return <h2 className="mb-[1.125rem] text-lg font-semibold tracking-[-0.033em]">{children}</h2>
}

function RuleCard({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-ink/5 bg-white p-5 text-sm/[1.65] shadow-card">
      <h3 className="mb-3 text-[0.9375rem] font-semibold">{heading}</h3>
      {children}
    </section>
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
          {rules.heading}
        </h1>
        <p className="ml-[2.5625rem] mt-[7px] text-xs text-muted-ink">{rules.summary}</p>
      </header>

      <div>
        <SectionHeading>{rules.formatHeading}</SectionHeading>
        <ol className="grid gap-6 md:grid-cols-3">
          {rules.stages.map((stage, index) => (
            <li className={`rounded-card border border-ink/5 shadow-card ${stageAccents[index]}`} key={stage.name}>
              <div className="p-5">
                <h3 className="flex items-center gap-2.5 text-[0.9375rem] font-semibold">
                  <span className="numeric grid size-6 place-items-center rounded-full bg-white text-xs font-bold text-muted-ink">{index + 1}</span>
                  {stage.name}
                </h3>
                <dl className="mt-4 space-y-3 text-sm/[1.55]">
                  {rowKeys.map((key) => (
                    <div key={key}>
                      <dt className="text-[0.6875rem] font-semibold text-muted-ink">{rules.rowLabels[key]}</dt>
                      <dd className="mt-0.5">{stage[key]}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-muted-ink">{rules.gameRule}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <RuleCard heading={rules.pairingHeading}>
          <ol className="list-decimal space-y-1.5 pl-5">
            {rules.pairing.map((item) => <li key={item}>{item}</li>)}
          </ol>
        </RuleCard>
        <RuleCard heading={rules.rankingHeading}>
          <ol className="list-decimal space-y-1 pl-5">
            {rules.ranking.map((item) => <li key={item}>{item}</li>)}
          </ol>
          <p className="mt-3 text-xs text-muted-ink">{rules.rankingNote}</p>
        </RuleCard>
        <RuleCard heading={rules.playoffHeading}>
          <ul className="list-disc space-y-1.5 pl-5">
            {rules.playoffs.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </RuleCard>
        <RuleCard heading={rules.walkoverHeading}>
          <p>{rules.walkover}</p>
        </RuleCard>
      </div>
    </main>
  )
}
