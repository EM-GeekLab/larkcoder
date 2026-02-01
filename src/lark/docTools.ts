import type { ToolDefinition, ToolHandler } from "../agent/types.js"
import type { LarkClient } from "./client.js"

type ToolRegistration = { definition: ToolDefinition; handler: ToolHandler }

export function createDocTools(larkClient: LarkClient): ToolRegistration[] {
  return [createReadDocTool(larkClient), createAppendDocTool(larkClient)]
}

function createReadDocTool(larkClient: LarkClient): ToolRegistration {
  const definition: ToolDefinition = {
    name: "read_lark_doc",
    description:
      "Read the plain text content of a Feishu (Lark) document by its token.",
    inputSchema: {
      type: "object",
      properties: {
        doc_token: {
          type: "string",
          description: "The document token (document_id) to read.",
        },
      },
      required: ["doc_token"],
    },
  }

  const handler: ToolHandler = async (request) => {
    const docToken = request.arguments?.doc_token as string | undefined
    if (!docToken) {
      return { error: "doc_token is required" }
    }
    const content = await larkClient.fetchDocContent(docToken)
    if (content === null) {
      return { error: "Failed to read document or document not found" }
    }
    return { content }
  }

  return { definition, handler }
}

function createAppendDocTool(larkClient: LarkClient): ToolRegistration {
  const definition: ToolDefinition = {
    name: "append_lark_doc",
    description: "Append a text block to the end of a Feishu (Lark) document.",
    inputSchema: {
      type: "object",
      properties: {
        doc_token: {
          type: "string",
          description: "The document token (document_id) to append to.",
        },
        content: {
          type: "string",
          description: "The text content to append.",
        },
      },
      required: ["doc_token", "content"],
    },
  }

  const handler: ToolHandler = async (request) => {
    const docToken = request.arguments?.doc_token as string | undefined
    const content = request.arguments?.content as string | undefined
    if (!docToken || !content) {
      return { error: "doc_token and content are required" }
    }
    const ok = await larkClient.appendDocContent(docToken, content)
    return ok
      ? { success: true }
      : { error: "Failed to append content to document" }
  }

  return { definition, handler }
}
