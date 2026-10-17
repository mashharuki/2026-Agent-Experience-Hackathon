// Hand-written HTTP layer injected into the generated client (never generated).
// Authentication and Idempotency-Key handling are completed in task T054.

export type AccessTokenProvider = () => string | undefined;

let tokenProvider: AccessTokenProvider = () => undefined;

export function setAccessTokenProvider(provider: AccessTokenProvider): void {
  tokenProvider = provider;
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

// Never retries: analysis POSTs must not be re-sent automatically (cost control).
export async function customFetch<T>(
  url: string,
  options: RequestInit,
): Promise<T> {
  const headers = new Headers(options.headers);
  const token = tokenProvider();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${baseUrl}${url}`, { ...options, headers });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new ApiError(response.status, data?.code ?? "internal_error");
  }
  return { data, status: response.status, headers: response.headers } as T;
}
