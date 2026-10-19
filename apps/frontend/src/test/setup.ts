import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { setFetchImplementation } from "../api/custom-fetch";

Object.defineProperty(navigator, "languages", {
  value: ["ja-JP"],
  configurable: true,
});
Object.defineProperty(navigator, "language", {
  value: "ja-JP",
  configurable: true,
});

afterEach(() => {
  cleanup();
  setFetchImplementation((...args) => fetch(...args));
  sessionStorage.clear();
  localStorage.clear();
});

// jsdom has no canvas or object URLs. The fake photo is obviously not a real image.
const FAKE_JPEG = () => new Blob(["fake-jpeg"], { type: "image/jpeg" });
let urlCounter = 0;
const created = new Set<string>();
URL.createObjectURL = () => {
  const url = `blob:test/${++urlCounter}`;
  created.add(url);
  return url;
};
URL.revokeObjectURL = (url: string) => {
  created.delete(url);
};
export const liveObjectUrls = () => created.size;

HTMLCanvasElement.prototype.getContext = (() => ({
  fillRect: () => {},
  fillText: () => {},
  beginPath: () => {},
  arc: () => {},
  fill: () => {},
  drawImage: () => {},
  createLinearGradient: () => ({ addColorStop: () => {} }),
  set fillStyle(_v: unknown) {},
  set font(_v: unknown) {},
  set textAlign(_v: unknown) {},
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.toBlob = function toBlob(callback: BlobCallback) {
  callback(FAKE_JPEG());
};
