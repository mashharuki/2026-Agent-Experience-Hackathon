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

export async function customFetch<T>(
  url: string,
  options: RequestInit,
): Promise<T> {
  const headers = new Headers(options.headers);
  const token = tokenProvider();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetchImplementation(`${baseUrl}${url}`, {
    ...options,
    headers,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new ApiError(response.status, data?.code ?? "internal_error");
  }
  return { data, status: response.status, headers: response.headers } as T;
}
