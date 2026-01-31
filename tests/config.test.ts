import { describe, expect, it } from "vitest";
import { appConfigSchema, type RawConfig } from "../src/config/types.js";

describe("appConfigSchema", () => {
  it("maps raw config into app config", () => {
    const raw: RawConfig = {
      agent_runtime: {
        container_template: {
          cmd: "docker run --name agent-{{TASK_ID}}",
        },
        connection: {
          type: "sse",
          url_template: "http://agent-{{TASK_ID}}:3000/sse",
        },
      },
      server: {
        port: 9000,
        public_base_url: "http://localhost:9000",
      },
      network: {
        name: "bridge_autocoder",
      },
      github: {
        webhook_secret: "secret",
        token: "token",
        api_base_url: "https://api.github.com",
        repository: "org/repo",
        default_base_branch: "main",
      },
      lark: {
        app_id: "app",
        app_secret: "secret",
        token_url: "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
        comment_url_template: "/open-apis/drive/v1/files/{DOC_TOKEN}/comments",
        comment_file_type: "docx",
        message_card_url_template: "/open-apis/im/v1/messages",
        message_card_receive_id: "oc_123",
        message_card_receive_id_type: "open_id",
        doc_create_url_template: "/open-apis/docx/v1/documents",
        doc_token_type: "auto",
        wiki_node_url_template: "/open-apis/wiki/v2/spaces/get_node",
      },
    };

    const config = appConfigSchema.parse(raw);
    expect(config.agentRuntime.containerTemplate.cmd).toContain("docker run");
    expect(config.agentRuntime.connection.urlTemplate).toContain("agent-");
    expect(config.server.port).toBe(9000);
    expect(config.server.publicBaseUrl).toBe("http://localhost:9000");
    expect(config.network?.name).toBe("bridge_autocoder");
    expect(config.github?.webhookSecret).toBe("secret");
    expect(config.github?.token).toBe("token");
    expect(config.github?.repository).toBe("org/repo");
    expect(config.github?.defaultBaseBranch).toBe("main");
    expect(config.github?.apiBaseUrl).toBe("https://api.github.com");
    expect(config.lark?.messageCardReceiveId).toBe("oc_123");
    expect(config.lark?.messageCardReceiveIdType).toBe("open_id");
    expect(config.lark?.commentFileType).toBe("docx");
    expect(config.lark?.docCreateUrlTemplate).toBe("/open-apis/docx/v1/documents");
    expect(config.lark?.docTokenType).toBe("auto");
    expect(config.lark?.wikiNodeUrlTemplate).toBe("/open-apis/wiki/v2/spaces/get_node");
  });
});
