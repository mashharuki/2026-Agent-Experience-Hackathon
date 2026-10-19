import type { Photo } from "./photos";

export type PhotoTarget = "current" | "before" | "after";

/** Hand off the existing in-memory image. Browsers cannot confirm an OS save. */
export function downloadPhoto(photo: Photo, target: PhotoTarget): void {
  const link = document.createElement("a");
  link.href = photo.url;
  link.download = target === "current" ? "photo.jpg" : `photo-${target}.jpg`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
  }
}
