import { describe, expect, it } from "bun:test"
import { LarkEventHandler } from "../src/lark/eventHandler.js"
import { createLogger } from "../src/utils/logger.js"

const logger = createLogger({ prefix: "test" })

describe("LarkEventHandler", () => {
  describe("parseIMMessage", () => {
    function parse(data: Record<string, unknown>) {
      const handler = new LarkEventHandler(logger)
      // Access private method for unit testing
      // biome-ignore lint: access private method for unit testing
      return (handler as any).parseIMMessage(data)
    }

    it("parses a p2p text message", () => {
      const result = parse({
        sender: { sender_id: { open_id: "user_1" } },
        message: {
          message_id: "msg_1",
          chat_id: "chat_1",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "hello" }),
        },
      })

      expect(result).not.toBeNull()
      expect(result.text).toBe("hello")
      expect(result.chatType).toBe("p2p")
      expect(result.senderId).toBe("user_1")
      expect(result.messageId).toBe("msg_1")
      expect(result.chatId).toBe("chat_1")
    })

    it("extracts root_id for thread replies", () => {
      const result = parse({
        sender: { sender_id: { open_id: "user_1" } },
        message: {
          message_id: "msg_2",
          chat_id: "chat_1",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "reply" }),
          root_id: "msg_1",
        },
      })

      expect(result).not.toBeNull()
      expect(result.rootId).toBe("msg_1")
    })

    it("strips @mention placeholders in group chat", () => {
      const result = parse({
        sender: { sender_id: { open_id: "user_1" } },
        message: {
          message_id: "msg_1",
          chat_id: "chat_1",
          chat_type: "group",
          message_type: "text",
          content: JSON.stringify({ text: "@_user_1 fix the bug" }),
          mentions: [{ key: "@_user_1" }],
        },
      })

      expect(result).not.toBeNull()
      expect(result.text).toBe("fix the bug")
    })

    it("ignores group messages without @mention", () => {
      const result = parse({
        sender: { sender_id: { open_id: "user_1" } },
        message: {
          message_id: "msg_1",
          chat_id: "chat_1",
          chat_type: "group",
          message_type: "text",
          content: JSON.stringify({ text: "random talk" }),
        },
      })

      expect(result).toBeNull()
    })

    it("ignores non-text messages", () => {
      const result = parse({
        sender: { sender_id: { open_id: "user_1" } },
        message: {
          message_id: "msg_1",
          chat_id: "chat_1",
          chat_type: "p2p",
          message_type: "image",
          content: "{}",
        },
      })

      expect(result).toBeNull()
    })

    it("returns null for empty text after @mention strip", () => {
      const result = parse({
        sender: { sender_id: { open_id: "user_1" } },
        message: {
          message_id: "msg_1",
          chat_id: "chat_1",
          chat_type: "group",
          message_type: "text",
          content: JSON.stringify({ text: "@_user_1" }),
          mentions: [{ key: "@_user_1" }],
        },
      })

      expect(result).toBeNull()
    })

    it("returns null when message is missing", () => {
      const result = parse({ sender: { sender_id: { open_id: "u" } } })
      expect(result).toBeNull()
    })
  })

  describe("parseCardAction", () => {
    function parse(data: Record<string, unknown>) {
      const handler = new LarkEventHandler(logger)
      // biome-ignore lint: access private method for unit testing
      return (handler as any).parseCardAction(data)
    }

    it("parses a permission_select card action", () => {
      const result = parse({
        operator: { open_id: "user_1" },
        context: { open_message_id: "msg_1", open_chat_id: "chat_1" },
        action: {
          value: {
            action: "permission_select",
            session_id: "s1",
            option_id: "allow",
          },
        },
      })

      expect(result).not.toBeNull()
      expect(result.action).toBe("permission_select")
      expect(result.sessionId).toBe("s1")
      expect(result.optionId).toBe("allow")
      expect(result.openId).toBe("user_1")
    })

    it("parses a session_select card action", () => {
      const result = parse({
        operator: { open_id: "user_1" },
        context: { open_message_id: "msg_1", open_chat_id: "chat_1" },
        action: {
          value: { action: "session_select", session_id: "s1" },
        },
      })

      expect(result).not.toBeNull()
      expect(result.action).toBe("session_select")
      expect(result.sessionId).toBe("s1")
    })

    it("parses a model_select card action", () => {
      const result = parse({
        operator: { open_id: "user_1" },
        context: { open_message_id: "msg_1", open_chat_id: "chat_1" },
        action: {
          value: {
            action: "model_select",
            session_id: "s1",
            model_id: "sonnet",
          },
        },
      })

      expect(result).not.toBeNull()
      expect(result.action).toBe("model_select")
      expect(result.sessionId).toBe("s1")
      expect(result.modelId).toBe("sonnet")
    })

    it("returns null when action value is missing", () => {
      const result = parse({
        operator: { open_id: "user_1" },
        action: {},
      })

      expect(result).toBeNull()
    })
  })
})
