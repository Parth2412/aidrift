import { BASIC_LLM_TEMPLATE } from "./basic-llm.js";
import { RAG_PIPELINE_TEMPLATE } from "./rag-pipeline.js";
import { AGENT_TEMPLATE } from "./agent.js";

export type TemplateId = "basic-llm" | "rag-pipeline" | "agent";

export interface TemplateEntry {
  readonly id: TemplateId;
  readonly description: string;
  readonly yaml: string;
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
    },
  ],
  [
    "agent",
    {
      id: "agent",
      description: "Model + tool schemas + safety rules stub.",
      yaml: AGENT_TEMPLATE,
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
  return template.yaml.replace(/\{\{name\}\}/g, name);
}
