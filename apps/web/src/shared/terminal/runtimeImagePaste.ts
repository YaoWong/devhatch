export function supportsRuntimeImagePaste(agentId: string) {
  return agentId === "opencode";
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
