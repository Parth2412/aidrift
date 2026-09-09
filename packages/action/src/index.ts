import fs from "node:fs/promises";
import path from "node:path";

import { redactSecrets } from "@zettacore/aidrift";

import { buildCheckArguments, readActionInputs } from "./config.js";
import { publishPullRequestComment } from "./comment.js";
import {
  emitAnnotations,
  hasWarnings,
  parseCheckEvidence,
  regressionCount,
  renderComment,
  renderErrorJunit,
  renderJunit,
} from "./evidence.js";
import type { ActionDependencies, ActionInputs, CheckEvidence, CheckExitCode } from "./types.js";

export { buildCheckArguments, readActionInputs } from "./config.js";
export { COMMENT_MARKER, publishPullRequestComment } from "./comment.js";
export {
  emitAnnotations,
  parseCheckEvidence,
  regressionCount,
  renderComment,
  renderErrorJunit,
  renderJunit,
} from "./evidence.js";
export type * from "./types.js";

export async function runAction(dependencies: ActionDependencies): Promise<CheckExitCode> {
  let inputs: ActionInputs;
  try {
    inputs = readActionInputs(dependencies.core);
    if (dependencies.context.eventName === "pull_request_target") {
      throw new Error(
        "AIDRIFT refuses pull_request_target; use pull_request with a read-only token for untrusted code.",
      );
    }
  } catch (error) {
    const message = safeErrorMessage(error);
    dependencies.core.error(message);
    setActionOutputs(dependencies, "error", 0, undefined, undefined);
    return 2;
  }

  let resultDirectory: string;
  try {
    await fs.mkdir(dependencies.temporaryDirectory, { recursive: true });
    resultDirectory = await fs.mkdtemp(
      path.join(dependencies.temporaryDirectory, "aidrift-action-"),
    );
  } catch (error) {
    const message = safeErrorMessage(error);
    dependencies.core.error(message);
    setActionOutputs(dependencies, "error", 0, undefined, undefined);
    return 2;
  }
  const jsonPath = path.join(resultDirectory, "aidrift-results.json");
  const junitPath = path.join(resultDirectory, "aidrift-results.junit.xml");

  let evidence: CheckEvidence | undefined;
  let errorMessage: string | undefined;
  let exitCode: CheckExitCode = 2;
  let artifactId: number | undefined;
  let artifactUrl: string | undefined;
  let uploadAttempted = false;
  let commentAttempted = false;

  try {
    const execution = await dependencies.exec.run(process.execPath, [
      dependencies.cliPath,
      ...buildCheckArguments(inputs),
    ]);
    exitCode = normalizeExitCode(execution.exitCode);
    if (exitCode === 0 || exitCode === 1) {
      try {
        evidence = parseCheckEvidence(execution.stdout);
      } catch (error) {
        const prefix = sanitizeProviderText(execution.stdout).slice(0, 240);
        throw new Error(
          `${safeErrorMessage(error)}${prefix.length === 0 ? " No stdout was produced." : ` Output prefix: ${prefix}`}`,
        );
      }
      emitAnnotations(dependencies.core, evidence, inputs.manifest);
    } else {
      errorMessage =
        sanitizeProviderText(execution.stderr) || "AIDRIFT check failed before producing evidence.";
      dependencies.core.error(errorMessage, {
        file: inputs.manifest,
        startLine: 1,
        title: "AIDRIFT configuration error",
      });
    }

    await writeEvidenceFiles(jsonPath, junitPath, evidence, exitCode, errorMessage);
    if (inputs.uploadArtifact) {
      uploadAttempted = true;
      const upload = await dependencies.artifact.upload(
        inputs.artifactName,
        [jsonPath, junitPath],
        resultDirectory,
        inputs.retentionDays,
      );
      artifactId = upload.id;
      if (artifactId !== undefined) artifactUrl = buildArtifactUrl(dependencies, artifactId);
    }

    const commentBody = renderComment(evidence, exitCode, errorMessage, artifactUrl);
    commentAttempted = true;
    await publishPullRequestComment({
      core: dependencies.core,
      context: dependencies.context,
      mode: inputs.commentMode,
      token: inputs.githubToken,
      body: commentBody,
      createAdapter: dependencies.createCommentAdapter,
    });
  } catch (error) {
    errorMessage = safeErrorMessage(error);
    exitCode = 2;
    dependencies.core.error(errorMessage, {
      file: inputs.manifest,
      startLine: 1,
      title: "AIDRIFT Action error",
    });
    try {
      await writeEvidenceFiles(jsonPath, junitPath, undefined, exitCode, errorMessage);
      if (inputs.uploadArtifact && !uploadAttempted) {
        uploadAttempted = true;
        const upload = await dependencies.artifact.upload(
          inputs.artifactName,
          [jsonPath, junitPath],
          resultDirectory,
          inputs.retentionDays,
        );
        artifactId = upload.id;
        if (artifactId !== undefined) artifactUrl = buildArtifactUrl(dependencies, artifactId);
      }
      if (!commentAttempted) {
        commentAttempted = true;
        await publishPullRequestComment({
          core: dependencies.core,
          context: dependencies.context,
          mode: inputs.commentMode,
          token: inputs.githubToken,
          body: renderComment(undefined, exitCode, errorMessage, artifactUrl),
          createAdapter: dependencies.createCommentAdapter,
        });
      }
    } catch (recoveryError) {
      dependencies.core.error(
        `AIDRIFT could not publish fallback error evidence: ${safeErrorMessage(recoveryError)}`,
      );
    }
  } finally {
    const result =
      exitCode === 0
        ? hasWarnings(evidence)
          ? "warn"
          : "pass"
        : exitCode === 1
          ? "fail"
          : "error";
    setActionOutputs(dependencies, result, regressionCount(evidence), artifactId, artifactUrl);
    dependencies.core.info(
      `AIDRIFT Action result=${result} regressions=${regressionCount(evidence)} exit=${exitCode}`,
    );
    try {
      await fs.rm(resultDirectory, { recursive: true, force: true });
    } catch (error) {
      dependencies.core.warning(
        `AIDRIFT could not clean its temporary evidence: ${safeErrorMessage(error)}`,
      );
    }
  }

  return exitCode;
}

async function writeEvidenceFiles(
  jsonPath: string,
  junitPath: string,
  evidence: CheckEvidence | undefined,
  exitCode: CheckExitCode,
  errorMessage: string | undefined,
): Promise<void> {
  const json =
    evidence === undefined
      ? JSON.stringify(
          {
            schemaVersion: "action-error.v1",
            exitCode,
            error: errorMessage ?? "AIDRIFT check failed before producing evidence.",
          },
          null,
          2,
        )
      : JSON.stringify(evidence, null, 2);
  const junit =
    evidence === undefined
      ? renderErrorJunit(errorMessage ?? "AIDRIFT check failed before producing evidence.")
      : renderJunit(evidence);
  await fs.writeFile(jsonPath, `${json}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.writeFile(junitPath, junit, { encoding: "utf8", mode: 0o600 });
}

function normalizeExitCode(value: number): CheckExitCode {
  if (value === 0 || value === 1 || value === 2) return value;
  throw new Error(`AIDRIFT CLI returned unsupported exit code ${value}.`);
}

function buildArtifactUrl(dependencies: ActionDependencies, artifactId: number): string {
  const { owner, repository } = dependencies.context.repository;
  return `${dependencies.context.serverUrl}/${owner}/${repository}/actions/runs/${dependencies.context.runId}/artifacts/${artifactId}`;
}

function setActionOutputs(
  dependencies: ActionDependencies,
  result: "pass" | "warn" | "fail" | "error",
  regressions: number,
  artifactId: number | undefined,
  artifactUrl: string | undefined,
): void {
  dependencies.core.setOutput("result", result);
  dependencies.core.setOutput("regressions", regressions);
  dependencies.core.setOutput("artifact-id", artifactId ?? "");
  dependencies.core.setOutput("artifact-url", artifactUrl ?? "");
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unexpected AIDRIFT Action failure.";
  return sanitizeProviderText(message) || "Unexpected AIDRIFT Action failure.";
}

function sanitizeProviderText(value: string): string {
  return redactSecrets(value).trim().slice(0, 4_000);
}
