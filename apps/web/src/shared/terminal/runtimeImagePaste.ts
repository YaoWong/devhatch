export const IMAGE_PASTE_TIMEOUT_MS = 25_000;
export type ImagePastePhase = "preparing" | "pasting" | null;

export function imagePasteTimeoutError() {
  return new Error("Image paste timed out. Please try again.");
}

export async function runImagePaste(
  image: Blob,
  paste: (image: Blob, signal?: AbortSignal) => Promise<void>,
  setPhase: (phase: ImagePastePhase) => void,
  controller: AbortController,
  timeoutMs = IMAGE_PASTE_TIMEOUT_MS,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const operation = (async () => {
    setPhase("preparing");
    const png = await pngImage(image);
    if (controller.signal.aborted) throw imagePasteTimeoutError();
    setPhase("pasting");
    await paste(png, controller.signal);
  })();
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(imagePasteTimeoutError());
    }, timeoutMs);
  });
  try {
    await Promise.race([operation, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    setPhase(null);
  }
}

export function supportsRuntimeImagePaste(agentId: string) {
  return agentId === "opencode" || agentId === "pi";
}

export function clipboardImage(event: ClipboardEvent) {
  for (const item of Array.from(event.clipboardData?.items ?? [])) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const image = item.getAsFile();
    if (image) return image;
  }
  return null;
}

export async function pngImage(image: Blob) {
  if (image.type === "image/png") return image;
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to prepare pasted image");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Unable to prepare pasted image")),
      "image/png",
    ));
  } finally {
    bitmap.close();
  }
}
