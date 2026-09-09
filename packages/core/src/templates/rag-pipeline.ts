export const RAG_PIPELINE_TEMPLATE = `version: "1"
name: "{{name}}"
description: "RAG pipeline with model and vector store."

artifacts:
  models:
    primary:
      type: model
      provider: openai
      model: gpt-4.1-mini-2025-04-14
      parameters:
        temperature: 0
        max_completion_tokens: 4096
  rag:
    knowledge_base:
      type: rag_config
      path: ./rag/config.yml

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
