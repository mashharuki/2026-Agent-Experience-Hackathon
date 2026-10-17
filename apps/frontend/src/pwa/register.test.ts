import { describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./register";

type Listener = () => void;

function fakeEnvironment(
  options: { controller?: boolean; waiting?: boolean } = {},
) {
  const postMessage = vi.fn();
  const registrationListeners: Record<string, Listener> = {};
  const workerListeners: Record<string, Listener> = {};
  const installing = {
    state: "installing",
    addEventListener: (type: string, fn: Listener) => {
      workerListeners[type] = fn;
    },
  };
  const registration = {
    waiting: options.waiting ? { postMessage } : null,
    installing: null as typeof installing | null,
    addEventListener: (type: string, fn: Listener) => {
      registrationListeners[type] = fn;
    },
  };
  const containerListeners: Record<string, Listener> = {};
  const container = {
    controller: options.controller ? {} : null,
    register: vi.fn(async () => registration),
    addEventListener: (type: string, fn: Listener) => {
      containerListeners[type] = fn;
    },
  };
  const reload = vi.fn();
  return {
    container,
    registration,
    installing,
    postMessage,
    registrationListeners,
    workerListeners,
    containerListeners,
    reload,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("registerServiceWorker", () => {
  it("registers /sw.js", async () => {
    const env = fakeEnvironment({ controller: true });
    registerServiceWorker(() => {}, {
      container: env.container,
      reload: env.reload,
    });
    await flush();
    expect(env.container.register).toHaveBeenCalledWith("/sw.js");
  });

  it("does nothing where service workers do not exist", () => {
    const onUpdate = vi.fn();
    expect(() =>
      registerServiceWorker(onUpdate, {
        container: undefined,
        reload: vi.fn(),
      }),
    ).not.toThrow();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("announces a new version that is already waiting", async () => {
    const env = fakeEnvironment({ controller: true, waiting: true });
    const onUpdate = vi.fn();
    registerServiceWorker(onUpdate, {
      container: env.container,
      reload: env.reload,
    });
    await flush();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("announces a version that finishes installing later", async () => {
    const env = fakeEnvironment({ controller: true });
    const onUpdate = vi.fn();
    registerServiceWorker(onUpdate, {
      container: env.container,
      reload: env.reload,
    });
    await flush();
    env.registration.installing = env.installing;
    env.registrationListeners.updatefound();
    env.installing.state = "installed";
    env.workerListeners.statechange();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("stays quiet on the very first install (nothing to update yet)", async () => {
    const env = fakeEnvironment({ controller: false });
    const onUpdate = vi.fn();
    registerServiceWorker(onUpdate, {
      container: env.container,
      reload: env.reload,
    });
    await flush();
    env.registration.installing = env.installing;
    env.registrationListeners.updatefound();
    env.installing.state = "installed";
    env.workerListeners.statechange();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("applies the update only when asked: tells the worker, then reloads once it took over", async () => {
    const env = fakeEnvironment({ controller: true, waiting: true });
    let apply = () => {};
    registerServiceWorker((fn) => (apply = fn), {
      container: env.container,
      reload: env.reload,
    });
    await flush();
    expect(env.postMessage).not.toHaveBeenCalled();
    expect(env.reload).not.toHaveBeenCalled();
    apply();
    expect(env.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(env.reload).not.toHaveBeenCalled();
    env.containerListeners.controllerchange();
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  it("survives a registration that fails", async () => {
    const env = fakeEnvironment();
    env.container.register.mockRejectedValueOnce(new Error("denied"));
    expect(() =>
      registerServiceWorker(() => {}, {
        container: env.container,
        reload: env.reload,
      }),
    ).not.toThrow();
    await flush();
  });
});
