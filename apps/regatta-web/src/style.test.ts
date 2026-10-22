import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
const root = css.match(/:root\s*{([^}]*)}/)?.[1] ?? "";
const token = (name: string) => {
  const value = root.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
  if (!value) throw new Error(`missing --${name}`);
  return value;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (light + 0.05) / (dark + 0.05);
};
// Alpha is ignored: the opaque base must already pass.
const opaque = (value: string) => value.slice(0, 7);

describe("spectator design tokens", () => {
  it("keeps small text at 4.5:1 or more on panels and over the sea", () => {
    for (const background of ["surface", "surface-selected"]) {
      expect(
        contrast(token("text-muted"), token(background)),
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token("ink"), token(background))).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrast(token("positive"), token(background)),
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrast(token("on-sea"), opaque(token("scrim"))),
    ).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps the focus ring at 3:1 on panels and on the sea", () => {
    for (const background of ["surface", "surface-selected"])
      expect(
        contrast(token("focus-ring"), token(background)),
      ).toBeGreaterThanOrEqual(3);
    expect(contrast(token("focus"), token("sea"))).toBeGreaterThanOrEqual(3);
  });
  it("never sets text below 11px", () => {
    const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) =>
      Number(m[1]),
    );
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
  });
  it("uses tokens instead of raw colors outside :root", () => {
    const rest = css.replace(/:root\s*{[^}]*}/, "");
    expect(rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)).toBeNull();
  });
});
