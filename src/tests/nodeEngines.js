// Test engines: the real libraries in their Node builds (pdf.js legacy build, mammoth). No rendering in Node.
export async function nodeEngines() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const mammoth = (await import("mammoth")).default;
  return {
    openPdf: (bytes) => pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise,
    docxText: async (bytes) => (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value,
    imageSize: async (bytes) => {            // PNG only: width and height are in the IHDR chunk
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: v.getUint32(16), height: v.getUint32(20) };
    },
  };
}
