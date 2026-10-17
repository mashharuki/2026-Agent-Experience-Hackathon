/** A synthetic picture for the mock/demo mode when no camera is available. It is plainly not a photo. */
export async function createTestImage(label: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 640, 480);
    gradient.addColorStop(0, "#b8c6db");
    gradient.addColorStop(1, "#f5f7fa");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 640, 480);
    context.fillStyle = "#6b7a8f";
    context.beginPath();
    context.arc(320, 230, 120, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#1f2937";
    context.font = "28px sans-serif";
    context.textAlign = "center";
    context.fillText(`TEST IMAGE (${label})`, 320, 440);
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("capture_failed"))),
      "image/jpeg",
      0.9,
    ),
  );
}
