/**
 * Test-side `next-intl` double, imported for its side effect.
 *
 * WHY THIS EXISTS: the UI unit tests render client components bare under jsdom —
 * there is no app shell to mount `NextIntlClientProvider`, so every component that
 * calls `useTranslations()` throws
 *
 *   Failed to call `useTranslations` because the context from
 *   `NextIntlClientProvider` was not found
 *
 * and the downstream assertions then fail as null clicks / undefined setItem,
 * which look like component bugs. Importing this module FIRST in a test file
 * registers the mock before the component module is evaluated, so no per-file
 * provider plumbing is needed and no vitest config change is required.
 *
 * Two properties matter and were both learned the hard way:
 *  - the translator must be STABLE per namespace (a fresh closure per call makes
 *    any `useCallback([t])`/`useEffect([t])` consumer re-fire every render and
 *    `act()` never settles — the file then hangs instead of failing);
 *  - it must resolve REAL copy from `src/i18n/messages/en.json`, because tests
 *    assert on English strings and accessible names derived from them, not on
 *    `namespace.key` placeholders.
 */
import { vi } from "vitest";
import en from "../../src/i18n/messages/en.json";

type Messages = Record<string, unknown>;
type Values = Record<string, unknown>;

export function resolveMessage(namespace: string, key: string): string | undefined {
  // Namespaces themselves can be dotted (`playground.build` for BuildWizard), so
  // the namespace is split too — treating it as one literal key silently returns
  // undefined and the component then renders raw keys.
  const parts = [...namespace.split("."), ...key.split(".")].filter(Boolean);
  let node: unknown = en as Messages;
  for (const part of parts) {
    if (node && typeof node === "object" && part in (node as Messages)) {
      node = (node as Messages)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template: string, values?: Values): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match
  );
}

type Translator = ((key: string, values?: Values) => string) & {
  has: (key: string) => boolean;
  rich: (key: string, values?: Values) => string;
  markup: (key: string, values?: Values) => string;
  raw: (key: string) => string;
};

const translators = new Map<string, Translator>();

function translatorFor(namespace: string) {
  const cached = translators.get(namespace);
  if (cached) return cached;

  const t = ((key: string, values?: Values) => {
    const message = resolveMessage(namespace, key);
    // Fall back to the key itself, like next-intl does for a missing message.
    return interpolate(message ?? key, values);
  }) as Translator;

  t.has = (key: string) => resolveMessage(namespace, key) !== undefined;
  // `t.rich`/`t.markup` take React nodes or tag renderers for rich text. jsdom
  // assertions here only look at the resulting text, so returning the plain
  // interpolated string is faithful enough (and keeps the fixture small).
  t.rich = (key: string, values?: Values) => t(key, values);
  t.markup = (key: string, values?: Values) => t(key, values);
  t.raw = (key: string) => resolveMessage(namespace, key) ?? key;
  translators.set(namespace, t);
  return t;
}

vi.mock("next-intl", () => ({
  useTranslations: (namespace = "") => translatorFor(namespace),
  useLocale: () => "en",
  useFormatter: () => ({
    number: (value: number | bigint) => String(value),
    dateTime: (value: Date | number) => new Date(value).toISOString(),
    relativeTime: (value: Date | number) => String(value),
  }),
  useMessages: () => en,
  useNow: () => new Date(0),
  useTimeZone: () => "UTC",
  NextIntlClientProvider: ({ children }: { children?: unknown }) => children,
}));
