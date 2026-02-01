import { describe, expect, it } from "bun:test"
import { buildStatusCard } from "../src/lark/cardTemplates.js"

describe("buildStatusCard", () => {
  it("builds a running card with stop button", () => {
    const card = buildStatusCard({
      taskId: "t1",
      status: "running",
      prompt: "fix the bug",
    })

    const header = card.header as Record<string, unknown>
    const title = header.title as Record<string, string>
    expect(title.content).toBe("LarkCoder - Running")
    expect(header.template).toBe("blue")

    const elements = card.elements as Record<string, unknown>[]
    const actionEl = elements.find((e) => e.tag === "action") as Record<
      string,
      unknown
    >
    const actions = actionEl!.actions as Record<string, unknown>[]
    expect(actions).toHaveLength(1)
    expect((actions[0]!.value as Record<string, string>).action).toBe("stop")
  })

  it("builds a waiting card with continue and done buttons", () => {
    const card = buildStatusCard({
      taskId: "t1",
      status: "waiting",
      prompt: "do something",
      summary: "partial result",
    })

    const header = card.header as Record<string, unknown>
    expect(header.template).toBe("orange")

    const elements = card.elements as Record<string, unknown>[]
    const actionEl = elements.find((e) => e.tag === "action") as Record<
      string,
      unknown
    >
    const actions = actionEl!.actions as Record<string, unknown>[]
    expect(actions).toHaveLength(2)
    expect((actions[0]!.value as Record<string, string>).action).toBe(
      "continue",
    )
    expect((actions[1]!.value as Record<string, string>).action).toBe(
      "complete",
    )
  })

  it("builds a completed card with no action buttons", () => {
    const card = buildStatusCard({
      taskId: "t1",
      status: "completed",
      prompt: "fix",
      summary: "all done",
    })

    const header = card.header as Record<string, unknown>
    expect(header.template).toBe("green")

    const elements = card.elements as Record<string, unknown>[]
    const actionEl = elements.find((e) => e.tag === "action")
    expect(actionEl).toBeUndefined()
  })

  it("builds a failed card with retry button and error message", () => {
    const card = buildStatusCard({
      taskId: "t1",
      status: "failed",
      prompt: "do it",
      errorMessage: "connection refused",
    })

    const header = card.header as Record<string, unknown>
    expect(header.template).toBe("red")

    const elements = card.elements as Record<string, unknown>[]
    const mdEl = elements.find((e) => e.tag === "markdown") as Record<
      string,
      string
    >
    expect(mdEl.content).toContain("connection refused")

    const actionEl = elements.find((e) => e.tag === "action") as Record<
      string,
      unknown
    >
    const actions = actionEl!.actions as Record<string, unknown>[]
    expect(actions).toHaveLength(1)
    expect((actions[0]!.value as Record<string, string>).action).toBe("retry")
  })

  it("truncates long prompts", () => {
    const longPrompt = "x".repeat(200)
    const card = buildStatusCard({
      taskId: "t1",
      status: "pending",
      prompt: longPrompt,
    })

    const elements = card.elements as Record<string, unknown>[]
    const mdEl = elements.find((e) => e.tag === "markdown") as
      | { content: string }
      | undefined
    expect(mdEl!.content.length).toBeLessThan(200)
    expect(mdEl!.content).toContain("...")
  })
})
