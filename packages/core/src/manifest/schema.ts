export const AI_STATE_MANIFEST_SCHEMA = {
  $id: "https://aidrift.dev/schemas/aistate.v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["version", "name", "artifacts", "eval", "storage"],
  properties: {
    version: { const: "1" },
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    artifacts: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompts: { $ref: "#/$defs/promptArtifacts" },
        models: { $ref: "#/$defs/modelArtifacts" },
        rag: { $ref: "#/$defs/ragArtifacts" },
        tools: { $ref: "#/$defs/toolArtifacts" },
        safety: { $ref: "#/$defs/safetyArtifacts" },
        adapters: { $ref: "#/$defs/adapterArtifacts" },
        custom: { $ref: "#/$defs/customArtifacts" },
      },
    },
    eval: {
      type: "object",
      additionalProperties: true,
      required: ["suite"],
      properties: {
        suite: { type: "string", minLength: 1 },
        format: { enum: ["aidrift", "promptfoo"] },
        samples_per_assertion: { type: "integer", minimum: 1 },
        significance_level: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 },
        timeout_seconds: { type: "integer", minimum: 1 },
        target: {
          type: "object",
          additionalProperties: true,
          required: ["type"],
          properties: {
            type: { enum: ["provider", "http", "subprocess"] },
          },
        },
      },
    },
    storage: {
      type: "object",
      additionalProperties: false,
      required: ["backend", "path"],
      properties: {
        backend: { enum: ["local", "git"] },
        path: { type: "string", minLength: 1 },
      },
    },
    plugins: {
      type: "array",
      items: {
        anyOf: [
          { type: "string", minLength: 1 },
          {
            type: "object",
            additionalProperties: false,
            required: ["name"],
            properties: {
              name: { type: "string", minLength: 1 },
              version: { type: "string", minLength: 1 },
              options: {},
            },
          },
        ],
      },
    },
  },
  $defs: {
    promptArtifacts: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/promptArtifact" },
    },
    modelArtifacts: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/modelArtifact" },
    },
    ragArtifacts: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/ragArtifact" },
    },
    toolArtifacts: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/toolArtifact" },
    },
    safetyArtifacts: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/safetyArtifact" },
    },
    adapterArtifacts: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/adapterArtifact" },
    },
    customArtifacts: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/customArtifact" },
    },
    artifactBase: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1 },
        glob: { type: "string", minLength: 1 },
        hash_algorithm: { enum: ["sha256", "md5"] },
        metadata: { type: "object" },
      },
    },
    promptArtifact: {
      allOf: [
        { $ref: "#/$defs/artifactBase" },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "path"],
          properties: {
            type: { const: "prompt" },
            path: { type: "string", minLength: 1 },
            format: { enum: ["text", "json", "jinja2", "mustache"] },
            metadata: { type: "object" },
          },
        },
      ],
    },
    modelArtifact: {
      type: "object",
      additionalProperties: false,
      required: ["type", "provider", "model"],
      properties: {
        type: { const: "model" },
        provider: { type: "string", minLength: 1 },
        model: { type: "string", minLength: 1 },
        parameters: { type: "object", additionalProperties: true },
        metadata: { type: "object" },
      },
    },
    ragArtifact: {
      type: "object",
      additionalProperties: false,
      required: ["type", "path"],
      properties: {
        type: { const: "rag_config" },
        path: { type: "string", minLength: 1 },
        index_hash_command: { type: "string" },
        metadata: { type: "object" },
      },
    },
    toolArtifact: {
      type: "object",
      additionalProperties: false,
      required: ["type", "path"],
      properties: {
        type: { const: "tool_schema" },
        path: { type: "string", minLength: 1 },
        glob: { type: "string", minLength: 1 },
        metadata: { type: "object" },
      },
    },
    safetyArtifact: {
      type: "object",
      additionalProperties: false,
      required: ["type", "path"],
      properties: {
        type: { const: "safety_rules" },
        path: { type: "string", minLength: 1 },
        metadata: { type: "object" },
      },
    },
    adapterArtifact: {
      type: "object",
      additionalProperties: false,
      required: ["type", "path"],
      properties: {
        type: { const: "adapter" },
        path: { type: "string", minLength: 1 },
        hash_algorithm: { enum: ["sha256", "md5"] },
        metadata: { type: "object" },
      },
    },
    customArtifact: {
      type: "object",
      additionalProperties: true,
      required: ["type"],
      properties: {
        type: { const: "custom" },
        path: { type: "string", minLength: 1 },
        glob: { type: "string", minLength: 1 },
        hash_algorithm: { enum: ["sha256", "md5"] },
        metadata: { type: "object" },
      },
    },
  },
} as const;
