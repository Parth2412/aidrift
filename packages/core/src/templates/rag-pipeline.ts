export const RAG_PIPELINE_TEMPLATE = `version: "1"
name: "{{name}}"
description: "RAG pipeline with model and vector store."

artifacts:
  models:
    primary:
      type: model
      provider: openai
      model: gpt-4o-2024-08-06
      parameters:
        temperature: 0.3
        max_tokens: 4096
  rag:
    knowledge_base:
      type: rag_config
      path: ./rag/config.yml

eval:
  suite: ./evals
  format: aidrift

storage:
  backend: local
  path: ./.aidrift/snapshots
`;
