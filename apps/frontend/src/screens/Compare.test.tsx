import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import { Compare } from "./Compare";

afterEach(() => vi.restoreAllMocks());

it("keeps display, preference and download independent, including during a feedback failure", async () => {
  const onChoose = vi.fn();
  const onFinish = vi.fn();
  const download = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.href).toBe("blob:before");
    });
  render(
    <I18nProvider initial="ja">
      <Compare
        before={{ blob: new Blob(["before"]), url: "blob:before" }}
        after={{ blob: new Blob(["after"]), url: "blob:after" }}
        choice="unclear"
        busy={true}
        error="送信できませんでした"
        canTryAgain={false}
        onChoose={onChoose}
        onFinish={onFinish}
        onTryAgain={vi.fn()}
      />
    </I18nProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "一枚ずつ切り替える" }));
  await user.click(screen.getByRole("button", { name: "整えた後" }));
  expect(screen.getByRole("img", { name: "整えた後" })).toHaveAttribute(
    "src",
    "blob:after",
  );
  expect(screen.queryByRole("img", { name: "整える前" })).toBeNull();
  expect(screen.getByRole("radio", { name: "差が分からない" })).toBeChecked();
  expect(download).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "前の写真を保存" }));
  expect(download).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "並べて見る" }));
  expect(screen.getAllByRole("img")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "終える" }));
  expect(onFinish).toHaveBeenCalledOnce();
  expect(onChoose).not.toHaveBeenCalled();
});
