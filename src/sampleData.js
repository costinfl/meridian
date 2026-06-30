export const SAMPLE_PEOPLE = [
  {
    id: "i1", name: "Dumitru D. Hariton", sex: "M",
    birth: { year: 1850, place: "Săhăteni" }, death: { year: 1927, place: "Ploiești" },
    fatherId: "i2", motherId: "i3", spouseIds: ["i4"],
    events: [
      { year: 1875, label: "Marries Elena Băltăceanu", type: "marriage" },
      { year: 1893, label: "Elected mayor of Ploiești", type: "office" },
      { year: 1907, label: "Estate spared in peasants' revolt", type: "note" },
      { year: 1921, label: "Land expropriated, agrarian reform", type: "property" },
    ],
    periods: [
      { start: 1880, end: 1921, label: "Landowner at Săhăteni" },
      { start: 1893, end: 1897, label: "Mayor of Ploiești" },
    ],
    groups: [{ start: 1880, end: 1921, label: "Săhăteni estate" }],
  },
  {
    id: "i2", name: "Dumitru S. Hariton", sex: "M",
    birth: { year: 1818, place: "Ploiești" }, death: { year: 1884, place: "Ploiești" },
    fatherId: "i8", motherId: null, spouseIds: ["i3"],
    events: [
      { year: 1845, label: "Marries Maria Văleanu", type: "marriage" },
      { year: 1864, label: "Buys the Săhăteni estate", type: "property" },
    ],
    periods: [{ start: 1869, end: 1873, label: "Mayor of Ploiești" }],
    groups: [],
  },
  {
    id: "i3", name: "Maria Hariton (b. Văleanu)", sex: "F",
    birth: { year: 1828, place: "Vălenii de Munte" }, death: { year: 1899, place: "Ploiești" },
    fatherId: null, motherId: null, spouseIds: ["i2"],
    events: [{ year: 1845, label: "Marries Dumitru S. Hariton", type: "marriage" }],
    periods: [], groups: [],
  },
  {
    id: "i4", name: "Elena Hariton (b. Băltăceanu)", sex: "F",
    birth: { year: 1856, place: "Buzău" }, death: { year: 1934, place: "Ploiești" },
    fatherId: null, motherId: null, spouseIds: ["i1"],
    events: [{ year: 1875, label: "Marries Dumitru D. Hariton", type: "marriage" }],
    periods: [{ start: 1902, end: 1916, label: "Charity work, Ploiești" }],
    groups: [],
  },
  {
    id: "i5", name: "Gheorghe D. Hariton", sex: "M",
    birth: { year: 1878, place: "Ploiești" }, death: { year: 1952, place: "unknown" },
    fatherId: "i1", motherId: "i4", spouseIds: [],
    events: [
      { year: 1909, label: "Donation to the Săhăteni school", type: "note" },
      { year: 1916, label: "Requisitions under occupation", type: "note" },
      { year: 1948, label: "Manor nationalized", type: "property" },
    ],
    periods: [{ start: 1900, end: 1948, label: "Manages the Săhăteni manor" }],
    groups: [{ start: 1900, end: 1948, label: "Săhăteni manor" }],
  },
  {
    id: "i6", name: "Nicolae D. Hariton", sex: "M",
    birth: { year: 1882, place: "Ploiești" }, death: { year: 1944, place: "Ploiești" },
    fatherId: "i1", motherId: "i4", spouseIds: [],
    events: [{ year: 1944, label: "Dies in the bombing of Ploiești", type: "death-note" }],
    periods: [{ start: 1916, end: 1918, label: "Serves, Romanian 2nd Army" }],
    groups: [],
  },
  {
    id: "i7", name: "Ana Ionescu (b. Hariton)", sex: "F",
    birth: { year: 1885, place: "Ploiești" }, death: { year: 1970, place: "Mizil" },
    fatherId: "i1", motherId: "i4", spouseIds: [],
    events: [{ year: 1907, label: "Marries Vasile Ionescu", type: "marriage" }],
    periods: [{ start: 1920, end: 1948, label: "Teacher in Mizil" }],
    groups: [],
  },
  {
    id: "i8", name: "Stoian Hariton", sex: "M",
    birth: { year: 1792, place: "Ploiești" }, death: { year: 1861, place: "Ploiești" },
    fatherId: null, motherId: null, spouseIds: [],
    events: [{ year: 1821, label: "Flees the uprising to Brașov", type: "note" }],
    periods: [], groups: [],
  },
];

export const SAMPLE_ANNOTATIONS = [
  { id: "a1", laneKey: "p:i1", start: 1914, end: 1919, note: "War years — family whereabouts unverified. Check Ploiești parish registers." },
  { id: "a2", laneKey: "p:i5", start: 1948, end: 1952, note: "After nationalization: fate unclear. Trace via property archives / CNSAS." },
];

export const CONTEXT_LANES = [
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
