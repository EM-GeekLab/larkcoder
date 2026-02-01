import { describe, expect, it } from "bun:test"
import type { Session } from "../src/session/types.js"
import {
  buildErrorPost,
  buildModelSelectCard,
  buildPermissionCard,
  buildResultPost,
  buildSelectedCard,
  buildSessionDeleteCard,
  buildSessionListCard,
  buildWorkingPost,
} from "../src/lark/cardTemplates.js"

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: "s1",
    chatId: "chat_1",
    threadId: "thread_1",
    creatorId: "user_1",
    status: "idle",
    initialPrompt: "do something",
    workingDir: "/tmp",
    isPlanMode: false,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("buildPermissionCard", () => {
  it("builds a permission card with options", () => {
    const card = buildPermissionCard({
      sessionId: "s1",
      toolDescription: "Allow file access?",
      options: [
        { optionId: "allow", label: "Allow" },
        { optionId: "deny", label: "Deny" },
      ],
    })

    expect(card.config).toEqual({ wide_screen_mode: true })
    const elements = card.elements as Record<string, unknown>[]
    // markdown description + option list + action buttons
    expect(elements.length).toBeGreaterThanOrEqual(2)

    const actionEl = elements[elements.length - 1] as Record<string, unknown>
    expect(actionEl.tag).toBe("action")
    const actions = actionEl.actions as Record<string, unknown>[]
    expect(actions).toHaveLength(2)

    const val = actions[0]!.value as Record<string, string>
    expect(val.action).toBe("permission_select")
    expect(val.session_id).toBe("s1")
    expect(val.option_id).toBe("allow")
  })

  it("skips option list for single option", () => {
    const card = buildPermissionCard({
      sessionId: "s1",
      toolDescription: "Allow?",
      options: [{ optionId: "allow", label: "Allow" }],
    })

    const elements = card.elements as Record<string, unknown>[]
    // markdown description + action buttons (no option list)
    expect(elements).toHaveLength(2)
  })
})

describe("buildSessionListCard", () => {
  it("builds a session list card", () => {
    const sessions = [
      makeSession({ id: "s1", initialPrompt: "fix bug" }),
      makeSession({ id: "s2", initialPrompt: "add feature" }),
    ]

    const card = buildSessionListCard({ sessions })

    expect(card.config).toEqual({ wide_screen_mode: true })
    const elements = card.elements as Record<string, unknown>[]
    expect(elements).toHaveLength(2)

    const actionEl = elements[1] as Record<string, unknown>
    expect(actionEl.tag).toBe("action")
    const actions = actionEl.actions as Record<string, unknown>[]
    expect(actions).toHaveLength(2)

    const val = actions[0]!.value as Record<string, string>
    expect(val.action).toBe("session_select")
    expect(val.session_id).toBe("s1")
  })
})

describe("buildSessionDeleteCard", () => {
  it("builds a session delete card with danger buttons", () => {
    const sessions = [
      makeSession({ id: "s1", initialPrompt: "fix bug" }),
      makeSession({ id: "s2", initialPrompt: "add feature" }),
    ]

    const card = buildSessionDeleteCard({ sessions })

    expect(card.config).toEqual({ wide_screen_mode: true })
    const elements = card.elements as Record<string, unknown>[]
    expect(elements).toHaveLength(2)

    const actionEl = elements[1] as Record<string, unknown>
    expect(actionEl.tag).toBe("action")
    const actions = actionEl.actions as Record<string, unknown>[]
    expect(actions).toHaveLength(2)

    const btn = actions[0] as Record<string, unknown>
    expect(btn.type).toBe("danger")

    const val = btn.value as Record<string, string>
    expect(val.action).toBe("session_delete")
    expect(val.session_id).toBe("s1")
  })
})

describe("buildModelSelectCard", () => {
  it("builds a model select card", () => {
    const card = buildModelSelectCard({
      sessionId: "s1",
      models: [
        { modelId: "sonnet", label: "Sonnet" },
        { modelId: "opus", label: "Opus" },
      ],
    })

    const elements = card.elements as Record<string, unknown>[]
    expect(elements).toHaveLength(1)

    const actionEl = elements[0] as Record<string, unknown>
    const actions = actionEl.actions as Record<string, unknown>[]
    expect(actions).toHaveLength(2)

    const val = actions[0]!.value as Record<string, string>
    expect(val.action).toBe("model_select")
    expect(val.session_id).toBe("s1")
    expect(val.model_id).toBe("sonnet")
  })
})

describe("buildSelectedCard", () => {
  it("builds a selected card with text", () => {
    const card = buildSelectedCard("Selected: allow")

    const elements = card.elements as Record<string, unknown>[]
    expect(elements).toHaveLength(1)
    expect(elements[0]!.tag).toBe("markdown")
    expect(elements[0]!.content).toBe("Selected: allow")
  })
})

describe("buildWorkingPost", () => {
  it("builds a simple post with text", () => {
    const post = buildWorkingPost("Processing...")

    const zhCn = post.zh_cn as { title: string; content: unknown[][] }
    expect(zhCn.title).toBe("")
    expect(zhCn.content).toHaveLength(1)

    const line = zhCn.content[0] as Record<string, unknown>[]
    expect(line[0]!.text).toBe("Processing...")
  })
})

describe("buildResultPost", () => {
  it("builds a result post with text", () => {
    const post = buildResultPost("task completed")

    const zhCn = post.zh_cn as { title: string; content: unknown[][] }
    expect(zhCn.title).toBe("")
    expect(zhCn.content).toHaveLength(1)

    const line = zhCn.content[0] as Record<string, unknown>[]
    expect(line[0]!.text).toBe("task completed")
  })

  it("shows (no output) for empty text", () => {
    const post = buildResultPost("")

    const zhCn = post.zh_cn as { title: string; content: unknown[][] }
    expect(zhCn.content).toHaveLength(1)
    const line = zhCn.content[0] as Record<string, unknown>[]
    expect(line[0]!.text).toBe("(no output)")
  })

  it("truncates long text", () => {
    const longText = "x".repeat(5000)
    const post = buildResultPost(longText)

    const zhCn = post.zh_cn as { title: string; content: unknown[][] }
    const line = zhCn.content[0] as Record<string, unknown>[]
    const text = line[0]!.text as string
    expect(text.length).toBeLessThan(5000)
    expect(text).toContain("...")
  })
})

describe("buildErrorPost", () => {
  it("builds an error post", () => {
    const post = buildErrorPost("connection refused")

    const zhCn = post.zh_cn as { title: string; content: unknown[][] }
    expect(zhCn.content).toHaveLength(1)

    const line = zhCn.content[0] as Record<string, unknown>[]
    expect(line[0]!.text).toBe("Error: ")
    expect(line[0]!.style).toEqual(["bold"])
    expect(line[1]!.text).toBe("connection refused")
  })
})
