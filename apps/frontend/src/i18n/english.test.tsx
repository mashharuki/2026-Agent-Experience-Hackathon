// The same journey in English, and the language switch (FR-028).
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./../App";
import { createMockApi } from "./../mock/mock-api";
import { createAppRuntime } from "../runtime";
import { STORAGE_KEY } from "./languages";

const JAPANESE = /[ぁ-んァ-ン一-龥]/;

function setup() {
  const mock = createMockApi({ latencyMs: 0 });
  const user = userEvent.setup();
  render(
    <App
      config={createAppRuntime({ mode: "mock", mock, pollDelay: () => 5 })}
    />,
  );
  return { mock, user };
}

/** Everything a person can read on the page, except the language names themselves. */
function visibleText(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll("[lang]")) el.remove();
  return clone.innerText ?? clone.textContent ?? "";
}

describe("switching language", () => {
  it("starts in the device language and switches without reloading", async () => {
    const { user } = setup();
    expect(await screen.findByText("撮る前のひと手間")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(
      await screen.findByText("A little prep before the photo"),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("en");
  });

  it("opens in English when the person chose English before", async () => {
    localStorage.setItem(STORAGE_KEY, "en");
    setup();
    expect(
      await screen.findByText("A little prep before the photo"),
    ).toBeInTheDocument();
  });

  it("keeps the first screen free of Japanese in English", async () => {
    localStorage.setItem(STORAGE_KEY, "en");
    setup();
    await screen.findByRole("radio", { name: "Brows" });
    expect(visibleText()).not.toMatch(JAPANESE);
  });
});

describe("the journey in English", () => {
  it("sends the language with the session and shows English advice, errors and comparison", async () => {
    localStorage.setItem(STORAGE_KEY, "en");
    const { user, mock } = setup();
    await user.click(await screen.findByRole("radio", { name: "Brows" }));
    await user.click(
      screen.getByRole("checkbox", { name: /I agree to the cloud analysis/ }),
    );
    await user.click(screen.getByRole("button", { name: "Go to the photo" }));
    await user.click(
      await screen.findByRole("button", { name: "Use a test image" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Consult with this photo" }),
    );

    await screen.findByRole("heading", { name: "Try one thing" });
    expect(
      await screen.findByText(/\(Mock advice\) Brush your brows/),
    ).toBeInTheDocument();
    expect(mock.sessionLanguages).toEqual(["en"]);
    expect(visibleText()).not.toMatch(JAPANESE);

    await user.click(screen.getByRole("button", { name: "Try it" }));
    await user.click(
      await screen.findByRole("button", { name: "I've tidied up, check" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Use a test image" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Check with this photo" }),
    );
    await screen.findByRole("heading", { name: "Compare and choose" });
    await user.click(screen.getByRole("radio", { name: "I prefer after" }));
    await waitFor(() =>
      expect(screen.getByText(/Your choice was saved/)).toBeInTheDocument(),
    );
    expect(visibleText()).not.toMatch(JAPANESE);
  });

  it("shows API errors in English", async () => {
    localStorage.setItem(STORAGE_KEY, "en");
    const mock = createMockApi({ latencyMs: 0, scenario: "error" });
    const user = userEvent.setup();
    render(
      <App
        config={createAppRuntime({ mode: "mock", mock, pollDelay: () => 5 })}
      />,
    );
    await user.click(await screen.findByRole("radio", { name: "Bangs" }));
    await user.click(screen.getByRole("checkbox", { name: /I agree/ }));
    await user.click(screen.getByRole("button", { name: "Go to the photo" }));
    await user.click(
      await screen.findByRole("button", { name: "Use a test image" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Consult with this photo" }),
    );
    expect(
      await screen.findByText(/The analysis did not work/),
    ).toBeInTheDocument();
    expect(visibleText()).not.toMatch(JAPANESE);
  });
});
