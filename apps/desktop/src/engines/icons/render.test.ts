import { describe, expect, it } from "vitest";
import { renderIconSvg } from "./render";
import { iconGlyphs, type IconSpec } from "@forgekit/contracts";

const baseSpec: IconSpec = {
  schemaVersion: 1,
  name: "Ikon Uji",
  glyph: "sword",
  shape: "circle",
  style: "duotone",
  background: "#171417",
  primaryColor: "#FF405F",
  secondaryColor: "#FFD166",
  strokeWidth: 2,
  padding: 6,
  size: 64,
};

describe("renderIconSvg", () => {
  it("renders valid SVG for all supported glyphs", () => {
    for (const glyph of iconGlyphs) {
      const { svg, issues } = renderIconSvg({ ...baseSpec, glyph });
      expect(issues).toEqual([]);
      expect(svg).toContain("<svg");
      expect(svg).toContain("viewBox=\"0 0 64 64\"");
      expect(svg).toContain("</svg>");
    }
  });

  it("handles transparent background correctly", () => {
    const { svg } = renderIconSvg({ ...baseSpec, background: "transparent" });
    expect(svg).not.toContain("<rect width=\"64\" height=\"64\"");
  });

  it("escapes XML special characters in aria-label", () => {
    const { svg } = renderIconSvg({ ...baseSpec, name: "Ikon <Keren> & \"Hebat\"" });
    expect(svg).toContain("aria-label=\"Ikon &lt;Keren&gt; &amp; &quot;Hebat&quot;\"");
  });

  it("returns empty svg on blocking validation errors", () => {
    const { svg, issues } = renderIconSvg({ ...baseSpec, name: "" });
    expect(svg).toBe("");
    expect(issues.length).toBeGreaterThan(0);
  });
});
