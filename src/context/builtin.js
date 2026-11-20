// The built-in context (the Hariton sample's lanes), tagged by place, country line and world, so it shows only when
// those places are on the board: an offline fallback next to Wikidata and your own events.
import { placeKey } from "./residence.js";

/** The Hariton sample's context (also exported as CONTEXT_LANES from sampleData.js). */
export const SAMPLE_CONTEXT = [
  {
    id: "local", label: "Local", sub: "Ploiești · Săhăteni",
    events: [
      { year: 1857, label: "World's first refinery, Ploiești" },
      { year: 1872, label: "Railway reaches Ploiești" },
      { year: 1907, label: "Revolt reaches Prahova villages" },
      { year: 1940, label: "Vrancea earthquake damages town" },
      { year: 1968, label: "Săhăteni moved to Buzău county" },
    ],
    periods: [
      { start: 1882, end: 1892, label: "Phylloxera hits Dealu Mare vines" },
      { start: 1916, end: 1918, label: "German occupation of Ploiești" },
      { start: 1943, end: 1944, label: "Bombing of Prahova oil fields" },
      { start: 1950, end: 1968, label: "Săhăteni under Mizil raion" },
    ],
  },
  {
    id: "national", label: "National", sub: "Romania",
    events: [
      { year: 1859, label: "Union of the Principalities" },
      { year: 1864, label: "Rural law: first land reform" },
      { year: 1878, label: "Independence recognized" },
      { year: 1907, label: "Peasants' revolt" },
      { year: 1918, label: "Great Union" },
      { year: 1921, label: "Agrarian reform" },
      { year: 1938, label: "Royal dictatorship; counties reorganized" },
      { year: 1947, label: "Monarchy abolished" },
      { year: 1948, label: "Nationalization decree" },
      { year: 1989, label: "Revolution" },
    ],
    periods: [
      { start: 1916, end: 1918, label: "WWI campaign & occupation" },
      { start: 1941, end: 1944, label: "Antonescu regime" },
      { start: 1949, end: 1962, label: "Collectivization of agriculture" },
    ],
  },
  {
    id: "global", label: "Global", sub: "World",
    events: [
      { year: 1848, label: "Revolutions across Europe" },
      { year: 1869, label: "Suez Canal opens" },
      { year: 1929, label: "Great Depression begins" },
      { year: 1969, label: "Moon landing" },
    ],
    periods: [
      { start: 1853, end: 1856, label: "Crimean War" },
      { start: 1914, end: 1918, label: "First World War" },
      { start: 1939, end: 1945, label: "Second World War" },
      { start: 1947, end: 1989, label: "Cold War" },
    ],
  },
];

const sample = Object.fromEntries(SAMPLE_CONTEXT.map((l) => [l.id, l]));
// which built-in local items belong to which place
const LOCAL_PLACE = {
  "World's first refinery, Ploiești": "Ploiești", "Railway reaches Ploiești": "Ploiești", "Revolt reaches Prahova villages": "Ploiești",
  "Vrancea earthquake damages town": "Ploiești", "German occupation of Ploiești": "Ploiești", "Bombing of Prahova oil fields": "Ploiești",
  "Săhăteni moved to Buzău county": "Săhăteni", "Phylloxera hits Dealu Mare vines": "Săhăteni", "Săhăteni under Mizil raion": "Săhăteni",
};
const tag = (list, kind, extra) => (list ?? []).map((x, i) => ({ id: `builtin:${kind}:${i}:${x.label}`, label: x.label, year: x.year ?? x.start, end: x.end ?? null, source: "builtin", ...extra(x) }));

export const BUILTIN = {
  /** local items: { chip: placeKey, ... } */
  local: [...tag(sample.local?.events, "le", (x) => ({ chip: placeKey(LOCAL_PLACE[x.label] ?? "Ploiești") })), ...tag(sample.local?.periods, "lp", (x) => ({ chip: placeKey(LOCAL_PLACE[x.label] ?? "Ploiești") }))],
  /** national items of the Romanian line of succession */
  national: [...tag(sample.national?.events, "ne", () => ({ chip: "romania" })), ...tag(sample.national?.periods, "np", () => ({ chip: "romania" }))],
  global: [...tag(sample.global?.events, "ge", () => ({ chip: "world" })), ...tag(sample.global?.periods, "gp", () => ({ chip: "world" }))],
};
