import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import { useI18n } from "../i18n/I18nProvider";
import { LANGUAGES } from "../i18n/languages";

/** Always reachable, on every screen: the person can change language at any time (FR-028). */
export function LanguageSwitch() {
  const { t, language, setLanguage } = useI18n();
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={language}
      aria-label={t("lang.label")}
      onChange={(_event, next) => {
        if (next === "ja" || next === "en") setLanguage(next);
      }}
    >
      {LANGUAGES.map((code) => (
        <ToggleButton
          key={code}
          value={code}
          lang={code}
          sx={{ px: 1.5, textTransform: "none" }}
        >
          {t(code === "ja" ? "lang.ja" : "lang.en")}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
