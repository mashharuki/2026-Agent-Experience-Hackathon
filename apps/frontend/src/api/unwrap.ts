// The generated client types every response as "success | error". customFetch throws an
// ApiError for any non-2xx answer, so only success responses are ever returned: narrow the
// type once, here, instead of casting at every call site.
type Success<T> = Extract<T, { status: 200 | 201 | 202 | 204 }>;
type DataOf<T> = Success<T> extends { data: infer D } ? D : never;

export async function unwrap<T extends { status: number; data: unknown }>(
  response: Promise<T>,
): Promise<DataOf<T>> {
  return (await response).data as DataOf<T>;
}
