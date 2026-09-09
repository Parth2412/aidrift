import type { ActionContext, CommentAdapter, CoreAdapter, IssueComment } from "./types.js";

export const COMMENT_MARKER = "<!-- aidrift-comment -->";

export async function publishPullRequestComment(options: {
  readonly core: CoreAdapter;
  readonly context: ActionContext;
  readonly mode: "upsert" | "new" | "none";
  readonly token: string | undefined;
  readonly body: string;
  readonly createAdapter: (token: string) => CommentAdapter;
}): Promise<void> {
  if (options.mode === "none") return;
  if (options.context.eventName === "pull_request_target") {
    throw new Error(
      "AIDRIFT refuses pull_request_target because checking untrusted pull-request state with write credentials is unsafe.",
    );
  }
  const pullRequest = options.context.pullRequest;
  if (options.context.eventName !== "pull_request" || pullRequest === undefined) {
    options.core.notice("AIDRIFT PR comment skipped because this is not a pull_request event.");
    return;
  }
  const baseRepository = `${pullRequest.owner}/${pullRequest.repository}`;
  if (pullRequest.headRepository !== baseRepository) {
    options.core.notice(
      "AIDRIFT PR comment skipped for a fork; fork workflows should retain a read-only token and receive no secrets.",
    );
    return;
  }
  if (options.token === undefined) {
    throw new Error(
      "Input github-token is required to publish a same-repository pull request comment.",
    );
  }

  const client = options.createAdapter(options.token);
  if (options.mode === "new") {
    await client.create(
      pullRequest.owner,
      pullRequest.repository,
      pullRequest.number,
      options.body,
    );
    return;
  }

  const comments = await client.list(pullRequest.owner, pullRequest.repository, pullRequest.number);
  const existing = comments.find(isOwnedAIDriftComment);
  if (existing === undefined) {
    await client.create(
      pullRequest.owner,
      pullRequest.repository,
      pullRequest.number,
      options.body,
    );
  } else {
    await client.update(pullRequest.owner, pullRequest.repository, existing.id, options.body);
  }
}

function isOwnedAIDriftComment(comment: IssueComment): boolean {
  return (
    comment.body?.includes(COMMENT_MARKER) === true &&
    comment.user?.type === "Bot" &&
    comment.user.login === "github-actions[bot]"
  );
}
