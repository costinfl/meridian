// Graph projection and queries (Phase 8). In memory, rebuilt from the stores and the project; the only module
// other code uses for graph questions (FAN, kinship).
export { buildGraph, personLayer, prepareRecords, recordPart, addRecordPart, removeRecord, canonical, RELATION_PROPERTIES } from "./projection.js";
export { buildTrackedGraph, updateGraph, changedRecords, personFingerprint } from "./update.js";
export { fanOf, candidateClusters, personsOfPersona } from "./fan.js";
export { ancestors, descendants, commonAncestors, kinshipLabel, MAX_GENERATIONS } from "./kinship.js";
