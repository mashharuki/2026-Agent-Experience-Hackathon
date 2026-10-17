import { Alert, Button } from "@mui/material";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { registerServiceWorker } from "./register";

type Register = (onUpdate: (apply: () => void) => void) => void;

// Only a production build is installed as a PWA: a worker in the dev server would hide edits.
const defaultRegister: Register = (onUpdate) => {
  if (import.meta.env.PROD) registerServiceWorker(onUpdate);
};

/** Offered when a new version is waiting. Updating reloads the page, so it is the person's call. */
export function UpdateBanner({
  register = defaultRegister,
}: {
  register?: Register;
}) {
  const { t } = useI18n();
  const [apply, setApply] = useState<(() => void) | undefined>();

  useEffect(() => {
    register((fn) => setApply(() => fn));
  }, [register]);

  if (!apply) return null;
  return (
    <Alert
      severity="info"
      role="status"
      sx={{ borderRadius: 0 }}
      action={
        <Button color="inherit" size="small" onClick={apply}>
          {t("pwa.updateButton")}
        </Button>
      }
    >
      {t("pwa.update")}
    </Alert>
  );
}

/** Shown while the device has no connection: photos can neither be analyzed nor sent. */
export function OfflineNotice() {
  const { t } = useI18n();
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (online) return null;
  return (
    <Alert severity="warning" role="alert" sx={{ borderRadius: 0 }}>
      {t("pwa.offline")}
    </Alert>
  );
}
