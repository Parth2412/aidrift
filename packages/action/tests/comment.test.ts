import { describe, expect, it, vi } from "vitest";

import { publishPullRequestComment } from "../src/comment.js";
import type { CommentAdapter } from "../src/types.js";
import { createCore, pushContext } from "./helpers.js";

function commentClient(comments: Awaited<ReturnType<CommentAdapter["list"]>> = []): {
  readonly client: CommentAdapter;
  readonly create: ReturnType<typeof vi.fn>;
  readonly update: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async () => undefined);
  const update = vi.fn(async () => undefined);
  return {
    client: { list: async () => comments, create, update },
    create,
    update,
  };
}

describe("PR comment publishing", () => {
  it("updates one owned marker comment and ignores user/third-party markers", async () => {
    const test = createCore();
    const mock = commentClient([
      { id: 1, body: "<!-- aidrift-comment -->", user: { login: "human", type: "User" } },
      {
        id: 2,
        body: "<!-- aidrift-comment --> old",
        user: { login: "github-actions[bot]", type: "Bot" },
      },
    ]);
    await publishPullRequestComment({
      core: test.core,
      context: {
        ...pushContext(),
        eventName: "pull_request",
        pullRequest: {
          owner: "owner",
          repository: "repo",
          number: 7,
          headRepository: "owner/repo",
        },
      },
      mode: "upsert",
      token: "masked",
      body: "<!-- aidrift-comment --> new",
      createAdapter: () => mock.client,
    });

    expect(mock.create).not.toHaveBeenCalled();
    expect(mock.update).toHaveBeenCalledWith("owner", "repo", 2, "<!-- aidrift-comment --> new");
  });

  it("creates a marker comment when none exists", async () => {
    const mock = commentClient();
    await publishPullRequestComment({
      core: createCore().core,
      context: {
        ...pushContext(),
        eventName: "pull_request",
        pullRequest: {
          owner: "owner",
          repository: "repo",
          number: 8,
          headRepository: "owner/repo",
        },
      },
      mode: "upsert",
      token: "masked",
      body: "<!-- aidrift-comment --> result",
      createAdapter: () => mock.client,
    });
    expect(mock.create).toHaveBeenCalledOnce();
  });

  it("skips fork writes and rejects pull_request_target", async () => {
    const test = createCore();
    const createAdapter = vi.fn(() => commentClient().client);
    await publishPullRequestComment({
      core: test.core,
      context: {
        ...pushContext(),
        eventName: "pull_request",
        pullRequest: {
          owner: "owner",
          repository: "repo",
          number: 9,
          headRepository: "fork/repo",
        },
      },
      mode: "upsert",
      token: undefined,
      body: "result",
      createAdapter,
    });
    expect(createAdapter).not.toHaveBeenCalled();
    expect(test.notices.join(" ")).toContain("fork");

    await expect(
      publishPullRequestComment({
        core: test.core,
        context: { ...pushContext(), eventName: "pull_request_target" },
        mode: "upsert",
        token: "masked",
        body: "result",
        createAdapter,
      }),
    ).rejects.toThrow("refuses pull_request_target");
  });
});
