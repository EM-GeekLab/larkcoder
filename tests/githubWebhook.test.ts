import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GithubWebhookHandler } from "../src/vcs/githubWebhook.js";

describe("GithubWebhookHandler", () => {
  it("routes pull_request_review events", async () => {
    const secret = "test-secret";
    const payload = {
      action: "submitted",
      review: { body: "LGTM" },
      pull_request: {
        head: { ref: "feature/test" },
        html_url: "https://github.com/org/repo/pull/1",
      },
      repository: { full_name: "org/repo" },
    };
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const signature = sign(secret, body);

    let received: unknown = null;
    const handler = new GithubWebhookHandler({
      webhookSecret: secret,
      workflow: {
        handleGithubEvent: async (event) => {
          received = event;
        },
      },
    });

    const response = await handler.handle({
      body,
      signature,
      event: "pull_request_review",
    });

    expect(response.status).toBe(200);
    if (!isRecord(received) || typeof received.type !== "string") {
      throw new Error("Expected webhook event to be captured");
    }

    expect(received.type).toBe("pull_request_review");
    if (typeof received.headRef !== "string") {
      throw new Error("Expected headRef to be captured");
    }
    expect(received.headRef).toBe("feature/test");
  });

  it("routes push events", async () => {
    const secret = "test-secret";
    const payload = {
      ref: "refs/heads/feature/push",
      repository: { full_name: "org/repo" },
    };
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const signature = sign(secret, body);

    let received: unknown = null;
    const handler = new GithubWebhookHandler({
      webhookSecret: secret,
      workflow: {
        handleGithubEvent: async (event) => {
          received = event;
        },
      },
    });

    const response = await handler.handle({
      body,
      signature,
      event: "push",
    });

    expect(response.status).toBe(200);
    if (!isRecord(received) || received.type !== "push") {
      throw new Error("Expected push event to be captured");
    }
    expect(received.headRef).toBe("feature/push");
  });
});

function sign(secret: string, body: Buffer): string {
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${digest}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
