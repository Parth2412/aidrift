export const BASIC_LLM_TEMPLATE = `version: "1"
name: "{{name}}"
description: "Single-model AI service."

artifacts:
  models:
    primary:
      type: model
      provider: openai
      model: gpt-4o-2024-08-06
      parameters:
        temperature: 0.7
        max_tokens: 2048

eval:
  suite: ./evals
  format: aidrift

storage:
  backend: local
  path: ./.aidrift/snapshots
`;
