import { expect, type Page, test } from "@playwright/test";

test("locks a prediction, observes explicit preview decisions, and resets after ending", async ({
  page,
}) => {
  await page.route("**/local-decider/health", (route) =>
    route.fulfill({ json: { ready: false } }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "艇を選んでください" }),
  ).toBeDisabled();
  await expect(page.locator(".engine-note")).toContainText("固定ルール");
  await page
    .locator(".prediction-options button")
    .filter({ hasText: "Aurora" })
    .click();
  await page.getByRole("button", { name: "この艇を予想して出走" }).click();
  await expect(page.locator(".locked-prediction")).toContainText("Aurora");
  await expect(page.locator(".prediction-options")).toHaveCount(0);
  await expect(page.locator(".decision-item").first()).toContainText("ルール");
  await page
    .locator(".fleet-standing button")
    .filter({ hasText: "Jade" })
    .click();
  await expect(page.locator(".mark-indicator")).toContainText("Jade");
  await expect(page.locator(".locked-prediction")).toContainText("Aurora");
  await expect(page.locator(".fleet-standing .is-prediction")).toHaveCount(1);
  await expect(page.locator(".fleet-standing .is-prediction")).toContainText(
    "Aurora",
  );
  await expect(page.locator(".instruments")).toContainText("Jadeの艇速");
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  await expect(page.getByRole("button", { name: "観戦を再開" })).toBeVisible();
  await page.getByRole("button", { name: "レースを終了", exact: true }).click();
  await page.getByRole("button", { name: "終了する" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("レース不成立・予想判定なし");
  await expect(dialog.locator(".MuiSlider-root")).toBeInViewport();
  await expect(dialog.locator(".result-order .is-prediction")).toContainText(
    "Aurora",
  );
  await dialog.getByRole("slider").press("Home");
  await dialog.getByRole("button", { name: "次のレースを予想" }).click();
  await expect(
    page.getByRole("button", { name: "艇を選んでください" }),
  ).toBeDisabled();
});

const startPreview = async (page: Page) => {
  await page.route("**/local-decider/health", (route) =>
    route.fulfill({ json: { ready: false } }),
  );
  await page.goto("/");
  await page
    .locator(".prediction-options button")
    .filter({ hasText: "Coral" })
    .click();
  await page.getByRole("button", { name: "この艇を予想して出走" }).click();
};

test("asks before ending a race", async ({ page }) => {
  await startPreview(page);
  await page.getByRole("button", { name: "レースを終了", exact: true }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm).toContainText("予想の判定は行われません");
  await expect(page.locator(".status")).toContainText("レース中");
  await confirm.getByRole("button", { name: "観戦を続ける" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".status")).toContainText("レース中");
  await page.getByRole("button", { name: "レースを終了", exact: true }).click();
  await page.getByRole("button", { name: "終了する" }).click();
  await expect(page.getByRole("dialog")).toContainText("レースの結果");
});

test("closes the end confirmation when the race finishes on its own", async ({
  page,
}) => {
  // ~760 rendered frames: software WebGL on CI runners is slow, so render small.
  test.setTimeout(process.env.CI ? 420_000 : 180_000);
  await page.setViewportSize({ width: 640, height: 480 });
  await page.clock.install();
  await startPreview(page);
  await page.getByRole("button", { name: "レースを終了", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "予想の判定は行われません",
  );
  // The runtime advances at most 250 ms per frame; 3 minutes of race time.
  for (let i = 0; i < 760; i++) await page.clock.fastForward(250);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toContainText("レースの結果");
  await expect(page.getByRole("dialog")).not.toContainText(
    "予想の判定は行われません",
  );
});

const minHeight = async (page: Page, selector: string) => {
  const boxes = await page
    .locator(selector)
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height),
    );
  expect(boxes.length).toBeGreaterThan(0);
  return Math.min(...boxes);
};

test("keeps touch targets large enough on phones", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startPreview(page);
  expect(await minHeight(page, ".view-switch button")).toBeGreaterThanOrEqual(
    44,
  );
  expect(
    await minHeight(page, ".fleet-standing button"),
  ).toBeGreaterThanOrEqual(44);
});

test("enlarges the course chart without covering the decision log", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startPreview(page);
  expect(await minHeight(page, ".view-switch button")).toBeGreaterThanOrEqual(
    36,
  );
  await expect(page.locator(".decision-item").nth(3)).toBeVisible({
    timeout: 15_000,
  });
  const feed = await page.locator(".decision-feed").boundingBox();
  const chart = page.getByRole("button", { name: "コース図" });
  const box = await chart.boundingBox();
  expect(feed && box && feed.y + feed.height <= box.y).toBe(true);
  expect(box?.width).toBeGreaterThanOrEqual(200);
  await chart.click();
  await expect(chart).toHaveAttribute("aria-expanded", "true");
  expect((await chart.boundingBox())?.width).toBeGreaterThanOrEqual(360);
});

test("keeps long English tactic names from pushing the log onto the chart", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/local-decider/health", (route) =>
    route.fulfill({ json: { ready: false } }),
  );
  await page.goto("/");
  await page.getByRole("combobox", { name: "Language / 言語" }).click();
  await page.getByRole("option", { name: "English" }).click();
  await page
    .locator(".prediction-options button")
    .filter({ hasText: "Jade" })
    .click();
  await page.getByRole("button", { name: "Lock prediction & start" }).click();
  // The first race uses the fixed default seed; Zephyr seeks pressure at 0:10.
  await expect(
    page.locator(".decision-item").filter({ hasText: "pressure" }),
  ).toBeVisible({ timeout: 20_000 });
  const feed = await page.locator(".decision-feed").boundingBox();
  const chart = await page.locator(".course-chart").boundingBox();
  expect(feed && chart && feed.y + feed.height <= chart.y).toBe(true);
});
