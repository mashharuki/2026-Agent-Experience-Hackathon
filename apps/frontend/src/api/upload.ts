import { withDeadline } from "./deadline";
import type { Upload } from "./generated/model";

/**
 * POST the photo straight to S3 with the signed form from the API. The server decided
 * the key, the size limit and the expiry; the form fields must come first, the file last.
 */
export async function uploadPhoto(
  upload: Upload,
  photo: Blob,
  doFetch: typeof fetch = (...args) => fetch(...args),
  signal?: AbortSignal,
): Promise<void> {
  const form = new FormData();
  for (const [name, value] of Object.entries(upload.fields)) {
    form.append(name, value);
  }
  form.append("file", photo);
  const response = await withDeadline(
    (boundedSignal) =>
      doFetch(upload.url, {
        method: "POST",
        body: form,
        signal: boundedSignal,
      }),
    signal,
    30_000,
  );
  if (!response.ok) {
    throw new Error("upload_failed");
  }
}
