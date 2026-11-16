// Browser only: prepare a page image for an LLM. Crop to a region (0-1 box on the unrotated image, I4) and scale
// so the long side is at most `maxSide` px (larger images are scaled down by the providers anyway, and cost more
// to upload), as JPEG. Returns { bytes, mimeType, width, height }.
export async function prepareImageForLlm(img, { box = null, maxSide = 1568, quality = 0.88 } = {}) {
  const bitmap = await createImageBitmap(new Blob([img.bytes], { type: img.mimeType }));
  try {
    const sx = box ? Math.floor(box.x0 * bitmap.width) : 0, sy = box ? Math.floor(box.y0 * bitmap.height) : 0;
    const sw = box ? Math.max(1, Math.ceil((box.x1 - box.x0) * bitmap.width)) : bitmap.width;
    const sh = box ? Math.max(1, Math.ceil((box.y1 - box.y0) * bitmap.height)) : bitmap.height;
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
    g.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: "image/jpeg", width: w, height: h };
  } finally {
    bitmap.close?.();
  }
}
