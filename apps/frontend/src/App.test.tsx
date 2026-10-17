// End-to-end journey through the four screens with the REAL generated client, real hooks
// and the MOCK API (no network). Nothing here says anything about model quality.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import { createMockApi, type MockScenario } from "./mock/mock-api";
import { liveObjectUrls } from "./test/setup";

function setup(scenario: MockScenario = "normal") {
  const mock = createMockApi({ latencyMs: 0, scenario });
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
    expect(mock.calls).toHaveLength(0); // nothing is sent before the user continues
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
