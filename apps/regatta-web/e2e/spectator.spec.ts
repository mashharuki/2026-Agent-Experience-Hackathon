import { expect, test } from "@playwright/test";

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
