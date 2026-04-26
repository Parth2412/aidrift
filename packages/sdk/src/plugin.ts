import type { ArtifactResolver } from "./artifact.js";
import type { AssertionEvaluator } from "./assertion.js";
import type { OutputFormatter } from "./formatter.js";
import type { StorageBackend } from "./storage.js";

export interface AIDriftPlugin {
  readonly name: string;
  readonly version: string;
  readonly resolvers?: readonly ArtifactResolver[] | undefined;
  readonly evaluators?: readonly AssertionEvaluator[] | undefined;
  readonly formatters?: readonly OutputFormatter[] | undefined;
  readonly storage?: readonly StorageBackend[] | undefined;
}
