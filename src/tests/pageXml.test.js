import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parsePageXml, parsePoints, customIndex, modelOf, PageXmlError } from "../ingest/transkribus/pageXml.js";

const fx = (n) => fs.readFileSync(path.join(__dirname, "fixtures", "transkribus", n), "utf8");

describe("PAGE XML reader (P7b.T1)", () => {
  it("reads the 1866 page: size, metadata, lines in reading order with 0-1 boxes, and the page text", () => {
    const p = parsePageXml(fx("p32-2013.xml"));
    expect(p).toMatchObject({ imageFilename: "pag32-upright.png", width: 1475, height: 2320 });
    expect(p.metadata).toMatchObject({ created: "2026-11-10T13:59:02.123+01:00", transkribus: { docId: "1234567", pageNr: "32" } });
    expect(modelOf(p.metadata)).toMatch(/^prov=READ-COOP:name=PyLaia/);
    expect(p.lines.map((l) => l.lineId)).toEqual(["l_h", "l_1", "l_2", "l_3"]);       // region order, then line order
    expect(p.lines[1]).toMatchObject({ regionId: "r_body", text: "Anulu una mie optu sute șaizeci și șase la douădieci și optu ale lunii" });
    expect(p.lines[1].box).toEqual({ x0: 0.088136, y0: 0.150862, x1: 0.942373, y1: 0.172414 });
    expect(p.text).toBe("Actu de încetare din viață.\n\nAnulu una mie optu sute șaizeci și șase la douădieci și optu ale lunii\nMartie la dece ore diminiața din naintea nostră primarulu\nla unsprezece ore noaptea D-ei Șfatu Loti Catolică în");
  });

  it("any namespace prefix (PAGE 2019), words joined when a line has no own text, TextEquiv index 0 preferred, boxes clamped", () => {
    const p = parsePageXml(fx("prefixed-2019.xml"));
    expect(p.lines.map((l) => l.text)).toEqual(["Ştefan Hariton", "născut la Săhăteni"]);
    expect(p.lines[1].box).toEqual({ x0: 0, y0: 0.066667, x1: 1, y1: 0.093333 });
    expect(modelOf(p.metadata)).toBe("Romanian Civil Registers 19th c.");
  });

  it("an empty page is valid; broken or non-PAGE files give a clear error", () => {
    expect(parsePageXml(fx("empty.xml"))).toMatchObject({ imageFilename: "0003_blank.jpg", lines: [], text: "" });
    expect(() => parsePageXml(fx("broken.xml"))).toThrow(PageXmlError);
    expect(() => parsePageXml("<html><body/></html>")).toThrow(/not a PAGE XML/);
    expect(() => parsePageXml('<PcGts><Page imageFilename="a.jpg"/></PcGts>')).toThrow(/image size/);
  });

  it("helpers", () => {
    expect(parsePoints("1,2 3,4 x,5 6")).toEqual([[1, 2], [3, 4]]);
    expect(customIndex("readingOrder {index:12;} structure {type:entry;}")).toBe(12);
    expect(customIndex("")).toBeNull();
  });
});
