import { createLogger, type Logger } from "../utils/logger.js"

export type GithubConfig = {
  token: string
  apiBaseUrl?: string
  repository: string
}

export type GithubPullRequestRequest = {
  title: string
  body?: string
  head: string
  base: string
  draft?: boolean
  repository?: string
}

export type GithubPullRequestResponse = {
  url: string
  number?: number
}

export class GithubClient {
  private logger: Logger

  constructor(
    private config: GithubConfig,
    private fetchImpl: typeof fetch = fetch,
    logger?: Logger,
  ) {
    this.logger = logger ?? createLogger({ prefix: "GithubClient" })
  }

  async createPullRequest(
    request: GithubPullRequestRequest,
  ): Promise<GithubPullRequestResponse> {
    const repository = request.repository ?? this.config.repository
    const url = new URL(
      `/repos/${repository}/pulls`,
      this.config.apiBaseUrl ?? "https://api.github.com",
    )
    const payload: Record<string, unknown> = {
      title: request.title,
      body: request.body,
      head: request.head,
      base: request.base,
    }
    if (request.draft !== undefined) {
      payload.draft = request.draft
    }

    const response = await this.fetchImpl(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.token}`,
        "user-agent": "autocoder-orchestrator",
      },
      body: JSON.stringify(payload),
    })

    const text = await response.text()
    if (!response.ok) {
      this.logger
        .withMetadata({ status: response.status, body: text })
        .error("GitHub create PR failed")
      throw new Error(`GitHub create PR failed (${response.status})`)
    }

    const parsed = parseJson(text)
    const htmlUrl = getString(parsed?.html_url) ?? getString(parsed?.url)
    if (!htmlUrl) {
      throw new Error("GitHub create PR response missing url")
    }
    const number =
      typeof parsed?.number === "number" ? parsed?.number : undefined

    return { url: htmlUrl, number }
  }
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>
    }
  } catch (error) {
    void error
  }
  return null
}

function getString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value
  }
  return undefined
}
