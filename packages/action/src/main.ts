import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DefaultArtifactClient } from "@actions/artifact";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";

import { runAction } from "./index.js";
import { BoundedUtf8Collector } from "./bounded-output.js";
import { childProcessEnvironment } from "./environment.js";
import type { ActionContext, ActionDependencies, CommentAdapter, IssueComment } from "./types.js";

// Compute this at runtime. A static `new URL("./cli/index.js", import.meta.url)` is
// treated as a source asset by ncc and replaced with a CommonJS loader instead
// of the executable CLI bundle.
const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli", "index.js");
const MAX_CLI_STDOUT_BYTES = 16 * 1024 * 1024;
const MAX_CLI_STDERR_BYTES = 1024 * 1024;

void runAction(createDefaultDependencies())
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    core.error(error instanceof Error ? error.message : "Unexpected AIDRIFT Action failure.");
    process.exitCode = 2;
  });

function createDefaultDependencies(): ActionDependencies {
  const artifactClient = new DefaultArtifactClient();
  return {
    core,
    exec: {
      async run(command, args) {
        const stdoutCollector = new BoundedUtf8Collector(MAX_CLI_STDOUT_BYTES);
        const stderrCollector = new BoundedUtf8Collector(MAX_CLI_STDERR_BYTES);
        const exitCode = await exec.exec(command, [...args], {
          ignoreReturnCode: true,
          silent: true,
          env: childProcessEnvironment(process.env),
          listeners: {
            stdout(data) {
              stdoutCollector.write(data);
            },
            stderr(data) {
              stderrCollector.write(data);
            },
          },
        });
        const stdout = stdoutCollector.end();
        const stderr = stderrCollector.end();
        if (stdoutCollector.exceeded || stderrCollector.exceeded) {
          return {
            exitCode: 2,
            stdout: "",
            stderr: `AIDRIFT CLI ${stdoutCollector.exceeded ? "stdout" : "stderr"} exceeded the Action safety limit.`,
          };
        }
        return { exitCode, stdout, stderr };
      },
    },
    artifact: {
      async upload(name, files, rootDirectory, retentionDays) {
        return artifactClient.uploadArtifact(name, [...files], rootDirectory, { retentionDays });
      },
    },
    context: actionContext(),
    createCommentAdapter,
    cliPath,
    temporaryDirectory: process.env["RUNNER_TEMP"] ?? os.tmpdir(),
  };
}

function actionContext(): ActionContext {
  const repository = github.context.repo;
  const pullRequest = extractPullRequest(github.context.payload as unknown, repository);
  return {
    eventName: github.context.eventName,
    runId: github.context.runId,
    serverUrl: github.context.serverUrl,
    repository: { owner: repository.owner, repository: repository.repo },
    pullRequest,
  };
}

function extractPullRequest(
  payload: unknown,
  repository: { readonly owner: string; readonly repo: string },
): ActionContext["pullRequest"] {
  const payloadRecord = asRecord(payload);
  const pullRequest = asRecord(payloadRecord?.["pull_request"]);
  const number = pullRequest?.["number"];
  const head = asRecord(pullRequest?.["head"]);
  const headRepository = asRecord(head?.["repo"]);
  const fullName = headRepository?.["full_name"];
  if (typeof number !== "number" || typeof fullName !== "string") return undefined;
  return {
    owner: repository.owner,
    repository: repository.repo,
    number,
    headRepository: fullName,
  };
}

function createCommentAdapter(token: string): CommentAdapter {
  const octokit = github.getOctokit(token);
  return {
    async list(owner, repository, issueNumber): Promise<readonly IssueComment[]> {
      const comments = await octokit.paginate(octokit.rest.issues.listComments, {
        owner,
        repo: repository,
        issue_number: issueNumber,
        per_page: 100,
      });
      return comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        user:
          comment.user === null ? null : { login: comment.user?.login, type: comment.user?.type },
      }));
    },
    async create(owner, repository, issueNumber, body): Promise<void> {
      await octokit.rest.issues.createComment({
        owner,
        repo: repository,
        issue_number: issueNumber,
        body,
      });
    },
    async update(owner, repository, commentId, body): Promise<void> {
      await octokit.rest.issues.updateComment({
        owner,
        repo: repository,
        comment_id: commentId,
        body,
      });
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
