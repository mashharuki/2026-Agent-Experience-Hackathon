import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  customFetch,
  setFetchImplementation,
  setUnauthorizedHandler,
} from "./custom-fetch";

function answer(status: number, body: string, headers: HeadersInit = {}) {
  setFetchImplementation(async () => new Response(body, { status, headers }));
}

async function failure(): Promise<ApiError> {
  try {
    await customFetch("/x", {});
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("expected the request to fail");
}

afterEach(() => setUnauthorizedHandler(undefined));

describe("errors from the API", () => {
  it("keeps the code of an error the API itself produced", async () => {
    answer(409, JSON.stringify({ code: "session_ended", message: "x" }));
    const error = await failure();
    expect(error).toBeInstanceOf(ApiError);
    expect([error.status, error.code]).toEqual([409, "session_ended"]);
  });

  it("treats the gateway's 401 (a body with no code) as an expired sign-in", async () => {
    // API Gateway's JWT authorizer answers {"message":"Unauthorized"} before our code runs.
    answer(401, JSON.stringify({ message: "Unauthorized" }));
    const error = await failure();
    expect([error.status, error.code]).toEqual([401, "unauthenticated"]);
  });

  it("treats a 401 with no body at all the same way", async () => {
    answer(401, "");
    expect((await failure()).code).toBe("unauthenticated");
  });

  it("turns a non-JSON error page (502, 504) into an ApiError, not a SyntaxError", async () => {
    answer(502, "<html>Bad Gateway</html>", { "content-type": "text/html" });
    const error = await failure();
    expect(error).toBeInstanceOf(ApiError);
    expect([error.status, error.code]).toEqual([502, "internal_error"]);
  });

  it("does the same for a plain-text error", async () => {
    answer(500, "Internal Server Error");
    expect(await failure()).toBeInstanceOf(ApiError);
  });

  it("still returns data for a success", async () => {
    answer(200, JSON.stringify({ accepting: true }));
    const result = (
      await customFetch<{ data: { accepting: boolean } }>("/x", {})
    ).data;
    expect(result.accepting).toBe(true);
  });
});

describe("a rejected token", () => {
  it("tells whoever manages sign-in, once per failed request", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    answer(401, JSON.stringify({ message: "Unauthorized" }));
    await failure();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not call it for other errors", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    answer(403, JSON.stringify({ code: "consent_required" }));
    await failure();
    expect(handler).not.toHaveBeenCalled();
  });
});
