import { BASIC_LLM_TEMPLATE } from "./basic-llm.js";
import { RAG_PIPELINE_TEMPLATE } from "./rag-pipeline.js";
import { AGENT_TEMPLATE } from "./agent.js";

export type TemplateId = "basic-llm" | "rag-pipeline" | "agent";

export interface TemplateEntry {
  readonly id: TemplateId;
  readonly description: string;
  readonly yaml: string;
  readonly files?: Readonly<Record<string, string>>;
}

export const TEMPLATES: ReadonlyMap<TemplateId, TemplateEntry> = new Map([
  [
    "basic-llm",
    {
      id: "basic-llm",
      description: "Single model, no RAG, no tools.",
      yaml: BASIC_LLM_TEMPLATE,
    },
  ],
  [
    "rag-pipeline",
    {
      id: "rag-pipeline",
      description: "Model + RAG config stub.",
      yaml: RAG_PIPELINE_TEMPLATE,
      files: {
        "rag/config.yml": `version: "1"\nretrieval:\n  provider: configure-me\n  top_k: 5\n`,
      },
    },
  ],
  [
    "agent",
    {
      id: "agent",
      description: "Model + tool schemas + safety rules stub.",
      yaml: AGENT_TEMPLATE,
      files: {
        "tools/openapi.yml": `openapi: 3.1.0\ninfo:\n  title: Configure Me\n  version: 0.1.0\npaths: {}\n`,
        "safety/rules.yml": `version: "1"\nrules: []\n`,
      },
    },
  ],
]);

export function getTemplate(id: string): TemplateEntry {
  const entry = TEMPLATES.get(id as TemplateId);
  if (entry === undefined) {
    throw new Error(`Unknown template: "${id}". Available: ${[...TEMPLATES.keys()].join(", ")}.`);
  }
  return entry;
}

export function applyTemplateName(template: TemplateEntry, name: string): string {
  const escapedName = JSON.stringify(name).slice(1, -1);
  return template.yaml.replace(/\{\{name\}\}/g, escapedName);
}
