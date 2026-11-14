// Browser engines for ingestion. Every heavy library is imported lazily, on first use, so none of it is
// downloaded unless the researcher actually processes a document. All assets are served by this site
// (self-hosted): nothing is fetched from a CDN.
//  - pdf.js parses in its own worker thread (pdf.worker), so the timeline stays responsive;
//  - tesseract.js runs OCR in its own worker thread (see ocrEngine.browser.js).

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [lib, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })();
  }
  return pdfjsPromise;
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width; c.height = height;
  return c;
}

async function canvasBytes(canvas, mimeType, quality) {
  const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: mimeType, quality }) : await new Promise((res) => canvas.toBlob(res, mimeType, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Render a pdf.js page UNROTATED (boxes are stored in unrotated page coordinates, invariant I4). */
async function renderPdfPage(page, scale) {
  const viewport = page.getViewport({ scale, rotation: 0 });
  const width = Math.max(1, Math.round(viewport.width)), height = Math.max(1, Math.round(viewport.height));
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return { bytes: await canvasBytes(canvas, "image/jpeg", 0.88), mimeType: "image/jpeg", width, height };
}

export function browserEngines() {
  return {
    openPdf: async (bytes) => (await loadPdfjs()).getDocument({ data: bytes.slice() }).promise,
    renderPdfPage,
    docxText: async (bytes) => {
      const mod = await import("mammoth/mammoth.browser.js");
      const mammoth = mod.default ?? mod;
      return (await mammoth.extractRawText({ arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })).value;
    },
    imageSize: async (bytes, mimeType) => {
      try {
        const bmp = await createImageBitmap(new Blob([bytes], { type: mimeType }));
        const size = { width: bmp.width, height: bmp.height };
        bmp.close?.();
        return size;
      } catch {
        throw new Error(mimeType === "image/tiff" ? "This browser cannot display TIFF images; convert the file to PNG, JPEG or PDF" : "The image could not be read");
      }
    },
  };
}
