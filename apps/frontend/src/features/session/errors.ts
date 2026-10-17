import { ApiError } from "../../api/custom-fetch";
import type { Translate } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/ja";

const KNOWN = new Set([
  "session_ended",
  "change_limit_reached",
  "analysis_limit_reached",
  "too_many_requests",
  "quota_exceeded",
  "service_unavailable",
  "not_accepting",
  "unauthenticated",
]);

/** A short, kind message for the user. Never includes anything the server echoed. */
export function messageFor(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    return KNOWN.has(error.code)
      ? t(`error.${error.code}` as MessageKey)
      : t("error.generic");
  }
  return t("error.network");
}
