// Ingestion: linked folder, scanner, document reading, router, text extraction and OCR (Phase 5).
// May import src/evidence and src/storage only; never confirms or decides anything (I6).
export { isFolderAccessSupported, linkFolder, getLinkedFolder, unlinkFolder, folderPermission, walkFolder } from "./folder.js";
export { scanEntries, importFiles, assignSource } from "./scanner.js";
export { processCopy, ingestCopy, listRunsWithItems, rerunTargetOf, textStatusOf, needsReview, REVIEW_CONFIDENCE } from "./pipeline.js";
export { classifyFile } from "./fileTypes.js";
