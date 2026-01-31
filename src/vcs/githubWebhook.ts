import { createHmac, timingSafeEqual } from "node:crypto";
import { createLogger, type Logger } from "../utils/logger.js";

export type GithubWebhookHandlerOptions = {
  webhookSecret: string;
  logger?: Logger;
  workflow?: {
    handleGithubEvent: (event: GithubWebhookEvent) => Promise<void>;
  };
};

export type GithubWebhookRequest = {
  body: Buffer;
  signature?: string;
  event?: string;
};

export type GithubWebhookResponse = {
  status: number;
  body: { ok?: boolean; error?: string };
};

export type GithubWebhookEvent =
  | {
      type:
        | "pull_request_review"
        | "pull_request_review_comment"
        | "issue_comment";
      action?: string;
      body?: string;
      headRef?: string;
      pullRequestUrl?: string;
      repository?: string;
    }
  | {
      type: "check_run" | "check_suite" | "status";
      status?: string;
      conclusion?: string;
      headRef?: string;
      repository?: string;
    }
  | {
      type: "push";
      headRef?: string;
      repository?: string;
    };

export class GithubWebhookHandler {
  private logger: Logger;

  constructor(private options: GithubWebhookHandlerOptions) {
    this.logger = options.logger ?? createLogger({ prefix: "GithubWebhook" });
  }

  async handle(request: GithubWebhookRequest): Promise<GithubWebhookResponse> {
    const signature = request.signature;
    const event = request.event ?? "unknown";

    if (!signature) {
      return { status: 400, body: { error: "Missing signature" } };
    }

    const verified = verifyGithubSignature(
      this.options.webhookSecret,
      request.body,
      signature,
    );

    if (!verified) {
      return { status: 401, body: { error: "Invalid signature" } };
    }

    const payload = parseJson(request.body);
    if (!payload) {
      return { status: 400, body: { error: "Invalid JSON payload" } };
    }

    const parsedEvent = parseGithubEvent(event, payload);
    if (parsedEvent && this.options.workflow) {
      await this.options.workflow.handleGithubEvent(parsedEvent);
    }

    this.logger.withMetadata({ event }).info("GitHub webhook received");
    return { status: 200, body: { ok: true } };
  }
}

export function verifyGithubSignature(
  secret: string,
  body: Buffer,
  signatureHeader: string,
): boolean {
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  const expected = `sha256=${digest}`;

  try {
    return timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signatureHeader, "utf8"),
    );
  } catch {
    return false;
  }
}

function parseJson(body: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body.toString("utf8"));
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    void error;
  }
  return null;
}

function parseGithubEvent(
  event: string,
  payload: Record<string, unknown>,
): GithubWebhookEvent | null {
  switch (event) {
    case "pull_request_review": {
      return buildReviewEvent("pull_request_review", payload);
    }
    case "pull_request_review_comment": {
      return buildReviewCommentEvent(payload);
    }
    case "issue_comment": {
      return buildIssueCommentEvent(payload);
    }
    case "check_run": {
      return buildCheckRunEvent(payload);
    }
    case "check_suite": {
      return buildCheckSuiteEvent(payload);
    }
    case "status": {
      return buildStatusEvent(payload);
    }
    case "push": {
      return buildPushEvent(payload);
    }
    default:
      return null;
  }
}

function buildReviewEvent(
  type: "pull_request_review",
  payload: Record<string, unknown>,
): GithubWebhookEvent {
  const review = isRecord(payload.review) ? payload.review : null;
  const prInfo = extractPullRequest(payload);
  return {
    type,
    action: getString(payload.action),
    body: getString(review?.body),
    headRef: prInfo.headRef,
    pullRequestUrl: prInfo.url,
    repository: extractRepository(payload),
  };
}

function buildReviewCommentEvent(
  payload: Record<string, unknown>,
): GithubWebhookEvent {
  const comment = isRecord(payload.comment) ? payload.comment : null;
  const prInfo = extractPullRequest(payload);
  return {
    type: "pull_request_review_comment",
    action: getString(payload.action),
    body: getString(comment?.body),
    headRef: prInfo.headRef,
    pullRequestUrl: prInfo.url,
    repository: extractRepository(payload),
  };
}

function buildIssueCommentEvent(
  payload: Record<string, unknown>,
): GithubWebhookEvent | null {
  const issue = isRecord(payload.issue) ? payload.issue : null;
  const comment = isRecord(payload.comment) ? payload.comment : null;
  if (!issue || !issue.pull_request) {
    return null;
  }

  const pr = isRecord(issue.pull_request) ? issue.pull_request : null;
  return {
    type: "issue_comment",
    action: getString(payload.action),
    body: getString(comment?.body),
    pullRequestUrl: getString(pr?.html_url) ?? getString(pr?.url),
    repository: extractRepository(payload),
  };
}

function buildCheckRunEvent(
  payload: Record<string, unknown>,
): GithubWebhookEvent {
  const checkRun = isRecord(payload.check_run) ? payload.check_run : null;
  const pullRequests = Array.isArray(checkRun?.pull_requests)
    ? checkRun?.pull_requests
    : [];
  const headRef =
    pullRequests.length > 0 ? getString(pullRequests[0]?.head?.ref) : undefined;
  return {
    type: "check_run",
    status: getString(checkRun?.status),
    conclusion: getString(checkRun?.conclusion),
    headRef,
    repository: extractRepository(payload),
  };
}

function buildCheckSuiteEvent(
  payload: Record<string, unknown>,
): GithubWebhookEvent {
  const checkSuite = isRecord(payload.check_suite) ? payload.check_suite : null;
  return {
    type: "check_suite",
    status: getString(checkSuite?.status),
    conclusion: getString(checkSuite?.conclusion),
    headRef: getString(checkSuite?.head_branch),
    repository: extractRepository(payload),
  };
}

function buildStatusEvent(
  payload: Record<string, unknown>,
): GithubWebhookEvent {
  const branches = Array.isArray(payload.branches) ? payload.branches : [];
  const headRef =
    branches.length > 0 ? getString(branches[0]?.name) : undefined;
  return {
    type: "status",
    status: getString(payload.state),
    conclusion: getString(payload.description),
    headRef,
    repository: extractRepository(payload),
  };
}

function buildPushEvent(payload: Record<string, unknown>): GithubWebhookEvent {
  const ref = getString(payload.ref);
  const headRef = ref ? ref.replace(/^refs\/heads\//, "") : undefined;
  return {
    type: "push",
    headRef,
    repository: extractRepository(payload),
  };
}

function extractPullRequest(payload: Record<string, unknown>): {
  headRef?: string;
  url?: string;
} {
  const pr = isRecord(payload.pull_request) ? payload.pull_request : null;
  const head = isRecord(pr?.head) ? pr?.head : null;
  return {
    headRef: getString(head?.ref),
    url: getString(pr?.html_url),
  };
}

function extractRepository(
  payload: Record<string, unknown>,
): string | undefined {
  const repo = isRecord(payload.repository) ? payload.repository : null;
  return getString(repo?.full_name);
}

function getString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
