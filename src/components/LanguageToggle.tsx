import { Languages } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { setLocale, useLocale } from '@/i18n/locale'
import { messages } from '@/i18n/messages'

/** Switches between Vietnamese and English in one tap. */
export function LanguageToggle() {
  const locale = useLocale()
  return (
    <Button
      variant="outline"
      className="shrink-0 border-rule bg-transparent px-3 text-muted-ink hover:bg-white"
      aria-label={messages.app.switchLanguage}
      onClick={() => setLocale(locale === 'vi' ? 'en' : 'vi')}
    >
      <Languages /> <span aria-hidden="true">{messages.app.switchLanguageShort}</span>
    </Button>
  )
}
