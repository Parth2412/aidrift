import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

import { applyTemplateName, getTemplate, TEMPLATES } from "../../src/templates/index.js";

describe("built-in templates", () => {
  it("escapes project names before inserting them into quoted YAML", () => {
    const name = 'quoted " project\\name';
    const source = applyTemplateName(getTemplate("basic-llm"), name);
    const document = parseDocument(source);

    expect(document.errors).toEqual([]);
    expect((document.toJS() as { name: string }).name).toBe(name);
  });

  it("declares scaffold content for every referenced non-model artifact", () => {
    expect(TEMPLATES.get("rag-pipeline")?.files).toHaveProperty("rag/config.yml");
    expect(TEMPLATES.get("agent")?.files).toMatchObject({
      "tools/openapi.yml": expect.any(String),
      "safety/rules.yml": expect.any(String),
    });
  });
});
