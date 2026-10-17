import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { en } from "./en";
import { I18nProvider, useI18n } from "./I18nProvider";
import { ja } from "./ja";
import { detectLanguage, STORAGE_KEY } from "./languages";

const JAPANESE = /[ぁ-んァ-ン一-龥]/;
// The language names are written in their own language on purpose.
const OWN_LANGUAGE_NAMES = new Set(["lang.ja"]);

describe("dictionaries", () => {
  it("have exactly the same keys in both languages", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort());
  });

  it("have no empty entries", () => {
    for (const [key, value] of [...Object.entries(ja), ...Object.entries(en)]) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("keep Japanese out of the English texts and the same placeholders in both", () => {
    for (const [key, value] of Object.entries(en)) {
      if (OWN_LANGUAGE_NAMES.has(key)) continue;
      expect(JAPANESE.test(value), key).toBe(false);
    }
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(ja) as (keyof typeof ja)[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(ja[key]));
    }
  });
});

describe("detectLanguage", () => {
  it("uses a stored choice first", () => {
    expect(detectLanguage("en", ["ja-JP"])).toBe("en");
    expect(detectLanguage("ja", ["en-US"])).toBe("ja");
  });

  it("falls back to the device language: Japanese for ja, English for everything else", () => {
    expect(detectLanguage(null, ["ja-JP"])).toBe("ja");
    expect(detectLanguage(null, ["ja"])).toBe("ja");
    expect(detectLanguage(null, ["en-US"])).toBe("en");
    expect(detectLanguage(null, ["fr-FR", "de"])).toBe("en");
    expect(detectLanguage(null, [])).toBe("en");
  });

  it("ignores a stored value it does not know", () => {
    expect(detectLanguage("fr", ["ja-JP"])).toBe("ja");
  });
});

function Probe() {
  const { t, language, setLanguage } = useI18n();
  return (
    <div>
      <p data-testid="text">{t("done.restart")}</p>
      <p data-testid="time">{t("door.reopen", { time: "10:30" })}</p>
      <p data-testid="lang">{language}</p>
      <button type="button" onClick={() => setLanguage("en")}>
        to-en
      </button>
      <button type="button" onClick={() => setLanguage("ja")}>
        to-ja
      </button>
    </div>
  );
}

describe("I18nProvider", () => {
  it("renders in the detected language and updates <html lang> when switched", () => {
    render(
      <I18nProvider initial="ja">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("text")).toHaveTextContent(ja["done.restart"]);
    expect(document.documentElement.lang).toBe("ja");
    act(() => screen.getByText("to-en").click());
    expect(screen.getByTestId("text")).toHaveTextContent(en["done.restart"]);
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe(en["app.title"]);
  });

  it("remembers the choice on the device, and works when storage is blocked", () => {
    render(
      <I18nProvider initial="ja">
        <Probe />
      </I18nProvider>,
    );
    act(() => screen.getByText("to-en").click());
    expect(localStorage.getItem(STORAGE_KEY)).toBe("en");

    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      act(() => screen.getByText("to-ja").click());
      expect(screen.getByTestId("lang")).toHaveTextContent("ja");
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("fills placeholders", () => {
    render(
      <I18nProvider initial="en">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("time")).toHaveTextContent("10:30");
  });
});
