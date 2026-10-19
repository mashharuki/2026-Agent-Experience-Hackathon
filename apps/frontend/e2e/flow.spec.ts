import { readFile } from "node:fs/promises";
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

test("mock: real capture pixels, optional guide, A/B and explicit downloads", async ({
  page,
}) => {
  // Entirely synthetic video. Blue before, red after; no camera permission or face photo.
  await page.addInitScript(() => {
    const state = window as unknown as { captureColor: string };
    state.captureColor = "#1144ee";
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          const context = canvas.getContext("2d");
          const paint = () => {
            if (context) {
              context.fillStyle = state.captureColor;
              context.fillRect(0, 0, 640, 480);
            }
          };
          paint();
          const stream = canvas.captureStream(10);
          const timer = setInterval(() => {
            if (
              stream.getTracks().every((track) => track.readyState === "ended")
            )
              clearInterval(timer);
            else paint();
          }, 50);
          return stream;
        },
      },
    });
  });
  await page.reload();
  await consult(page);
  await page.getByRole("button", { name: "撮影する", exact: true }).click();
  const before = await page
    .getByRole("img", { name: "撮影した写真" })
    .getAttribute("src");
  await page.getByRole("button", { name: "この写真で相談する" }).click();
  await page.getByRole("button", { name: "やってみる", exact: true }).click();
  await page.evaluate(() => {
    (window as unknown as { captureColor: string }).captureColor = "#ee3311";
  });
  await page.getByRole("button", { name: "整えたので確認" }).click();
  const guide = page.getByRole("img", { name: "位置合わせ用の前の写真" });
  await expect(guide).toHaveAttribute("src", before ?? "");
  const toggle = page.getByRole("switch", {
    name: "前の写真を重ねて位置を合わせる",
  });
  await toggle.uncheck();
  await expect(guide).toHaveCount(0);
  await toggle.check();
  await expect(guide).toBeVisible();
  const video = page.getByLabel("カメラのプレビュー");
  expect(
    await video.evaluate((element) => getComputedStyle(element).transform),
  ).toBe(
    await guide.evaluate((element) => getComputedStyle(element).transform),
  );
  await page.getByRole("button", { name: "撮影する", exact: true }).click();
  const after = await page
    .getByRole("img", { name: "整えた後の写真" })
    .getAttribute("src");
  // Decode the real JPEG. A blue guide baked into the red frame would fail this check.
  const pixel = await page.evaluate(async (url) => {
    const image = new Image();
    image.src = url ?? "";
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d");
    context?.drawImage(image, 0, 0);
    return Array.from(context?.getImageData(320, 240, 1, 1).data ?? []);
  }, after);
  expect(pixel[0]).toBeGreaterThan(225);
  expect(pixel[2]).toBeLessThan(30);
  await page.getByRole("button", { name: "この写真で確認する" }).click();
  await expect(page.getByRole("heading", { name: "比べて選ぶ" })).toBeVisible();
  await page.getByRole("radio", { name: "差が分からない" }).check();
  await page.getByRole("button", { name: "一枚ずつ切り替える" }).click();
  await page.getByRole("button", { name: "整えた後", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "整える前", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("radio", { name: "差が分からない" }),
  ).toBeChecked();
  for (const [label, url, filename] of [
    ["前の写真を保存", before, "photo-before.jpg"],
    ["後の写真を保存", after, "photo-after.jpg"],
  ]) {
    const expected = await page.evaluate(
      async (src) =>
        Array.from(
          new Uint8Array(await (await fetch(src ?? "")).arrayBuffer()),
        ),
      url,
    );
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: label ?? "" }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(filename);
    const path = await download.path();
    expect(path).toBeTruthy();
    expect(Array.from(await readFile(path ?? ""))).toEqual(expected);
  }
  await page.screenshot({
    path: "test-results/photo-completion-single.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "並べて見る" }).click();
  await page.screenshot({
    path: "test-results/photo-completion-side.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "終える", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "前の写真を保存" }),
  ).toHaveCount(0);
});

test("mock: save an unchanged photo and finish without analysis", async ({
  page,
}) => {
  await consult(page);
  await page.getByRole("button", { name: "テスト用の画像を使う" }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "この写真を保存" }).click();
  expect((await pending).suggestedFilename()).toBe("photo.jpg");
  await page.getByRole("button", { name: "このままで終える" }).click();
  await expect(
    page.getByRole("button", { name: "もう一度はじめる" }),
  ).toBeVisible();
});
