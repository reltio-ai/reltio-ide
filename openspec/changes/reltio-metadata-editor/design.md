## Context

Reltio metadata configurations are single large JSON files (often 1000+ lines) that define a tenant's entire data model: entity types, attributes, relationships, match/survivorship/cleanse rules, and source systems. The current editing experience is raw JSON in a text editor with no domain-specific tooling.

The workspace is currently empty (no source code). We are building a VS Code/Cursor extension from scratch. The target audience is the open-source Reltio community — developers and data architects who configure Reltio tenants.

VS Code provides the extension infrastructure: the Extension API for tree views, webview panels, commands, menus, JSON validation, and the editor itself. Cursor (built on VS Code) supports the same extension API.

## Goals / Non-Goals

**Goals:**
- Deliver a single VS Code extension that provides JSON schema validation, tree-based navigation, an entity-relationship diagram, and an AI assistant for Reltio metadata files
- Activate seamlessly for `*.reltio.json` files with zero configuration
- Provide immediate value through schema validation and autocomplete before any extension code runs (via `$schema` reference)
- Support all Reltio metadata constructs: entity types, relation types, 24+ attribute types (simple, nested, reference), match groups, survivorship groups, cleanse groups, sources
- Keep the extension open-source (MIT) and publishable to VS Code Marketplace and Open VSX

**Non-Goals:**
- Reltio API integration (no direct tenant upload/download — that's a later phase)
- Custom language server (VS Code's built-in JSON language server with our schema is sufficient)
- Forking VS Code or Cursor
- Multi-file configuration support (each `.reltio.json` is treated independently)
- Authentication or tenant management

## Decisions

### D1: Single extension, not an extension pack
**Decision**: Ship one extension with all features (schema, tree, diagram, AI) rather than separate extensions.
**Rationale**: Shared parser/model code, single activation lifecycle, simpler installation. An extension pack adds packaging overhead for no benefit since all features share the same `jsonc-parser` infrastructure.
**Alternative considered**: Extension pack with separate extensions per feature — rejected due to code duplication and coordination complexity.

### D2: esbuild bundler with ESM-first resolution
**Decision**: Use esbuild with `mainFields: ["module", "main"]` to bundle the extension.
**Rationale**: esbuild is the VS Code-recommended bundler (replacing webpack). The `mainFields` setting resolves a known issue where `jsonc-parser`'s UMD entry uses dynamic `require` calls that break when bundled as CJS.
**Alternative considered**: webpack — slower build times, more configuration, no advantages for this project.

### D3: `jsonc-parser` for position-aware JSON parsing
**Decision**: Use Microsoft's `jsonc-parser` library for all JSON parsing needs.
**Rationale**: It provides AST nodes with offset/length positions (essential for click-to-reveal and editing), handles comments, and is the same parser VS Code uses internally. Single dependency for parse, findNodeAtLocation, getLocation.
**Alternative considered**: Native `JSON.parse` + custom position tracking — fragile and reimplements solved problems.

### D4: React Flow for the entity-relationship diagram
**Decision**: Use `@xyflow/react` (React Flow) inside a webview panel for the diagram.
**Rationale**: 4.8M weekly npm downloads, built-in drag/zoom/pan/minimap, custom node/edge components, widely used in VS Code extensions (CodeVisualizer, etc.). Auto-layout via dagre.
**Alternative considered**: D3.js — lower-level, more code to write for the same result. Mermaid — not interactive enough (no drag, no bidirectional editing). Excalidraw — overkill for structured ER diagrams.

### D5: Pluggable LLM backend via adapter interface
**Decision**: Define an `LlmClient` interface (`sendMessage → AsyncIterable<string>`) with implementations for OpenAI, Anthropic, and Ollama.
**Rationale**: Users have different LLM preferences. OpenAI-compatible APIs cover many providers. Ollama enables fully local/offline usage. API keys stored in VS Code settings.
**Alternative considered**: Hard-code a single provider — limits adoption. Use VS Code's built-in chat API — not yet stable and would couple to Copilot.

### D6: File convention `*.reltio.json` for activation
**Decision**: Use file extension pattern `*.reltio.json` rather than content-sniffing.
**Rationale**: Simple, explicit, no false positives. Users rename their config file once. The `contributes.jsonValidation` fileMatch and the extension's `onLanguage` activation both key off this pattern.
**Alternative considered**: Content-based detection (look for `entityTypes` key) — too many false positives with other JSON files.

### D7: Tree editing via WorkspaceEdit
**Decision**: All tree context menu actions (add, delete, rename) apply changes through `vscode.WorkspaceEdit`, not by rewriting the file.
**Rationale**: Integrates with VS Code's undo/redo stack, works with auto-save, and preserves the user's formatter settings. The parser's `findNodeAtLocation` provides exact offsets for surgical edits.
**Alternative considered**: Rewrite the entire JSON file after modifying the in-memory model — loses undo history and formatting.

## Risks / Trade-offs

- **[Schema completeness]** The Reltio metadata schema is not fully publicly documented. Some constructs may have undocumented properties. → Mitigation: Set `additionalProperties: false` on well-known types but accept that the schema will need community-driven iteration. Users can always remove the `$schema` reference to bypass validation.

- **[Webview performance]** Large configurations (100+ entity types) may cause slow rendering in the React Flow diagram. → Mitigation: Lazy rendering, virtualization, and only rendering visible nodes. Diagram view is opt-in (opened via command).

- **[Cursor compatibility]** Cursor is based on VS Code but may have subtle differences in extension host behavior (e.g., F5 debugging). → Mitigation: Test in both VS Code and Cursor. The extension uses only stable VS Code APIs (no proposed APIs).

- **[LLM cost/latency]** AI assistant requires API keys and incurs usage costs. → Mitigation: AI is fully optional. Ollama support enables free local inference. System prompts are kept compact.

- **[Bidirectional diagram sync]** Keeping the diagram in sync with JSON edits (both directions) is complex. → Mitigation: Phase the implementation — start with JSON→diagram (read-only diagram), add diagram→JSON editing later.
