export const AGENT_TEMPLATE = `version: "1"
name: "{{name}}"
description: "Autonomous agent with tool use and safety rules."

artifacts:
  models:
    primary:
      type: model
      provider: openai
      model: gpt-4o-2024-08-06
      parameters:
        temperature: 0.2
        max_tokens: 8192
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

storage:
  backend: local
  path: ./.aidrift/snapshots
`;
