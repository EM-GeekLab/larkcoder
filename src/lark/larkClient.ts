import { renderTemplate } from "../config/template.js";
import { createLogger, type Logger } from "../utils/logger.js";

export type LarkConfig = {
  appId: string;
  appSecret: string;
  baseUrl?: string;
  tokenUrl: string;
  commentUrlTemplate: string;
  commentFileType?: string;
  messageCardUrlTemplate?: string;
  docContentUrlTemplate?: string;
  messageCardReceiveId?: string;
  messageCardReceiveIdType?: string;
  docCreateUrlTemplate?: string;
  docTokenType?: "docx" | "wiki" | "auto";
  wikiNodeUrlTemplate?: string;
};

export type LarkCommentRequest = {
  docToken: string;
  payload: Record<string, unknown>;
  accessToken?: string;
  variables?: Record<string, string>;
  fileType?: string;
};

export type LarkMessageCardRequest = {
  card: Record<string, unknown>;
  url?: string;
  accessToken?: string;
  variables?: Record<string, string>;
  receiveId?: string;
  receiveIdType?: string;
};

export type LarkApiRequest = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  payload?: unknown;
  accessToken?: string;
  headers?: Record<string, string>;
};

export type LarkWikiNode = {
  nodeToken?: string;
  objToken?: string;
  objType?: string;
};

export class LarkClient {
  private logger: Logger;

  constructor(
    private config: LarkConfig,
    private fetchImpl: typeof fetch = fetch,
    logger?: Logger,
  ) {
    this.logger =
      logger ?? createLogger({ prefix: "LarkClient" });
  }

  async getTenantAccessToken(): Promise<string> {
    const response = await this.fetchImpl(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        `Lark token request failed (${response.status}): ${JSON.stringify(body)}`,
      );
    }

    const token = body.tenant_access_token;
    if (typeof token !== "string" || token.length === 0) {
      throw new Error("Lark token response missing tenant_access_token");
    }

    return token;
  }

  async postDocComment(request: LarkCommentRequest): Promise<void> {
    const token = request.accessToken ?? (await this.getTenantAccessToken());
    const url = renderTemplate(this.config.commentUrlTemplate, {
      DOC_TOKEN: request.docToken,
      ...request.variables,
    });

    const fileType = request.fileType ?? this.config.commentFileType ?? "docx";
    const requestUrl = appendQuery(url, "file_type", fileType);

    await this.request<void>({
      url: requestUrl,
      method: "POST",
      payload: request.payload,
      accessToken: token,
    });
  }

  async postMessageCard(request: LarkMessageCardRequest): Promise<void> {
    const url =
      request.url ??
      (this.config.messageCardUrlTemplate
        ? renderTemplate(
            this.config.messageCardUrlTemplate,
            request.variables ?? {},
          )
        : undefined);

    if (!url) {
      throw new Error("Message card URL is required");
    }

    const token = request.accessToken ?? (await this.getTenantAccessToken());
    const receiveId =
      request.receiveId ?? this.config.messageCardReceiveId ?? "";
    const receiveIdType =
      request.receiveIdType ?? this.config.messageCardReceiveIdType;
    if (!receiveId) {
      throw new Error("Message card receive_id is required");
    }

    const messageUrl = receiveIdType
      ? appendQuery(url, "receive_id_type", receiveIdType)
      : url;

    await this.request<void>({
      url: messageUrl,
      method: "POST",
      payload: {
        receive_id: receiveId,
        msg_type: "interactive",
        content: JSON.stringify(request.card),
      },
      accessToken: token,
    });
  }

  async fetchDocMarkdown(
    docToken: string,
    variables?: Record<string, string>,
  ): Promise<string> {
    const token = await this.getTenantAccessToken();
    const urlTemplate =
      this.config.docContentUrlTemplate ??
      "/open-apis/docx/v1/documents/{DOC_TOKEN}/raw_content";
    const url = renderTemplate(urlTemplate, {
      DOC_TOKEN: docToken,
      ...variables,
    });

    const response = await this.request<unknown>({
      url,
      method: "GET",
      accessToken: token,
    });

    const content = extractDocContent(response);
    if (!content) {
      throw new Error("Lark doc content response missing content");
    }

    return content;
  }

  async resolveDocToken(
    token: string,
    tokenType?: "docx" | "wiki" | "auto",
  ): Promise<{ token: string; objType?: string; nodeToken?: string } | null> {
    const mode = tokenType ?? this.config.docTokenType ?? "auto";
    if (mode === "docx") {
      return { token };
    }

    const wikiNode = await this.fetchWikiNode(token, true);
    if (!wikiNode) {
      return mode === "wiki" ? null : { token };
    }

    return {
      token: wikiNode.objToken ?? token,
      objType: wikiNode.objType,
      nodeToken: wikiNode.nodeToken,
    };
  }

  async fetchWikiNode(
    token: string,
    treatAsWiki: boolean,
  ): Promise<LarkWikiNode | null> {
    const tokenValue = token.trim();
    if (!tokenValue) {
      return null;
    }

    const urlTemplate =
      this.config.wikiNodeUrlTemplate ??
      "/open-apis/wiki/v2/spaces/get_node";
    const baseUrl = this.resolveUrl(urlTemplate);
    const url = new URL(baseUrl);
    url.searchParams.set("token", tokenValue);
    if (!treatAsWiki) {
      url.searchParams.set("obj_type", "docx");
    }

    try {
      const tokenString = await this.getTenantAccessToken();
      const response = await this.request<unknown>({
        url: url.toString(),
        method: "GET",
        accessToken: tokenString,
      });

      return extractWikiNode(response);
    } catch (error) {
      this.logger.withError(error).warn("Lark wiki node lookup failed");
      return null;
    }
  }

  async createDocxDocument(options: {
    title?: string;
    folderToken?: string;
  }): Promise<{ documentId?: string; title?: string } | null> {
    const urlTemplate =
      this.config.docCreateUrlTemplate ?? "/open-apis/docx/v1/documents";
    const url = this.resolveUrl(urlTemplate);
    const token = await this.getTenantAccessToken();
    const payload: Record<string, string> = {};
    if (options.title) {
      payload.title = options.title;
    }
    if (options.folderToken) {
      payload.folder_token = options.folderToken;
    }

    const response = await this.request<unknown>({
      url,
      method: "POST",
      accessToken: token,
      payload,
    });

    return extractDocumentId(response);
  }

  async request<T>(options: LarkApiRequest): Promise<T> {
    const url = this.resolveUrl(options.url);
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (options.accessToken) {
      headers.authorization = `Bearer ${options.accessToken}`;
    }

    if (options.headers) {
      Object.assign(headers, options.headers);
    }

    const init: RequestInit = {
      method: options.method ?? "GET",
      headers,
    };

    if (options.payload !== undefined) {
      init.body = JSON.stringify(options.payload);
    }

    const response = await this.fetchImpl(url, init);

    if (!response.ok) {
      const text = await response.text();
      this.logger
        .withMetadata({ status: response.status, body: text })
        .error("Lark request failed");
      throw new Error(`Lark request failed (${response.status})`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }

  private resolveUrl(url: string): string {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }

    if (!this.config.baseUrl) {
      throw new Error("Lark baseUrl is required for relative URLs");
    }

    return new URL(url, this.config.baseUrl).toString();
  }
}

function appendQuery(url: string, key: string, value: string): string {
  try {
    const target = new URL(url);
    target.searchParams.set(key, value);
    return target.toString();
  } catch (error) {
    void error;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(
    value,
  )}`;
}

function extractDocContent(response: unknown): string | null {
  if (typeof response === "string") {
    return response;
  }

  if (!response || typeof response !== "object") {
    return null;
  }

  const record = response as Record<string, unknown>;
  const direct = readContentValue(record);
  if (direct) {
    return direct;
  }

  const data = record.data;
  if (data && typeof data === "object") {
    return readContentValue(data as Record<string, unknown>);
  }

  return null;
}

function extractWikiNode(response: unknown): LarkWikiNode | null {
  if (!response || typeof response !== "object") {
    return null;
  }

  const record = response as Record<string, unknown>;
  const data = record.data;
  if (!data || typeof data !== "object") {
    return null;
  }

  const node = (data as Record<string, unknown>).node;
  if (!node || typeof node !== "object") {
    return null;
  }

  const nodeRecord = node as Record<string, unknown>;
  return {
    nodeToken: getString(nodeRecord.node_token),
    objToken: getString(nodeRecord.obj_token),
    objType: getString(nodeRecord.obj_type),
  };
}

function extractDocumentId(
  response: unknown,
): { documentId?: string; title?: string } | null {
  if (!response || typeof response !== "object") {
    return null;
  }

  const record = response as Record<string, unknown>;
  const data = record.data;
  if (!data || typeof data !== "object") {
    return null;
  }

  const document = (data as Record<string, unknown>).document;
  if (!document || typeof document !== "object") {
    return null;
  }

  const documentRecord = document as Record<string, unknown>;
  return {
    documentId: getString(documentRecord.document_id),
    title: getString(documentRecord.title),
  };
}

function getString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

function readContentValue(record: Record<string, unknown>): string | null {
  const candidates = ["content", "raw_content", "markdown", "text"];
  for (const key of candidates) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}
