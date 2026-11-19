// The country of a place at the time (context lanes B2). Wikidata usually knows it (a place's P17 statements with
// start and end dates: Ploiești was in the Principality of Wallachia until 1859, the United Principalities until
// 1881, then the Kingdom of Romania…). When it does not, a built-in table by Romanian county and historical region is
// used, then today's country. States of one line of succession are grouped as one "country" chip on the National
// lane (Wallachia → United Principalities → Kingdom of Romania → … → Romania), so one person does not make six chips.

const S = (qid, label, from, to) => ({ qid, label, from, to });
const ROMANIA_AFTER = (from) => [S("Q203493", "Kingdom of Romania", from, 1947), S("Q2685298", "Romanian People's Republic", 1947, 1965), S("Q842794", "Socialist Republic of Romania", 1965, 1989), S("Q218", "Romania", 1989, null)];
const AUSTRIA_UNTIL_1918 = [S("Q153136", "Habsburg monarchy", null, 1804), S("Q131964", "Austrian Empire", 1804, 1867), S("Q28513", "Austria-Hungary", 1867, 1918)];

export const REGION_STATES = {
  wallachia: [S("Q389004", "Principality of Wallachia", null, 1859), S("Q958291", "United Principalities", 1859, 1881), ...ROMANIA_AFTER(1881)],
  moldavia: [S("Q10957559", "Principality of Moldavia", null, 1859), S("Q958291", "United Principalities", 1859, 1881), ...ROMANIA_AFTER(1881)],
  transylvania: [...AUSTRIA_UNTIL_1918, ...ROMANIA_AFTER(1918)],
  bukovina: [...AUSTRIA_UNTIL_1918, ...ROMANIA_AFTER(1918)],
  dobruja: [S("Q12560", "Ottoman Empire", null, 1878), S("Q958291", "United Principalities", 1878, 1881), ...ROMANIA_AFTER(1881)],
};

// Romanian counties by historical region (Wikidata's English county labels, "X County")
const COUNTY_REGION = {
  wallachia: ["Argeș", "Brăila", "Buzău", "Călărași", "Dâmbovița", "Giurgiu", "Ialomița", "Ilfov", "Prahova", "Teleorman", "Dolj", "Gorj", "Mehedinți", "Olt", "Vâlcea", "Bucharest"],
  moldavia: ["Bacău", "Botoșani", "Galați", "Iași", "Neamț", "Vaslui", "Vrancea"],
  transylvania: ["Alba", "Brașov", "Cluj", "Covasna", "Harghita", "Hunedoara", "Mureș", "Sibiu", "Bistrița-Năsăud", "Sălaj", "Bihor", "Arad", "Maramureș", "Satu Mare", "Timiș", "Caraș-Severin"],
  bukovina: ["Suceava"],
  dobruja: ["Constanța", "Tulcea"],
};
const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s*county$/, "").trim();
export function regionOfCounty(county) {
  const c = fold(county);
  for (const [region, list] of Object.entries(COUNTY_REGION)) if (list.some((x) => fold(x) === c)) return region;
  return null;
}

// lines of succession: states in one line make one National chip
const LINES = [
  { key: "romania", label: "Romania", qids: ["Q389004", "Q10957559", "Q958291", "Q203493", "Q2685298", "Q842794", "Q218"] },
  { key: "austria-hungary", label: "Austria-Hungary", qids: ["Q153136", "Q131964", "Q28513"] },
  { key: "hungary", label: "Hungary", qids: ["Q16056854", "Q625380", "Q600018", "Q516160", "Q171150"] },
  { key: "ottoman", label: "Ottoman Empire", qids: ["Q12560"] },
  { key: "russia", label: "Russia", qids: ["Q34266", "Q15180", "Q159"] },
];
export function lineOf(state) {
  const line = LINES.find((l) => l.qids.includes(state.qid));
  return line ? { key: line.key, label: line.label } : { key: `q:${state.qid}`, label: state.label };
}

/**
 * The states of a place: Wikidata's dated P17 statements when there are some, else the built-in table for its
 * county's region, else its undated (today's) country. `history` = placeHistory(qid) from wikidata.js.
 */
export function statesOfPlace(history) {
  const states = history?.states ?? [];
  if (states.some((s) => s.from != null || s.to != null)) return states;
  const region = regionOfCounty(history?.county);
  if (region) return REGION_STATES[region];
  return states.length ? states.map((s) => ({ ...s, from: null, to: null })) : [];
}

/** The parts of [from, to] spent in each state: [{ state, from, to }]. */
export function statesDuring(states, from, to) {
  const out = [];
  for (const s of states) {
    const a = Math.max(from, s.from ?? -Infinity), b = Math.min(to, s.to ?? Infinity);
    if (a <= b) out.push({ state: s, from: a, to: b });
  }
  return out;
}
