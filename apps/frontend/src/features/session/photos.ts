/** A photo held in this tab's memory only. The object URL must be revoked when it is dropped. */
export interface Photo {
  blob: Blob;
  url: string;
}

export function makePhoto(blob: Blob): Photo {
  return { blob, url: URL.createObjectURL(blob) };
}

export function dropPhoto(photo: Photo | undefined): void {
  if (photo) URL.revokeObjectURL(photo.url);
}
