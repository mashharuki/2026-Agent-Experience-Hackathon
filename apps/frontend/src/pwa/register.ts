export interface WorkerContainer {
  controller: unknown;
  register: (url: string) => Promise<Registration>;
  addEventListener: (type: string, listener: () => void) => void;
}

interface Registration {
  waiting: { postMessage: (message: unknown) => void } | null;
  installing: {
    state: string;
    addEventListener: (type: string, listener: () => void) => void;
  } | null;
  addEventListener: (type: string, listener: () => void) => void;
}

export interface RegisterEnvironment {
  container: WorkerContainer | undefined;
  reload: () => void;
}

/**
 * Register the service worker and tell the caller when a NEW version is waiting. Nothing is
 * reloaded or swapped by itself: a photo in progress lives only in memory, so the person decides.
 */
export function registerServiceWorker(
  onUpdate: (apply: () => void) => void,
  env: RegisterEnvironment = {
    container:
      typeof navigator !== "undefined" && "serviceWorker" in navigator
        ? (navigator.serviceWorker as unknown as WorkerContainer)
        : undefined,
    reload: () => window.location.reload(),
  },
): void {
  const { container } = env;
  if (!container) return;

  container
    .register("/sw.js")
    .then((registration) => {
      const apply = () => {
        container.addEventListener("controllerchange", () => env.reload());
        registration.waiting?.postMessage({ type: "SKIP_WAITING" });
      };
      // The first install has no controller yet: there is nothing to "update" from.
      if (registration.waiting && container.controller) onUpdate(apply);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && container.controller)
            onUpdate(apply);
        });
      });
    })
    .catch(() => {
      // The app works without it; it just will not be installable or cached.
    });
}
