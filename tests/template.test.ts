import { describe, expect, it } from "vitest"
import { renderTemplate } from "../src/config/template.js"
import {
  extractFlagValue,
  splitCommand,
} from "../src/container/commandTemplate.js"

describe("renderTemplate", () => {
  it("replaces double brace variables", () => {
    const result = renderTemplate("agent-{{TASK_ID}}", { TASK_ID: "42" })
    expect(result).toBe("agent-42")
  })

  it("replaces single brace variables", () => {
    const result = renderTemplate("http://{HOST}/sse", { HOST: "agent" })
    expect(result).toBe("http://agent/sse")
  })

  it("throws when variable is missing", () => {
    expect(() => renderTemplate("{MISSING}", {})).toThrow(
      "Missing template variable",
    )
  })
})

describe("splitCommand", () => {
  it("splits quoted values", () => {
    const tokens = splitCommand(
      'docker run --name "agent one" --network=bridge',
    )
    expect(tokens).toEqual([
      "docker",
      "run",
      "--name",
      "agent one",
      "--network=bridge",
    ])
  })
})

describe("extractFlagValue", () => {
  it("finds flag value in separate token", () => {
    const tokens = ["--name", "agent-1", "--network", "bridge"]
    expect(extractFlagValue(tokens, "--name")).toBe("agent-1")
  })

  it("finds flag value in assignment form", () => {
    const tokens = ["--network=bridge"]
    expect(extractFlagValue(tokens, "--network")).toBe("bridge")
  })
})
