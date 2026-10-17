// Hand-written HTTP layer injected into the generated client (never generated).
// - Adds the Cognito access token.
// - Never retries: analysis POSTs must not be re-sent automatically (cost control).
// - The fetch implementation can be swapped (the mock API uses this seam).

export type AccessTokenProvider = () => string | undefined;
export type FetchImplementation = typeof fetch;

let tokenProvider: AccessTokenProvider = () => undefined;
let fetchImplementation: FetchImplementation = (...args) => fetch(...args);

export function setAccessTokenProvider(provider: AccessTokenProvider): void {
  tokenProvider = provider;
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | undefined;

/** Sign-in management is told when the API rejects the token (it may have expired). */
export function setUnauthorizedHandler(
  handler: UnauthorizedHandler | undefined,
): void {
  unauthorizedHandler = handler;
}

export function currentAccessToken(): string | undefined {
  return tokenProvider();
}

export function setFetchImplementation(
  implementation: FetchImplementation,
): void {
  fetchImplementation = implementation;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

/** Error pages (502, 504) are not JSON: that must not turn into a SyntaxError. */
function parseJson(text: string): { code?: string } | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function customFetch<T>(
  url: string,
  options: RequestInit,
): Promise<T> {
  const headers = new Headers(options.headers);
  const token = currentAccessToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetchImplementation(`${baseUrl}${url}`, {
    ...options,
    headers,
  });
  const text = await response.text();
  const data = parseJson(text);
  if (!response.ok) {
    if (response.status === 401) {
      // API Gateway's JWT authorizer answers {"message":"Unauthorized"} with no `code`, so the
      // status is what says the sign-in is no longer good.
      unauthorizedHandler?.();
      throw new ApiError(401, "unauthenticated");
    }
    throw new ApiError(response.status, data?.code ?? "internal_error");
  }
  return { data, status: response.status, headers: response.headers } as T;
}
