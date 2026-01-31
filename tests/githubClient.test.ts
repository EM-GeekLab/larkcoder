import { describe, expect, it, vi } from "vitest";
import { GithubClient } from "../src/vcs/githubClient.js";

describe("GithubClient", () => {
  it("creates pull request", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          html_url: "https://github.com/org/repo/pull/1",
          number: 1,
        }),
        { status: 201 },
      ),
    );

    const client = new GithubClient(
      { token: "token", repository: "org/repo" },
      fetchMock as typeof fetch,
    );

    const result = await client.createPullRequest({
      title: "Test",
      body: "Body",
      head: "feature-branch",
      base: "main",
    });

    expect(result.url).toBe("https://github.com/org/repo/pull/1");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
