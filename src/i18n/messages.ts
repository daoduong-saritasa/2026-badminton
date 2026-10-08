import { en } from './en'
import { currentLocale, subscribeLocale, type Locale } from './locale'
import { vi } from './vi'

/** A catalog's shape with its literal strings widened, so each locale can fill it. */
type Catalog<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Catalog<R>
    : T extends object
      ? { readonly [K in keyof T]: Catalog<T[K]> }
      : T

export type Messages = Catalog<typeof vi>

const catalogs: Record<Locale, Messages> = { vi, en }

/**
 * The interface copy in the current locale. A live binding: it changes when
 * the locale does, so read it at render time rather than caching it.
 */
export let messages: Messages = catalogs[currentLocale()]

subscribeLocale(() => {
  messages = catalogs[currentLocale()]
})
