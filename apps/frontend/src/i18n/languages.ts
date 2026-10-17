export type Language = "ja" | "en";

export const LANGUAGES: readonly Language[] = ["ja", "en"];
export const STORAGE_KEY = "photoprep.language";

function isLanguage(value: unknown): value is Language {
  return value === "ja" || value === "en";
}

/** A stored choice wins; otherwise Japanese for a Japanese device, English for everything else. */
export function detectLanguage(
  stored: string | null | undefined,
  deviceLanguages: readonly string[],
): Language {
  if (isLanguage(stored)) return stored;
  const first = deviceLanguages[0]?.toLowerCase() ?? "";
  return first === "ja" || first.startsWith("ja-") ? "ja" : "en";
}

export function readStoredLanguage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // blocked storage: just detect from the device
  }
}

export function storeLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // The choice still applies for this visit.
  }
}

export function initialLanguage(): Language {
  const device =
    typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
  return detectLanguage(readStoredLanguage(), device);
}
