// End-to-end journey through the four screens with the REAL generated client, real hooks
// and the MOCK API (no network). Nothing here says anything about model quality.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import { createMockApi, type MockScenario } from "./mock/mock-api";
import { liveObjectUrls } from "./test/setup";

function setup(
  scenario: MockScenario = "normal",
  door?: Parameters<ReturnType<typeof createMockApi>["setDoor"]>[0],
) {
  const mock = createMockApi({ latencyMs: 0, scenario });
  if (door) mock.setDoor(door);
  const user = userEvent.setup();
  render(<App config={{ mode: "mock", mock, pollDelay: () => 5 }} />);
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
    await takeTestPhoto(user);
    await user.click(
      await screen.findByRole("button", { name: "この写真で確認する" }),
    );

    await screen.findByRole("heading", { name: "比べて選ぶ" });
    expect(screen.getByRole("img", { name: "整える前" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "整えた後" })).toBeInTheDocument();
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
