import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { dropPhoto, makePhoto } from "../features/session/photos";
import { I18nProvider } from "../i18n/I18nProvider";
import { PhotoDownloads } from "./PhotoDownloads";

afterEach(() => vi.restoreAllMocks());

it("requests the explicitly named photo without creating another URL or claiming completion", async () => {
  const before = makePhoto(new Blob(["before"], { type: "image/jpeg" }));
  const after = makePhoto(new Blob(["after"], { type: "image/jpeg" }));
  const clicked: { href: string; name: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ href: this.href, name: this.download });
  });
  const create = vi.spyOn(URL, "createObjectURL");
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  render(
    <I18nProvider initial="ja">
      <PhotoDownloads before={before} after={after} />
    </I18nProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "後の写真を保存" }));
  await user.click(screen.getByRole("button", { name: "前の写真を保存" }));
  expect(clicked).toEqual([
    { href: after.url, name: "photo-after.jpg" },
    { href: before.url, name: "photo-before.jpg" },
  ]);
  expect(create).not.toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("保存操作を開始");
  expect(document.querySelector("a[download]")).toBeNull();
  dropPhoto(before);
  dropPhoto(after);
});

it("keeps the photo available for another attempt after a browser handoff error", async () => {
  const photo = makePhoto(new Blob(["unchanged"]));
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementationOnce(() => {
      throw new Error("blocked");
    })
    .mockImplementation(() => {});
  render(
    <I18nProvider initial="ja">
      <PhotoDownloads current={photo} />
    </I18nProvider>,
  );
  const button = screen.getByRole("button", { name: "この写真を保存" });
  const user = userEvent.setup();
  await user.click(button);
  expect(screen.getByRole("alert")).toHaveTextContent("もう一度");
  expect(document.querySelector("a[download]")).toBeNull();
  await user.click(button);
  expect(click).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
  dropPhoto(photo);
});
