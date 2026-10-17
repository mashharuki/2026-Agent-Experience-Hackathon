import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import { OfflineNotice, UpdateBanner } from "./PwaNotices";

const wrap = (node: React.ReactNode, initial: "ja" | "en" = "ja") =>
  render(<I18nProvider initial={initial}>{node}</I18nProvider>);

describe("UpdateBanner", () => {
  it("is hidden until a new version is waiting, then offers the update", async () => {
    let announce: (apply: () => void) => void = () => {};
    const apply = vi.fn();
    wrap(<UpdateBanner register={(fn) => (announce = fn)} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => announce(apply));
    expect(screen.getByRole("status")).toHaveTextContent("新しい版");
    await userEvent.click(screen.getByRole("button", { name: "更新する" }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("warns that updating reloads the page, in English too", () => {
    let announce: (apply: () => void) => void = () => {};
    wrap(<UpdateBanner register={(fn) => (announce = fn)} />, "en");
    act(() => announce(() => {}));
    expect(screen.getByRole("status")).toHaveTextContent(/new version/i);
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });
});

describe("OfflineNotice", () => {
  it("appears when the connection is lost and goes when it returns", () => {
    wrap(<OfflineNotice />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    act(() => window.dispatchEvent(new Event("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent("オフライン");
    act(() => window.dispatchEvent(new Event("online")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("starts visible when the page opens offline", () => {
    const original = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "onLine",
    );
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true,
    });
    try {
      wrap(<OfflineNotice />, "en");
      expect(screen.getByRole("alert")).toHaveTextContent(/offline/i);
    } finally {
      // biome-ignore lint/performance/noDelete: restore the jsdom default
      delete (navigator as unknown as Record<string, unknown>).onLine;
      if (original)
        Object.defineProperty(Navigator.prototype, "onLine", original);
    }
  });
});
