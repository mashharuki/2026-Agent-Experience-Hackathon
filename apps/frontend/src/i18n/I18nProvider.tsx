import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { en } from "./en";
import { ja, type MessageKey } from "./ja";
import { initialLanguage, type Language, storeLanguage } from "./languages";

const DICTIONARIES: Record<Language, Record<MessageKey, string>> = { ja, en };

export type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string;

interface I18n {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: Language;
}) {
  const [language, setLanguageState] = useState<Language>(
    () => initial ?? initialLanguage(),
  );

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = DICTIONARIES[language]["app.title"];
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    storeLanguage(next);
  }, []);

  const value = useMemo<I18n>(() => {
    const dictionary = DICTIONARIES[language];
    const t: Translate = (key, vars) => {
      const text = dictionary[key];
      if (!vars) return text;
      return text.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match,
      );
    };
    return { language, setLanguage, t };
  }, [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("I18nProvider is missing");
  return value;
}
