export const BASIC_LLM_TEMPLATE = `version: "1"
name: "{{name}}"
description: "Single-model AI service."

artifacts:
  models:
    primary:
      type: model
      provider: openai
      model: gpt-4.1-mini-2025-04-14
      parameters:
        temperature: 0
        max_completion_tokens: 2048

eval:
  suite: ./evals
  format: aidrift
  target:
    type: provider
    model: primary

storage:
  backend: local
  path: ./.aidrift/snapshots
`;
