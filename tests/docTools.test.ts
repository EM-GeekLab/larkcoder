import { describe, expect, it, mock } from "bun:test"
import type { LarkClient } from "../src/lark/client.js"
import { createDocTools } from "../src/lark/docTools.js"

function mockLarkClient(overrides: Partial<LarkClient> = {}): LarkClient {
  return {
    fetchDocContent: mock(() => Promise.resolve("doc content here")),
    appendDocContent: mock(() => Promise.resolve(true)),
    ...overrides,
  } as unknown as LarkClient
}

describe("createDocTools", () => {
  it("returns two tool registrations", () => {
    const tools = createDocTools(mockLarkClient())
    expect(tools).toHaveLength(2)
    expect(tools[0]!.definition.name).toBe("read_lark_doc")
    expect(tools[1]!.definition.name).toBe("append_lark_doc")
  })

  describe("read_lark_doc", () => {
    it("reads document content", async () => {
      const client = mockLarkClient()
      const tools = createDocTools(client)
      const handler = tools[0]!.handler

      const result = await handler({
        tool: "read_lark_doc",
        arguments: { doc_token: "abc123" },
      })

      expect(client.fetchDocContent).toHaveBeenCalledWith("abc123")
      expect(result).toEqual({ content: "doc content here" })
    })

    it("returns error when doc_token is missing", async () => {
      const tools = createDocTools(mockLarkClient())
      const handler = tools[0]!.handler

      const result = await handler({ tool: "read_lark_doc" })
      expect(result).toEqual({ error: "doc_token is required" })
    })

    it("returns error when fetch fails", async () => {
      const client = mockLarkClient({
        fetchDocContent: mock(() => Promise.resolve(null)),
      } as unknown as Partial<LarkClient>)
      const tools = createDocTools(client)
      const handler = tools[0]!.handler

      const result = await handler({
        tool: "read_lark_doc",
        arguments: { doc_token: "bad" },
      })
      expect(result).toEqual({
        error: "Failed to read document or document not found",
      })
    })
  })

  describe("append_lark_doc", () => {
    it("appends content to document", async () => {
      const client = mockLarkClient()
      const tools = createDocTools(client)
      const handler = tools[1]!.handler

      const result = await handler({
        tool: "append_lark_doc",
        arguments: { doc_token: "abc123", content: "new text" },
      })

      expect(client.appendDocContent).toHaveBeenCalledWith("abc123", "new text")
      expect(result).toEqual({ success: true })
    })

    it("returns error when required args are missing", async () => {
      const tools = createDocTools(mockLarkClient())
      const handler = tools[1]!.handler

      const result = await handler({
        tool: "append_lark_doc",
        arguments: { doc_token: "abc" },
      })
      expect(result).toEqual({ error: "doc_token and content are required" })
    })

    it("returns error when append fails", async () => {
      const client = mockLarkClient({
        appendDocContent: mock(() => Promise.resolve(false)),
      } as unknown as Partial<LarkClient>)
      const tools = createDocTools(client)
      const handler = tools[1]!.handler

      const result = await handler({
        tool: "append_lark_doc",
        arguments: { doc_token: "abc", content: "text" },
      })
      expect(result).toEqual({
        error: "Failed to append content to document",
      })
    })
  })
})
