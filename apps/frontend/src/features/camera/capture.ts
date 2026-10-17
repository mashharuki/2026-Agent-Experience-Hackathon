const MAX_EDGE = 1568;
const MAX_BYTES = 1_800_000; // the API accepts up to 2 MiB; stay clear of the limit

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("capture_failed"))),
      "image/jpeg",
      quality,
    );
  });
}

/** Draw the current video frame to a canvas and encode it as JPEG (this also drops all metadata). */
export async function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const scale = Math.min(
    1,
    MAX_EDGE / Math.max(video.videoWidth, video.videoHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  let quality = 0.9;
  let blob = await toBlob(canvas, quality);
  while (blob.size > MAX_BYTES && quality > 0.4) {
    quality -= 0.1;
    blob = await toBlob(canvas, quality);
  }
  return blob;
}
