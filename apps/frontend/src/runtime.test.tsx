import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { expect, it } from "vitest";
import App from "./App";
import { createAppRuntime } from "./runtime";

it("uses the selected scenario through the generated client in StrictMode", async () => {
  const config = createAppRuntime({ mode: "mock", pollDelay: () => 1 });
  const user = userEvent.setup();
  render(
    <StrictMode>
      <App config={config} />
    </StrictMode>,
  );
  await user.click(
    await screen.findByRole("combobox", { name: "モックの状況" }),
  );
  await user.click(screen.getByRole("option", { name: /あいまい/ }));
  await user.click(screen.getByRole("radio", { name: "まず見てほしい" }));
  await user.click(screen.getByRole("checkbox", { name: /同意します/ }));
  await user.click(screen.getByRole("button", { name: "撮影へ進む" }));
  await user.click(
    await screen.findByRole("button", { name: "テスト用の画像を使う" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "この写真で相談する" }),
  );
  expect(await screen.findByText(/気になる箇所/)).toBeInTheDocument();
  expect(
    config.mock?.calls.some((call) => call.route.includes("analyses")),
  ).toBe(true);
});
