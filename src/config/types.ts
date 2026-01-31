import { z } from "zod";

const rawConfigSchema = z.object({
  agent_runtime: z.object({
    container_template: z.object({
      cmd: z.string().min(1),
    }),
    connection: z.object({
      type: z.literal("sse"),
      url_template: z.string().min(1),
      send_url_template: z.string().min(1).optional(),
      headers: z.record(z.string(), z.string()).optional(),
    }),
  }),
  server: z
    .object({
      port: z.number().int().positive().optional(),
      public_base_url: z.string().min(1).optional(),
    })
    .optional(),
  network: z
    .object({
      name: z.string().min(1),
    })
    .optional(),
  redis: z
    .object({
      url: z.string().min(1),
    })
    .optional(),
  lark: z
    .object({
      app_id: z.string().min(1),
      app_secret: z.string().min(1),
      base_url: z.string().min(1).optional(),
      token_url: z.string().min(1),
      comment_url_template: z.string().min(1),
      comment_file_type: z.string().min(1).optional(),
      message_card_url_template: z.string().min(1).optional(),
      message_card_receive_id: z.string().min(1).optional(),
      message_card_receive_id_type: z.string().min(1).optional(),
      doc_content_url_template: z.string().min(1).optional(),
      doc_create_url_template: z.string().min(1).optional(),
      doc_token_type: z.enum(["docx", "wiki", "auto"]).optional(),
      wiki_node_url_template: z.string().min(1).optional(),
    })
    .optional(),
  github: z
    .object({
      webhook_secret: z.string().min(1),
      token: z.string().min(1).optional(),
      api_base_url: z.string().min(1).optional(),
      repository: z.string().min(1).optional(),
      default_base_branch: z.string().min(1).optional(),
    })
    .optional(),
});

export type RawConfig = z.input<typeof rawConfigSchema>;

export const appConfigSchema = rawConfigSchema.transform((raw) => {
  const connection: {
    type: "sse";
    urlTemplate: string;
    sendUrlTemplate?: string;
    headers?: Record<string, string>;
  } = {
    type: "sse",
    urlTemplate: raw.agent_runtime.connection.url_template,
  };

  if (raw.agent_runtime.connection.send_url_template) {
    connection.sendUrlTemplate = raw.agent_runtime.connection.send_url_template;
  }

  if (raw.agent_runtime.connection.headers) {
    connection.headers = raw.agent_runtime.connection.headers;
  }

  const config: {
    agentRuntime: {
      containerTemplate: { cmd: string };
      connection: typeof connection;
    };
    server: { port: number; publicBaseUrl?: string };
    network?: { name: string };
    redis?: { url: string };
    lark?: {
      appId: string;
      appSecret: string;
      baseUrl?: string;
      tokenUrl: string;
      commentUrlTemplate: string;
      commentFileType?: string;
      messageCardUrlTemplate?: string;
      messageCardReceiveId?: string;
      messageCardReceiveIdType?: string;
      docContentUrlTemplate?: string;
      docCreateUrlTemplate?: string;
      docTokenType?: "docx" | "wiki" | "auto";
      wikiNodeUrlTemplate?: string;
    };
    github?: {
      webhookSecret: string;
      token?: string;
      apiBaseUrl?: string;
      repository?: string;
      defaultBaseBranch?: string;
    };
  } = {
    agentRuntime: {
      containerTemplate: {
        cmd: raw.agent_runtime.container_template.cmd,
      },
      connection,
    },
    server: {
      port: raw.server?.port ?? 8080,
      publicBaseUrl: raw.server?.public_base_url,
    },
  };

  if (raw.network?.name) {
    config.network = { name: raw.network.name };
  }

  if (raw.redis) {
    config.redis = { url: raw.redis.url };
  }

  if (raw.lark) {
    const larkConfig: {
      appId: string;
      appSecret: string;
      baseUrl?: string;
      tokenUrl: string;
      commentUrlTemplate: string;
      commentFileType?: string;
      messageCardUrlTemplate?: string;
      messageCardReceiveId?: string;
      messageCardReceiveIdType?: string;
      docContentUrlTemplate?: string;
      docCreateUrlTemplate?: string;
      docTokenType?: "docx" | "wiki" | "auto";
      wikiNodeUrlTemplate?: string;
    } = {
      appId: raw.lark.app_id,
      appSecret: raw.lark.app_secret,
      tokenUrl: raw.lark.token_url,
      commentUrlTemplate: raw.lark.comment_url_template,
    };

    if (raw.lark.base_url) {
      larkConfig.baseUrl = raw.lark.base_url;
    }

    if (raw.lark.message_card_url_template) {
      larkConfig.messageCardUrlTemplate = raw.lark.message_card_url_template;
    }

    if (raw.lark.comment_file_type) {
      larkConfig.commentFileType = raw.lark.comment_file_type;
    }

    if (raw.lark.message_card_receive_id) {
      larkConfig.messageCardReceiveId = raw.lark.message_card_receive_id;
    }

    if (raw.lark.message_card_receive_id_type) {
      larkConfig.messageCardReceiveIdType =
        raw.lark.message_card_receive_id_type;
    }

    if (raw.lark.doc_content_url_template) {
      larkConfig.docContentUrlTemplate = raw.lark.doc_content_url_template;
    }

    if (raw.lark.doc_create_url_template) {
      larkConfig.docCreateUrlTemplate = raw.lark.doc_create_url_template;
    }

    if (raw.lark.doc_token_type) {
      larkConfig.docTokenType = raw.lark.doc_token_type;
    }

    if (raw.lark.wiki_node_url_template) {
      larkConfig.wikiNodeUrlTemplate = raw.lark.wiki_node_url_template;
    }

    config.lark = larkConfig;
  }

  if (raw.github) {
    config.github = {
      webhookSecret: raw.github.webhook_secret,
      token: raw.github.token,
      apiBaseUrl: raw.github.api_base_url,
      repository: raw.github.repository,
      defaultBaseBranch: raw.github.default_base_branch,
    };
  }

  return config;
});

export type AppConfig = z.output<typeof appConfigSchema>;
