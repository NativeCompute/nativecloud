import { describe, expect, it } from "vitest";
import { crc32, uniquePaths, zip } from "../../src/lib/zip";

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("writes a readable archive", () => {
    const data = zip([
      { path: "My cloud/Pilot.md", text: "FADE IN:" },
      { path: "Room/Harbour.md", text: "INT. HARBOUR - NIGHT" },
    ]);
    const view = new DataView(data.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = data.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const dir = view.getUint32(end + 16, true);
    expect(view.getUint32(dir, true)).toBe(0x02014b50);
    const text = new TextDecoder().decode(data);
    expect(text).toContain("My cloud/Pilot.md");
    expect(text).toContain("INT. HARBOUR - NIGHT");
  });
  it("never writes two files to one path", () => {
    expect(uniquePaths([{ folder: "A", name: "Pilot", ext: "md" }, { folder: "A", name: "pilot", ext: "md" }, { folder: "B", name: "Pilot", ext: "md" }])).toEqual([
      "A/Pilot.md",
      "A/pilot 2.md",
      "B/Pilot.md",
    ]);
  });
});
