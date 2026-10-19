import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ConfigContext } from "../config";
import { I18nProvider } from "../i18n/I18nProvider";
import { PhotoCapture } from "./PhotoCapture";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function camera(onCaptured = vi.fn(), referenceUrl?: string) {
  return render(
    <StrictMode>
      <ConfigContext value={{ mode: "mock", pollDelay: () => 1 }}>
        <I18nProvider initial="ja">
          <PhotoCapture onCaptured={onCaptured} referenceUrl={referenceUrl} />
        </I18nProvider>
      </ConfigContext>
    </StrictMode>,
  );
}

it("can toggle the guide and captures only the unmirrored video frame", async () => {
  const stop = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => ({ getTracks: () => [{ stop }] }),
    },
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: draw,
  } as unknown as CanvasRenderingContext2D);
  const onCaptured = vi.fn();
  const { unmount } = camera(onCaptured, "blob:reference");
  const user = userEvent.setup();
  const guide = screen.getByRole("img", { name: "位置合わせ用の前の写真" });
  expect(guide).toHaveAttribute("src", "blob:reference");
  const toggle = screen.getByRole("switch", {
    name: "前の写真を重ねて位置を合わせる",
  });
  await user.click(toggle);
  expect(screen.queryByRole("img")).toBeNull();
  await user.click(toggle);
  const video = screen.getByLabelText("カメラのプレビュー");
  Object.defineProperties(video, {
    videoWidth: { value: 640 },
    videoHeight: { value: 480 },
  });
  await user.click(await screen.findByRole("button", { name: "撮影する" }));
  expect(draw).toHaveBeenCalledExactlyOnceWith(video, 0, 0, 640, 480);
  expect(onCaptured).toHaveBeenCalledOnce();
  expect(onCaptured.mock.calls[0][0]).toBeInstanceOf(Blob);
  unmount();
  expect(stop).toHaveBeenCalledTimes(2); // StrictMode's obsolete request and the active stream
});

it("discards an image whose encoding finishes after the capture screen is removed", async () => {
  let complete: BlobCallback | undefined;
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => {
      complete = callback;
    },
  );
  const onCaptured = vi.fn();
  const { unmount } = camera(onCaptured);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "テスト用の画像を使う" }),
  );
  expect(
    screen.getByRole("button", { name: "テスト用の画像を使う" }),
  ).toBeDisabled();
  unmount();
  await act(async () => {
    complete?.(new Blob(["late"]));
  });
  expect(onCaptured).not.toHaveBeenCalled();
});

it("stops a camera permission request that resolves after leaving", async () => {
  const stops: (() => void)[] = [];
  const pending: ((stream: MediaStream) => void)[] = [];
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => pending.push(resolve)),
    },
  });
  const { unmount } = camera();
  unmount();
  await act(async () => {
    for (const resolve of pending) {
      const stop = vi.fn();
      stops.push(stop);
      resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    }
  });
  expect(stops).toHaveLength(2);
  for (const stop of stops) expect(stop).toHaveBeenCalledOnce();
});
