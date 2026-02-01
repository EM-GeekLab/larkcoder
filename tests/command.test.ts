import { describe, expect, it } from "bun:test"
import { parseCommand } from "../src/command/parser.js"

describe("parseCommand", () => {
  it("returns null for non-command text", () => {
    expect(parseCommand("hello world")).toBeNull()
    expect(parseCommand("  hello world")).toBeNull()
    expect(parseCommand("")).toBeNull()
  })

  it("parses command without args", () => {
    const result = parseCommand("/help")
    expect(result).not.toBeNull()
    expect(result!.command).toBe("help")
    expect(result!.args).toBe("")
  })

  it("parses command with args", () => {
    const result = parseCommand("/new fix the bug in login")
    expect(result).not.toBeNull()
    expect(result!.command).toBe("new")
    expect(result!.args).toBe("fix the bug in login")
  })

  it("normalizes command to lowercase", () => {
    const result = parseCommand("/STOP")
    expect(result).not.toBeNull()
    expect(result!.command).toBe("stop")
  })

  it("trims whitespace around message", () => {
    const result = parseCommand("  /status  ")
    expect(result).not.toBeNull()
    expect(result!.command).toBe("status")
    expect(result!.args).toBe("")
  })

  it("trims whitespace in args", () => {
    const result = parseCommand("/mode   plan  ")
    expect(result).not.toBeNull()
    expect(result!.command).toBe("mode")
    expect(result!.args).toBe("plan")
  })

  it("parses retry without args", () => {
    const result = parseCommand("/retry")
    expect(result).not.toBeNull()
    expect(result!.command).toBe("retry")
    expect(result!.args).toBe("")
  })

  it("parses retry with args", () => {
    const result = parseCommand("/retry use a different approach")
    expect(result).not.toBeNull()
    expect(result!.command).toBe("retry")
    expect(result!.args).toBe("use a different approach")
  })
})
