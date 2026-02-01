import { describe, expect, it } from "vitest"
import { extractPlanFromMarkdown } from "../src/lark/docContext.js"

describe("extractPlanFromMarkdown", () => {
  it("extracts plan section when heading exists", () => {
    const markdown = `# Overview\n\n## Plan\n- Step one\n- Step two\n\n## Notes\nMore text`
    expect(extractPlanFromMarkdown(markdown)).toBe("- Step one\n- Step two")
  })

  it("falls back to full markdown when no plan heading", () => {
    const markdown = "# Intro\nJust text"
    expect(extractPlanFromMarkdown(markdown)).toBe(markdown)
  })
})
