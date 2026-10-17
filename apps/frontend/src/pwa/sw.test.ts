// The service worker only ever speeds up the static app shell (FR-029). It must never touch the
// API, S3, Cognito, the sign-in callback, or anything that is not a plain GET of our own files.
import { beforeEach, describe, expect, it, vi } from "vitest";
import SOURCE from "./sw.js?raw";

const ORIGIN = "https://app.example";

type Listener = (event: Record<string, unknown>) => void;

function load(options: { online?: boolean } = {}) {
  const listeners: Record<string, Listener> = {};
  const stores = new Map<string, Map<string, Response>>();
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name) as Map<string, Response>;
      return {
        put: async (request: Request | string, response: Response) => {
          store.set(
            typeof request === "string"
              ? request
              : new URL(request.url).pathname,
            response,
          );
        },
        add: async (path: string) => {
          store.set(path, new Response("<html>shell</html>", { status: 200 }));
        },
        match: async (request: Request | string) =>
          store
            .get(
              typeof request === "string"
                ? request
                : new URL(request.url).pathname,
            )
            ?.clone(),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: Request | string) => {
      const path =
        typeof request === "string" ? request : new URL(request.url).pathname;
      for (const store of stores.values())
        if (store.has(path)) return store.get(path)?.clone();
      return undefined;
    },
  };
  const network = vi.fn(async (request: Request) => {
    if (options.online === false) throw new TypeError("offline");
    return new Response(`net:${new URL(request.url).pathname}`, {
      status: 200,
    });
  });
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn;
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => {}) },
  };
  new Function("self", "caches", "fetch", "Response", "URL", SOURCE)(
    self,
    caches,
    network,
    Response,
    URL,
  );
  return { listeners, stores, caches, network, self };
}

/** Fire a fetch event; returns the response the worker produced, or "ignored". */
async function fire(
  world: ReturnType<typeof load>,
  url: string,
  init: { method?: string; mode?: string } = {},
): Promise<Response | "ignored"> {
  const request = new Request(url, { method: init.method ?? "GET" });
  Object.defineProperty(request, "mode", { value: init.mode ?? "cors" });
  let answered: Promise<Response> | undefined;
  world.listeners.fetch({
    request,
    respondWith: (promise: Promise<Response>) => {
      answered = promise;
    },
  });
  return answered ? await answered : "ignored";
}

describe("what it leaves alone", () => {
  let world: ReturnType<typeof load>;
  beforeEach(() => {
    world = load();
  });

  it("ignores the API, S3 and Cognito (other origins)", async () => {
    for (const url of [
      "https://abc.execute-api.ap-northeast-1.amazonaws.com/sessions",
      "https://bucket.s3.ap-northeast-1.amazonaws.com/",
      "https://photoprep-1.auth.ap-northeast-1.amazoncognito.com/oauth2/token",
    ]) {
      expect(await fire(world, url)).toBe("ignored");
    }
  });

  it("ignores other origins even when the path looks like one of our static files", async () => {
    expect(await fire(world, "https://cdn.example/assets/index-abc.js")).toBe(
      "ignored",
    );
    expect(await fire(world, "https://other.example/icons/a.png")).toBe(
      "ignored",
    );
    expect(
      await fire(world, "https://other.example/", { mode: "navigate" }),
    ).toBe("ignored");
    expect(world.stores.size).toBe(0);
  });

  it("ignores anything that is not a GET (uploads, feedback, sign-in token exchange)", async () => {
    expect(await fire(world, `${ORIGIN}/assets/x.js`, { method: "POST" })).toBe(
      "ignored",
    );
  });

  it("ignores the sign-in callback so a login code is never cached or replayed", async () => {
    expect(
      await fire(world, `${ORIGIN}/auth/callback?code=abc&state=s`, {
        mode: "navigate",
      }),
    ).toBe("ignored");
    expect(world.stores.size).toBe(0);
  });

  it("ignores its own files and unknown paths on our origin", async () => {
    for (const path of [
      "/sw.js",
      "/sessions",
      "/jobs/123",
      "/service-status",
    ]) {
      expect(await fire(world, `${ORIGIN}${path}`)).toBe("ignored");
    }
  });
});

describe("pages", () => {
  it("serves the network page when online and keeps the shell for later", async () => {
    const world = load();
    const response = await fire(world, `${ORIGIN}/`, { mode: "navigate" });
    expect(response).not.toBe("ignored");
    expect(await (response as Response).text()).toBe("net:/");
    const cached = [...world.stores.values()].flatMap((s) => [...s.keys()]);
    expect(cached).toContain("/index.html");
  });

  it("falls back to the cached shell offline", async () => {
    const online = load();
    await fire(online, `${ORIGIN}/`, { mode: "navigate" });
    const offline = load({ online: false });
    for (const [name, store] of online.stores) offline.stores.set(name, store);
    const response = (await fire(offline, `${ORIGIN}/`, {
      mode: "navigate",
    })) as Response;
    expect(response.status).toBe(200);
  });

  it("answers 503 (not a broken page) offline with nothing cached", async () => {
    const world = load({ online: false });
    const response = (await fire(world, `${ORIGIN}/`, {
      mode: "navigate",
    })) as Response;
    expect(response.status).toBe(503);
  });

  it("does not cache a failing page", async () => {
    const world = load();
    world.network.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await fire(world, `${ORIGIN}/`, { mode: "navigate" });
    expect(
      [...world.stores.values()].flatMap((s) => [...s.keys()]),
    ).not.toContain("/index.html");
  });
});

describe("static files", () => {
  it("serves hashed assets from the cache after the first load", async () => {
    const world = load();
    await fire(world, `${ORIGIN}/assets/index-abc.js`);
    await fire(world, `${ORIGIN}/assets/index-abc.js`);
    expect(world.network).toHaveBeenCalledTimes(1);
  });

  it("does not cache a response that says no-store", async () => {
    const world = load();
    world.network.mockResolvedValueOnce(
      new Response("secret", {
        status: 200,
        headers: { "cache-control": "no-store" },
      }),
    );
    await fire(world, `${ORIGIN}/assets/x.js`);
    await fire(world, `${ORIGIN}/assets/x.js`);
    expect(world.network).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures", async () => {
    const world = load();
    world.network.mockResolvedValueOnce(
      new Response("missing", { status: 404 }),
    );
    await fire(world, `${ORIGIN}/assets/gone.js`);
    await fire(world, `${ORIGIN}/assets/gone.js`);
    expect(world.network).toHaveBeenCalledTimes(2);
  });
});

describe("lifecycle", () => {
  it("removes only its own old caches when a new version activates", async () => {
    const world = load();
    world.stores.set("photoprep-shell-old", new Map());
    world.stores.set("someone-elses-cache", new Map());
    let done: Promise<unknown> | undefined;
    world.listeners.activate({
      waitUntil: (p: Promise<unknown>) => (done = p),
    });
    await done;
    expect(world.stores.has("photoprep-shell-old")).toBe(false);
    expect(world.stores.has("someone-elses-cache")).toBe(true);
    expect(world.self.clients.claim).toHaveBeenCalled();
  });

  it("does not take over by itself: a new version waits until the person agrees", () => {
    const world = load();
    world.listeners.install({ waitUntil: () => {} });
    expect(world.self.skipWaiting).not.toHaveBeenCalled();
    world.listeners.message({ data: { type: "SKIP_WAITING" } });
    expect(world.self.skipWaiting).toHaveBeenCalled();
  });

  it("ignores unrelated messages", () => {
    const world = load();
    world.listeners.message({ data: { type: "something-else" } });
    world.listeners.message({ data: undefined });
    expect(world.self.skipWaiting).not.toHaveBeenCalled();
  });
});
