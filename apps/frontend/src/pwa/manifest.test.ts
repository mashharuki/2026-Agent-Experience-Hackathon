// What a browser needs before it offers "Add to Home Screen" (FR-029).
import { describe, expect, it } from "vitest";
import indexHtml from "../../index.html?raw";
import manifestText from "../../public/manifest.webmanifest?raw";

const manifest = JSON.parse(manifestText) as {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};
const available = Object.keys(
  import.meta.glob("../../public/icons/*.png", { query: "?url" }),
).map((path) => path.replace("../../public", ""));

describe("web app manifest", () => {
  it("opens as a standalone app at the root", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.name).toContain("Pre-photo prep");
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  });

  it("has colors for the splash screen and the title bar", () => {
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("offers 192 and 512 px icons plus a maskable one, and every file exists", () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((i) => i.purpose?.includes("maskable"))).toBe(
      true,
    );
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
      expect(available, icon.src).toContain(icon.src);
    }
  });
});

describe("entry page", () => {
  it("links the manifest, the theme color and the iPhone home screen icon", () => {
    expect(indexHtml).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(indexHtml).toMatch(/name="theme-color"/);
    expect(indexHtml).toContain(
      'rel="apple-touch-icon" href="/icons/apple-touch-icon.png"',
    );
    expect(available).toContain("/icons/apple-touch-icon.png");
  });

  it("has a real title instead of the template's", () => {
    expect(indexHtml).not.toMatch(/<title>frontend<\/title>/);
  });

  it("lets the page use the whole screen on phones with a notch", () => {
    expect(indexHtml).toContain("viewport-fit=cover");
  });
});
