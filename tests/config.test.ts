import { describe, expect, it } from "bun:test"
import { appConfigSchema } from "../src/config/schema.js"

describe("appConfigSchema", () => {
  const validConfig = {
    lark: {
      app_id: "cli_test",
      app_secret: "secret123",
    },
    agent: {
      working_dir: "/home/deploy",
    },
  }

  it("parses valid config with defaults", () => {
    const result = appConfigSchema.parse(validConfig)
    expect(result.lark.appId).toBe("cli_test")
    expect(result.lark.appSecret).toBe("secret123")
    expect(result.agent.command).toBe("claude")
    expect(result.agent.args).toEqual([])
    expect(result.agent.workingDir).toBe("/home/deploy")
    expect(result.agent.portRange).toEqual([3100, 3200])
    expect(result.database.path).toBe("data/larkcoder.db")
  })

  it("parses full config", () => {
    const full = {
      ...validConfig,
      lark: {
        ...validConfig.lark,
        doc_token: "doxcn123",
        doc_type: "docx",
      },
      agent: {
        ...validConfig.agent,
        command: "/usr/local/bin/claude",
        args: ["--sse-port", "{{PORT}}"],
        port_range: [4000, 4100],
        max_turns: 30,
        system_prompt: "You are helpful.",
      },
      database: { path: "/tmp/test.db" },
    }

    const result = appConfigSchema.parse(full)
    expect(result.lark.docToken).toBe("doxcn123")
    expect(result.lark.docType).toBe("docx")
    expect(result.agent.command).toBe("/usr/local/bin/claude")
    expect(result.agent.args).toEqual(["--sse-port", "{{PORT}}"])
    expect(result.agent.portRange).toEqual([4000, 4100])
    expect(result.agent.maxTurns).toBe(30)
    expect(result.agent.systemPrompt).toBe("You are helpful.")
    expect(result.database.path).toBe("/tmp/test.db")
  })

  it("transforms snake_case to camelCase", () => {
    const result = appConfigSchema.parse(validConfig)
    expect(result.lark).toHaveProperty("appId")
    expect(result.lark).toHaveProperty("appSecret")
    expect(result.agent).toHaveProperty("workingDir")
    expect(result.agent).toHaveProperty("portRange")
  })

  it("rejects missing lark.app_id", () => {
    const bad = { ...validConfig, lark: { app_secret: "s" } }
    expect(() => appConfigSchema.parse(bad)).toThrow()
  })

  it("rejects missing agent.working_dir", () => {
    const bad = { ...validConfig, agent: {} }
    expect(() => appConfigSchema.parse(bad)).toThrow()
  })

  it("rejects invalid doc_type", () => {
    const bad = {
      ...validConfig,
      lark: { ...validConfig.lark, doc_type: "pdf" },
    }
    expect(() => appConfigSchema.parse(bad)).toThrow()
  })
})
