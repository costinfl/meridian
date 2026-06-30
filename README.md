# Meridian — Family Time Atlas

> *Meridian: the cartographic line you read positions from — echoing the vertical crosshair that anchors every life to shared historical terrain.*

A single-page genealogical timeline that replaces the conventional family tree with a **swimlane layout**: lives rendered as horizontal tracks against a shared, zoomable year axis. Named after the surveyor's reference line, Meridian lets you read a family not as a branching diagram but as a set of parallel biographies unfolding across the same historical backdrop.

---

## Concept

Most genealogy tools show *structure* (who descended from whom). Meridian shows *time* — the actual overlap of lives, the wars a great-grandfather lived through, the decade a grandmother held office, the years two siblings shared the same roof. The vertical crosshair is the eponymous meridian: drag it across the canvas and every lane shows the person's age at that exact moment.

---

## Layout

The viewport is divided into three stacked areas that share one horizontal time scale and zoom/pan together:

| Area | Purpose |
|---|---|
| **Context** (top) | Historical backdrop — Local, National, and Global lanes with point events and period bands. A soft tint marks which years the focus person was alive, dimming events outside their lifespan. |
| **Focus** (middle) | The primary subject. Taller lane, oxblood accent, year axis directly above. |
| **Compare** (bottom) | Any number of relatives added for side-by-side comparison. |

A fixed **216 px left header column** labels every lane; the scrollable track fills the remainder. The transform is `x(year) = (year − view.left) × ppy` where `ppy` is pixels-per-year, shared by every lane.

---

## Per-lane contents

Each person's lane renders:

- **Life bar** — birth to death, with a circular birth marker and a square death marker. Open-ended lives fade to a gradient.
- **Point events** — rotated-square (diamond) markers with year + label. Labels are hidden when zoomed out below ~4.5 ppy.
- **Period bars** — labelled spans (e.g. *Mayor 1893–1897*) that auto-pack into stacked rows using greedy row-packing so overlapping periods never collide.
- **Grouping rectangles** — dashed-border boxes spanning a year range with an uppercase tab on the top edge, used to cluster related events for analysis (inspired by time.graphics groupings).

---

## Research mode

Toggle **research mode** from the toolbar. While active:

- Dragging across any lane draws a year range rather than panning.
- A modal prompts for a note.
- Saving renders a **curly-brace accolade** (an SVG `{` rotated 90°, dipping at both ends and peaking in the middle) above the lane's range, with the note in italic serif and a small ✕ to delete it.

Two sample braces are pre-loaded — e.g. *"War years — whereabouts unverified, check parish registers"* over 1914–1919 — to illustrate the feature immediately.

---

## Interaction

| Gesture | Action |
|---|---|
| Scroll wheel | Zoom toward the cursor |
| Horizontal scroll / trackpad | Pan |
| Drag (normal mode) | Pan |
| Drag (research mode) | Draw annotation range |
| Hover | Vertical crosshair across all areas; age shown per person |

Toolbar controls: **Zoom +/−**, **Fit life** (frame the focus person's lifespan), **All** (frame everyone).

The **Focus** person is chosen from a dropdown. Each Compare lane has a **⌖ Focus** button (promotes that person to focus, demoting the current focus to Compare) and a **×** to remove it. **+ Relative** opens a picker that lists people not yet visible, with their computed relationship to the focus person (father / mother / spouse / child / sibling / grandparent / grandchild / relative).

---

## GEDCOM

### Export

Generates a valid **GEDCOM 5.5.1** file:

- `HEAD` block with `SOUR`, `GEDC`, `CHAR UTF-8`
- `INDI` records: `NAME Given /Surname/`, `SEX`, `BIRT`/`DEAT` with `DATE` year and `PLAC`
- `FAM` records reconstructed from parent/spouse links with `HUSB`/`WIFE`/`CHIL` and `FAMC`/`FAMS` pointers
- `TRLR`

Downloaded as a `.ged` file.

### Import

Parses a `.ged` file (level / xref / tag / value line regex), extracts birth/death year and place from `INDI` records, and surfaces any person with at least a birth year through the **+ Relative** picker.

A **Context source** dropdown offers *Built-in sample* (selected) plus disabled future options (*Wikidata — coming soon*, *time.graphics — coming soon*) to signal planned external-provider integration.

---

## Data model

```js
// Person
{
  id, name, sex: 'M' | 'F',
  birth: { year, place },
  death: { year, place } | null,
  fatherId, motherId,
  spouseIds: [],
  events:  [{ year, label, type }],
  periods: [{ start, end, label }],
  groups:  [{ start, end, label }]
}

// Context lane
{ id, label, sub, events: [{ year, label }], periods: [{ start, end, label }] }

// Research annotation (brace)
{ id, laneKey, start, end, note }   // laneKey e.g. "p:i1" or "ctx:local"
```

---

## Sample data

The built-in dataset follows the **Hariton family of Ploiești / Săhăteni, Romania**, spanning roughly **1792–1989**. It includes:

- Multiple generations with believable life events, offices held, and property periods
- Packed period rows and grouping rectangles on the focus person
- Context lanes whose events align with the family history — land reforms, wars, regime changes, local industrial milestones

---

## Visual design

The aesthetic is **archival map / survey ledger** — not a generic web dashboard.

| Token | Value |
|---|---|
| Background | `#E8EAE1` (pale map paper) |
| Panel | `#F3F4ED` (lighter) |
| Dark ink | `#23312B` |
| Soft ink | `#4A5850` |
| Rules | `#C7CDBD` / `#D8DCCE` |
| Context slate | `#54656C` |
| Focus accent | `#8A3033` (deep oxblood) |
| Relative colors | Plum / ochre / teal / umber / steel-blue |

Typefaces loaded from Google Fonts:

| Role | Face |
|---|---|
| Names / titles | **Fraunces** (serif display) |
| UI / labels | **Archivo** (sans) |
| Years / dates | **IBM Plex Mono** |

Survey gridlines sit behind all content; century lines are heavier. The header column is separated by a heavy ink rule; the year axis sits on a dark ink band. Border radii are zero to hairline. The crosshair and research braces are the intended memorable elements.

---

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # production output → dist/
npm run preview    # serve the production build
```

The entire application is a single component: `src/App.jsx`. Helper functions — hex-with-alpha, clamp, greedy row-packing, brace SVG path, tick-step selection, relationship inference, GEDCOM read/write — all live in the same file. A `ResizeObserver` measures the track width and fits the initial view on first layout.

---

## Browser notes

- Uses a **non-passive wheel listener** so `preventDefault()` works for zoom — browsers may log a warning; this is intentional.
- Uses **pointer events with pointer capture** for drag/pan.
- Respects `prefers-reduced-motion`.
- No external UI libraries, no Tailwind, no localStorage.