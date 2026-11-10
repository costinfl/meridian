import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const BASE = "/meridian/";

// OCR assets are self-hosted (reviewer decision): copied from node_modules into the build under ocr/, never
// committed, and only requested by the browser when a page is actually sent to OCR.
const OCR_ASSETS = {
  "ocr/worker.min.js": "node_modules/tesseract.js/dist/worker.min.js",
  "ocr/core/tesseract-core-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
  "ocr/core/tesseract-core-simd-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  "ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
  "ocr/lang/ron.traineddata.gz": "node_modules/@tesseract.js-data/ron/4.0.0_best_int/ron.traineddata.gz",
};

function ocrAssets() {
  const abs = (rel) => path.resolve(__dirname, rel);
  return {
    name: "meridian-ocr-assets",
    configureServer(server) {            // dev server: serve the files straight from node_modules
      server.middlewares.use((req, res, next) => {
        const key = (req.url ?? "").split("?")[0].replace(BASE, "");
        const file = OCR_ASSETS[key];
        if (!file) return next();
        res.setHeader("Content-Type", key.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        fs.createReadStream(abs(file)).pipe(res);
      });
    },
    generateBundle() {                   // production build: emit them into dist/ocr/
      for (const [fileName, file] of Object.entries(OCR_ASSETS)) this.emitFile({ type: "asset", fileName, source: fs.readFileSync(abs(file)) });
    },
  };
}

export default defineConfig({
  plugins: [react(), ocrAssets()],
  base: BASE,
  server: { open: true, port: 5173 },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/tests/setup.js"],
  },
});
