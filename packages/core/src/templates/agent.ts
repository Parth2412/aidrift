export const AGENT_TEMPLATE = `version: "1"
name: "{{name}}"
description: "Autonomous agent with tool use and safety rules."

artifacts:
  models:
    primary:
      type: model
      provider: openai
      model: gpt-4.1-mini-2025-04-14
      parameters:
        temperature: 0
        max_completion_tokens: 8192
  tools:
    api:
      type: tool_schema
      path: ./tools/openapi.yml
  safety:
    guardrails:
      type: safety_rules
      path: ./safety/rules.yml

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
