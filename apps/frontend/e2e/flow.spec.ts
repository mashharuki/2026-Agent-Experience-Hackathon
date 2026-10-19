import { expect, type Page, test } from "@playwright/test";

async function consult(page: Page, scope = "眉") {
  await page.getByRole("radio", { name: scope, exact: true }).check();
  await page.getByRole("checkbox", { name: /同意します/ }).check();
  await page.getByRole("button", { name: "撮影へ進む" }).click();
}
async function photograph(page: Page, after = false) {
  await page.getByRole("button", { name: "テスト用の画像を使う" }).click();
  await page
    .getByRole("button", {
      name: after ? "この写真で確認する" : "この写真で相談する",
    })
    .click();
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    expect(new URL(route.request().url()).hostname).toBe("127.0.0.1");
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByTestId("mock-banner")).toContainText("モック");
});

test("mock: consult, try, compare, prefer before, finish", async ({ page }) => {
  await page.getByRole("checkbox", { name: "眉の形を変えない" }).check();
  await consult(page);
  await photograph(page);
  await expect(page.getByRole("heading", { name: "一つ試す" })).toBeVisible();
  await page.getByRole("button", { name: "やってみる" }).click();
  await page.getByRole("button", { name: "整えたので確認" }).click();
  await photograph(page, true);
  await expect(page.getByRole("heading", { name: "比べて選ぶ" })).toBeVisible();
  await page.getByRole("radio", { name: "前が好き" }).check();
  await page.getByRole("button", { name: "終える", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "もう一度はじめる" }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: "整える前" })).toHaveCount(0);
});

test("mock: answer a clarification without retaking the photo", async ({
  page,
}) => {
  await page.getByRole("combobox", { name: "モックの状況" }).click();
  await page.getByRole("option", { name: /あいまい/ }).click();
  await consult(page, "まず見てほしい");
  await photograph(page);
  await expect(page.getByRole("heading", { name: "確認する" })).toBeVisible();
  await page.getByRole("radio", { name: "眉", exact: true }).check();
  await page.getByRole("button", { name: "回答して続ける" }).click();
  await expect(page.getByRole("heading", { name: "一つ試す" })).toBeVisible();
  await page.screenshot({
    path: "test-results/clarification-advice.png",
    fullPage: true,
  });
});

test("mock: finish while analysis is waiting", async ({ page }) => {
  await consult(page);
  await photograph(page);
  await page.getByRole("button", { name: "このままで終える" }).click();
  await expect(
    page.getByRole("button", { name: "もう一度はじめる" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "一つ試す" })).toHaveCount(0);
});
