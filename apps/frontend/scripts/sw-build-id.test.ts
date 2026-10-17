// Every release must change sw.js, or browsers never notice there is something to update.
import { describe, expect, it } from "vitest";
import { stampBuildId } from "./sw-build-id";

// The real file mentions the placeholder in its header comment too: every mention must go.
const SOURCE =
  '/* __BUILD_ID__ is replaced */\nconst BUILD_ID = "__BUILD_ID__";\nconst x = 1;';

describe("stampBuildId", () => {
  it("replaces the placeholder with a short id derived from the page", () => {
    const stamped = stampBuildId(SOURCE, "<html>a</html>");
    expect(stamped).not.toContain("__BUILD_ID__");
    expect(stamped).toMatch(/BUILD_ID = "[0-9a-f]{12}"/);
  });

  it("gives the same id for the same build and a different one for another", () => {
    const a = stampBuildId(SOURCE, "<html>a</html>");
    expect(stampBuildId(SOURCE, "<html>a</html>")).toBe(a);
    expect(stampBuildId(SOURCE, "<html>b</html>")).not.toBe(a);
  });

  it("fails loudly when the placeholder is missing, instead of shipping an unversioned worker", () => {
    expect(() => stampBuildId("const x = 1;", "<html></html>")).toThrow(
      /BUILD_ID/,
    );
  });
});
