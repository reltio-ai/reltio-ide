## Why

Reltio tenant metadata configurations are large, complex JSON files that define entity types, attributes, relationships, match/survivorship/cleanse rules, and sources for Master Data Management. Today, editing these configurations requires hand-editing raw JSON with no validation, no structural navigation, no visual overview of entity relationships, and no AI assistance — leading to errors, slow onboarding, and painful debugging. A purpose-built VS Code/Cursor extension would give the Reltio community a modern editing experience with schema validation, tree-based navigation, a visual entity-relationship diagram, and an AI assistant.

## What Changes

- Add a VS Code extension that activates for `*.reltio.json` files
- Add a comprehensive JSON Schema providing real-time validation, autocomplete, and hover documentation for all Reltio metadata constructs (entity types, relation types, attributes with 24+ data types, match groups, survivorship groups, cleanse groups, sources)
- Add TypeScript model types and a position-aware JSON parser (using `jsonc-parser`) to bridge the editor and all custom views
- Add a sidebar tree view showing the full configuration hierarchy: Entity Types > Attributes (simple/nested/reference), Relation Types, Match Groups, Survivorship Groups, Cleanse Groups, Sources — with click-to-reveal navigation and context menu editing (add, delete, rename)
- Add a React Flow webview panel rendering entity types as nodes and relation types as edges, with auto-layout and bidirectional sync to the JSON editor
- Add an AI chat webview panel with pluggable LLM backend (OpenAI, Anthropic, Ollama) that understands the Reltio schema and can generate/modify configurations with an "Apply" action

## Capabilities

### New Capabilities — Implemented
- `json-schema-validation`: JSON Schema for Reltio metadata providing validation, autocomplete, and hover docs for all configuration constructs → See [code-model-and-schema](../code-model-and-schema/proposal.md)
- `config-tree-view`: Sidebar tree view with hierarchical navigation, icons per node type, click-to-reveal in editor, and context menu actions (add entity type, add attribute, delete, rename) → See [config-tree-view](../config-tree-view/proposal.md)

### New Capabilities — Deferred
- `entity-diagram`: React Flow webview panel showing entity types as nodes and relation types as labeled edges, with auto-layout, zoom/pan, and click-to-navigate. Depends on `code-model-and-schema` and `config-tree-view`. Will be a separate change.
- `ai-assistant`: Chat webview with pluggable LLM backend for AI-driven configuration editing, schema-aware prompts, and apply-to-editor action. Depends on `code-model-and-schema`. Will be a separate change.

### Modified Capabilities

## Impact

- **New files**: Extension scaffold (package.json manifest, tsconfig, esbuild config), JSON schema, TypeScript model/parser, tree view provider, sample configurations. Diagram and AI chat webview apps are deferred.
- **Dependencies (Phase 1)**: `jsonc-parser`
- **Dependencies (Deferred)**: `@xyflow/react` (React Flow), `dagre` (graph layout), `openai`/`@anthropic-ai/sdk` (AI providers), `@vscode/webview-ui-toolkit`
- **APIs**: VS Code Extension API (TreeDataProvider, WorkspaceEdit, commands, menus). Webview API deferred to diagram/AI changes.
- **Distribution**: VS Code Marketplace + Open VSX Registry (open-source, MIT license)
