// End-to-end journey through the four screens with the REAL generated client, real hooks
// and the MOCK API (no network). Nothing here says anything about model quality.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { setFetchImplementation } from "./api/custom-fetch";
import { createMockApi, type MockScenario } from "./mock/mock-api";
import { createAppRuntime } from "./runtime";
import { liveObjectUrls } from "./test/setup";

afterEach(() => vi.restoreAllMocks());

function setup(
  scenario: MockScenario = "normal",
  door?: Parameters<ReturnType<typeof createMockApi>["setDoor"]>[0],
) {
  const mock = createMockApi({ latencyMs: 0, scenario });
  if (door) mock.setDoor(door);
  const user = userEvent.setup();
  render(
    <App
      config={createAppRuntime({ mode: "mock", mock, pollDelay: () => 5 })}
    />,
  );
  return { mock, user };
}

async function consult(user: ReturnType<typeof userEvent.setup>, scope = "眉") {
  await user.click(await screen.findByRole("radio", { name: scope }));
  await user.click(screen.getByRole("checkbox", { name: /同意します/ }));
  await user.click(screen.getByRole("button", { name: "撮影へ進む" }));
}

async function takeTestPhoto(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "テスト用の画像を使う" }),
  );
}

const path = (mock: ReturnType<typeof createMockApi>) =>
  mock.calls.map((c) => `${c.method} ${c.route}`);

describe("the mock is always announced", () => {
  it("shows the mock banner on every screen", async () => {
    const { user } = setup();
    expect(screen.getByTestId("mock-banner")).toHaveTextContent("モック");
    await consult(user);
    expect(screen.getByTestId("mock-banner")).toBeInTheDocument();
    await takeTestPhoto(user);
    await user.click(
      await screen.findByRole("button", { name: "この写真で相談する" }),
    );
    await screen.findByRole("heading", { name: "一つ試す" });
    expect(screen.getByTestId("mock-banner")).toBeInTheDocument();
  });
});

describe("screen 1: consult", () => {
  it("can end and restart before session creation returns without applying the old response", async () => {
    const { user, mock } = setup();
    let release: (() => void) | undefined;
    let delay = true;
    setFetchImplementation((input, init) =>
      String(input).endsWith("/sessions") && init?.method === "POST" && delay
        ? new Promise<Response>((resolve) => {
            release = () => {
              void mock.fetch(input, init).then(resolve);
            };
          })
        : mock.fetch(input, init),
    );
    await consult(user);
    await user.click(
      screen.getByRole("button", { name: "同意しない（終了する）" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "もう一度はじめる" }),
    );
    delay = false;
    release?.();
    await waitFor(() =>
      expect(mock.calls.some((call) => call.method === "DELETE")).toBe(true),
    );
    expect(
      screen.getByRole("heading", { name: "相談する" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "試し撮り" }),
    ).not.toBeInTheDocument();
  });
  it("sends explicit restrictions with the session", async () => {
    const { user, mock } = setup();
    await user.click(
      await screen.findByRole("checkbox", { name: "眉の形を変えない" }),
    );
    await consult(user);
    const call = mock.calls.find(
      (c) => c.method === "POST" && c.route === "/sessions",
    );
    expect(call?.body).toMatchObject({ restrictions: ["keep_brow_shape"] });
  });
  it("cannot continue without a scope and the cloud-analysis consent", async () => {
    const { user, mock } = setup();
    const next = await screen.findByRole("button", { name: "撮影へ進む" });
    expect(next).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "眉" }));
    expect(next).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /同意します/ }));
    expect(next).toBeEnabled();
    expect(path(mock)).toEqual(["GET /service-status"]); // only the status check; no session yet
  });

  it("explains cloud analysis and deletion before any photo is taken", async () => {
    setup();
    expect(
      await screen.findByText(/クラウド（AWS）に送られて解析されます/),
    ).toBeInTheDocument();
    expect(screen.getByText(/24時間以内/)).toBeInTheDocument();
  });

  it("limits the optional wish to 200 characters", async () => {
    const { user } = setup();
    const wish = await screen.findByRole("textbox", { name: /希望/ });
    expect(wish).toHaveAttribute("maxlength", "200");
    await user.type(wish, "眉の形は変えたくない");
    expect(wish).toHaveValue("眉の形は変えたくない");
  });
});

describe("the full journey", () => {
  it("consult -> trial photo -> one suggestion -> try -> recheck -> compare -> choose -> finish", async () => {
    const download = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const { user, mock } = setup();
    await consult(user);

    await screen.findByRole("heading", { name: "試し撮り" });
    await takeTestPhoto(user);
    await user.click(
      await screen.findByRole("button", { name: "この写真で相談する" }),
    );

    await screen.findByRole("heading", { name: "一つ試す" });
    expect(await screen.findByText(/モックの助言/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "やってみる" }));

    // While tidying up there is no new advice, only the recheck action.
    expect(await screen.findByText(/整えたら/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "別の提案" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "整えたので確認" }));
    const beforeGuide = path(mock);
    await user.click(
      screen.getByRole("switch", { name: "前の写真を重ねて位置を合わせる" }),
    );
    expect(path(mock)).toEqual(beforeGuide);
    await takeTestPhoto(user);
    await user.click(
      await screen.findByRole("button", { name: "この写真で確認する" }),
    );

    await screen.findByRole("heading", { name: "比べて選ぶ" });
    expect(screen.getByRole("img", { name: "整える前" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "整えた後" })).toBeInTheDocument();
    const beforeLocalActions = path(mock);
    await user.click(
      screen.getByRole("button", { name: "一枚ずつ切り替える" }),
    );
    await user.click(screen.getByRole("button", { name: "整えた後" }));
    await user.click(screen.getByRole("button", { name: "前の写真を保存" }));
    await user.click(screen.getByRole("button", { name: "後の写真を保存" }));
    await user.click(screen.getByRole("button", { name: "並べて見る" }));
    expect(download).toHaveBeenCalledTimes(2);
    expect(path(mock)).toEqual(beforeLocalActions);
    await user.click(screen.getByRole("radio", { name: "前が好き" }));
    await user.click(screen.getByRole("button", { name: "終える" }));

    await screen.findByRole("heading", { name: "おつかれさまでした" });
    expect(path(mock)).toEqual(
      expect.arrayContaining([
        "POST /sessions",
        "POST /sessions/{sessionId}/uploads",
        "POST /sessions/{sessionId}/analyses",
        "GET /jobs/{jobId}",
        "POST /sessions/{sessionId}/feedback",
      ]),
    );
    expect(
      mock.feedback.map((f) => f.adviceResponse ?? f.comparisonChoice),
    ).toEqual(["try", "prefer_before", "finish"]);
  });

  it("lets the user end right away without changing anything", async () => {
    const { user, mock } = setup();
    await consult(user);
    await takeTestPhoto(user);
    await user.click(
      await screen.findByRole("button", { name: "この写真で相談する" }),
    );
    await screen.findByRole("heading", { name: "一つ試す" });
    await user.click(screen.getByRole("button", { name: "このままで終える" }));
    await screen.findByRole("heading", { name: "おつかれさまでした" });
    expect(mock.feedback.map((f) => f.adviceResponse)).toEqual(["finish"]);
    expect(
      mock.calls.filter((c) => c.route.endsWith("/analyses")),
    ).toHaveLength(1);
  });

  it("offers one more change from the comparison, and only while a change is left", async () => {
    const { user, mock } = setup();
    await consult(user);
    await takeTestPhoto(user);
    await user.click(
      await screen.findByRole("button", { name: "この写真で相談する" }),
    );
    await screen.findByRole("heading", { name: "一つ試す" });
    await user.click(await screen.findByRole("button", { name: "やってみる" }));
    await user.click(
      await screen.findByRole("button", { name: "整えたので確認" }),
    );
    await takeTestPhoto(user);
    await user.click(
      await screen.findByRole("button", { name: "この写真で確認する" }),
    );

    await screen.findByRole("heading", { name: "比べて選ぶ" });
    expect(screen.getByText(/次の一手/)).toBeInTheDocument(); // came with the same check
    const analysesBefore = mock.calls.filter((c) =>
      c.route.endsWith("/analyses"),
    ).length;
    await user.click(screen.getByRole("button", { name: "もう一手試す" }));
    expect(liveObjectUrls()).toBe(1); // the after photo is promoted; the old baseline is released

    // Straight to tidying up: no extra photo and no extra analysis were needed.
    await user.click(
      await screen.findByRole("button", { name: "整えたので確認" }),
    );
    expect(
      mock.calls.filter((c) => c.route.endsWith("/analyses")),
    ).toHaveLength(analysesBefore);
    await takeTestPhoto(user);
    await user.click(
      await screen.findByRole("button", { name: "この写真で確認する" }),
    );

    await screen.findByRole("heading", { name: "比べて選ぶ" });
    expect(
      screen.queryByRole("button", { name: "もう一手試す" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "終える" })).toBeInTheDocument();
    expect(
      mock.calls.filter((c) => c.route.endsWith("/analyses")),
    ).toHaveLength(3);
  });
});

describe("conditions that need a different next step", () => {
  it("answers a clarification without sending another photo", async () => {
    const { user, mock } = setup("vague");
    await consult(user, "まず見てほしい");
    await takeTestPhoto(user);
    await user.click(
      await screen.findByRole("button", { name: "この写真で相談する" }),
    );
    await screen.findByRole("heading", { name: "確認する" });
    await user.click(screen.getByRole("radio", { name: "眉" }));
    await user.click(screen.getByRole("button", { name: "回答して続ける" }));
    await screen.findByRole("heading", { name: "一つ試す" });
    expect(
      mock.calls.filter((call) => call.route.endsWith("/uploads")),
    ).toHaveLength(1);
    expect(
      mock.calls.find((call) => call.route.endsWith("/clarifications"))?.body,
    ).toMatchObject({ scope: "brow" });
  });

  it("can finish during polling and ignores a late success", async () => {
    const { user, mock } = setup();
    let complete: (() => void) | undefined;
    setFetchImplementation((input, init) =>
      String(input).includes("/jobs/")
        ? new Promise<Response>((resolve) => {
            complete = () => {
              void mock.fetch(input, init).then(resolve);
            };
          })
        : mock.fetch(input, init),
    );
    await consult(user);
    await takeTestPhoto(user);
    await user.click(
      await screen.findByRole("button", { name: "この写真で相談する" }),
    );
    await waitFor(() => expect(complete).toBeDefined());
    await user.click(screen.getByRole("button", { name: "このままで終える" }));
    await screen.findByRole("button", { name: "もう一度はじめる" });
    complete?.();
    await waitFor(() => expect(liveObjectUrls()).toBe(0));
    expect(
      screen.queryByRole("heading", { name: "一つ試す" }),
    ).not.toBeInTheDocument();
  });

  it("shows a GET failure and rechecks the same job without another analysis", async () => {
    const { user, mock } = setup();
    let failing = true;
    setFetchImplementation((input, init) =>
      String(input).includes("/jobs/") && failing
        ? Promise.resolve(new Response("{}", { status: 503 }))
        : mock.fetch(input, init),
    );
    await consult(user);
    await takeTestPhoto(user);
    await user.click(
      await screen.findByRole("button", { name: "この写真で相談する" }),
    );
    const recheck = await screen.findByRole("button", { name: "もう一度確認" });
    failing = false;
    await user.click(recheck);
    await screen.findByRole("heading", { name: "一つ試す" });
    expect(
      mock.calls.filter((call) => call.route.endsWith("/analyses")),
    ).toHaveLength(1);
  });
  it("shows one capture tip and lets the user retake instead of judging", async () => {
    const { user } = setup("backlight");
    await consult(user);
    await takeTestPhoto(user);
    await user.click(
      await screen.findByRole("button", { name: "この写真で相談する" }),
    );
    expect(await screen.findByText(/後ろ|逆光|光源/)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "試し撮り" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "撮り直す" }));
    await takeTestPhoto(user);
    await user.click(
      await screen.findByRole("button", { name: "この写真で相談する" }),
    );
    await screen.findByRole("heading", { name: "一つ試す" });
  });

  it("reports a failed analysis and allows another attempt", async () => {
    const { user } = setup("error");
    await consult(user);
    await takeTestPhoto(user);
    await user.click(
      await screen.findByRole("button", { name: "この写真で相談する" }),
    );
    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(/うまくいきませんでした/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "試し撮り" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "撮り直す" }),
    ).toBeInTheDocument();
  });
});

describe("photos stay in this browser tab", () => {
  it("can save an unchanged photo without sending it for analysis", async () => {
    const download = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const { user, mock } = setup();
    await consult(user);
    await takeTestPhoto(user);
    const calls = path(mock);
    await user.click(screen.getByRole("button", { name: "この写真を保存" }));
    expect(download).toHaveBeenCalledOnce();
    expect(path(mock)).toEqual(calls);
    expect(calls.some((c) => c.includes("/analyses"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "このままで終える" }));
    await screen.findByRole("heading", { name: "おつかれさまでした" });
    expect(liveObjectUrls()).toBe(0);
    expect(
      screen.getByText(/自分で保存したファイルは端末に残ります/),
    ).toBeInTheDocument();
  });

  it("does not mix a late capture into a restarted session", async () => {
    let complete: BlobCallback | undefined;
    const encode = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementationOnce((callback) => {
        complete = callback;
      });
    const { user } = setup();
    await consult(user);
    await takeTestPhoto(user);
    await user.click(screen.getByRole("button", { name: "このままで終える" }));
    await user.click(
      await screen.findByRole("button", { name: "もう一度はじめる" }),
    );
    await consult(user);
    await takeTestPhoto(user);
    const current = screen
      .getByRole("img", { name: "撮影した写真" })
      .getAttribute("src");
    const urls = liveObjectUrls();
    await act(async () => {
      complete?.(new Blob(["old-session"]));
    });
    expect(screen.getByRole("img", { name: "撮影した写真" })).toHaveAttribute(
      "src",
      current,
    );
    expect(liveObjectUrls()).toBe(urls);
    encode.mockRestore();
    await user.click(screen.getByRole("button", { name: "このままで終える" }));
    expect(liveObjectUrls()).toBe(0);
  });

  it("never writes photos to web storage and releases every object URL at the end", async () => {
    const { user } = setup();
    await consult(user);
    await takeTestPhoto(user);
    await user.click(
      await screen.findByRole("button", { name: "この写真で相談する" }),
    );
    await screen.findByRole("heading", { name: "一つ試す" });
    await user.click(screen.getByRole("button", { name: "このままで終える" }));
    await screen.findByRole("heading", { name: "おつかれさまでした" });

    const stored =
      JSON.stringify({ ...localStorage }) +
      JSON.stringify({ ...sessionStorage });
    expect(stored).not.toMatch(/jpeg|blob:|data:image/i);
    await waitFor(() => expect(liveObjectUrls()).toBe(0));
  });
});

describe("the door: closed means nothing can start", () => {
  it("shows why and does not offer the form, the consent or the camera", async () => {
    const { mock } = setup("normal", {
      accepting: false,
      reason: "worker_stopped",
    });
    expect(await screen.findByText(/いまは停止しています/)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "眉" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /同意します/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "撮影へ進む" }),
    ).not.toBeInTheDocument();
    expect(path(mock)).toEqual(["GET /service-status"]); // nothing but the status check was sent
  });

  it("says when it expects to reopen while the worker is warming up", async () => {
    setup("normal", {
      accepting: false,
      reason: "warming_up",
      expectedReopenAt: "2026-10-18T09:05:00.000Z",
    });
    expect(await screen.findByText(/準備中です/)).toBeInTheDocument();
    expect(screen.getByText(/再開できる見込み/)).toBeInTheDocument();
  });

  it("explains a used-up daily quota", async () => {
    setup("normal", { accepting: false, reason: "quota_exhausted" });
    expect(await screen.findByText(/本日の利用枠/)).toBeInTheDocument();
  });

  it("lets the user check again, and shows the form once the door opens", async () => {
    const { mock, user } = setup("normal", {
      accepting: false,
      reason: "worker_stopped",
    });
    await screen.findByText(/いまは停止しています/);
    mock.setDoor({ accepting: true, reason: "open" });
    await user.click(screen.getByRole("button", { name: "もう一度確認" }));
    expect(
      await screen.findByRole("radio", { name: "眉" }),
    ).toBeInTheDocument();
  });

  it("treats a failed status check as closed, never as open", async () => {
    const { mock } = setup("normal", {
      accepting: true,
      reason: "open",
      failing: true,
    });
    expect(
      await screen.findByText(/受付の状態を確認できませんでした/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "眉" })).not.toBeInTheDocument();
    expect(mock.calls.some((c) => c.route === "/sessions")).toBe(false);
  });

  it("shows a clear message and still allows finishing when the door closes mid-session", async () => {
    const { mock, user } = setup();
    await consult(user);
    await takeTestPhoto(user);
    mock.setDoor({ accepting: false, reason: "maintenance" });
    await user.click(
      await screen.findByRole("button", { name: "この写真で相談する" }),
    );
    expect(
      await screen.findByText(/いまは受け付けていません/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "このままで終える" }));
    await screen.findByRole("heading", { name: "おつかれさまでした" });
    expect(path(mock)).toContain("DELETE /sessions/{sessionId}");
  });
});

describe("consent and finishing", () => {
  it("lets a person decline: nothing is sent and no photo is ever taken", async () => {
    const { mock, user } = setup();
    await user.click(
      await screen.findByRole("button", { name: "同意しない（終了する）" }),
    );
    await screen.findByRole("heading", { name: "おつかれさまでした" });
    expect(screen.getByText(/写真は送られていません/)).toBeInTheDocument();
    expect(path(mock)).toEqual(["GET /service-status"]);
  });

  it("ends the session on the server when finishing, so the photos are deleted there too", async () => {
    const { mock, user } = setup();
    await consult(user);
    await takeTestPhoto(user);
    await user.click(
      await screen.findByRole("button", { name: "この写真で相談する" }),
    );
    await screen.findByRole("heading", { name: "一つ試す" });
    await user.click(screen.getByRole("button", { name: "このままで終える" }));
    await screen.findByRole("heading", { name: "おつかれさまでした" });
    expect(
      path(mock).filter((r) => r === "DELETE /sessions/{sessionId}"),
    ).toHaveLength(1);
  });
});
