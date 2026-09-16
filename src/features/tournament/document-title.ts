import { messages } from '../../i18n/vi'

/** The browser title: the tournament's own name, or the generic identity before setup. */
export function tournamentTitle(name: string | null): string {
  const trimmed = name?.trim() ?? ''
  return trimmed === '' ? messages.app.fallbackTitle : trimmed
}
