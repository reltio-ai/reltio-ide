## Why

Reltio tenant metadata configurations are large JSON files (often 1000+ lines) whose structure is defined by an official XSD schema (`RBMschema-for-json.xsd`) containing ~80 complex types across 17 top-level sections. Today there is no validation, no autocomplete, and no hover documentation when editing these files — every typo or structural error is discovered only at deploy time.

A TypeScript code model mirroring the full XSD structure provides two things at once: (a) a central abstraction that all future extension features (tree view, diagram, AI) can consume, and (b) the foundation for a JSON Schema that gives VS Code's built-in JSON Language Server real-time validation, autocomplete, and hover docs with zero custom language server code.

## What Changes

- Add `src/model/types.ts` — ~50 TypeScript interfaces and ~9 union/enum types modeling the complete Reltio Business Model (all 17 top-level sections, recursive attribute nesting, match rule composition, survivorship mapping chains, cleanse pipelines, and every XSD-defined property)
- Add `schemas/reltio-metadata.schema.json` — a JSON Schema (Draft-07) that mirrors the code model, with `$defs` for every interface, `required` arrays, `enum` constraints, and `description` fields for hover docs
- Add project scaffold (`package.json` with extension manifest, `tsconfig.json`, `src/extension.ts` with empty activate/deactivate)
- Register the schema via `contributes.jsonValidation` for `*.reltio.json` files

## Capabilities

### New Capabilities
- `json-schema-validation`: JSON Schema providing real-time validation, autocomplete, and hover documentation for the complete Reltio metadata structure — all 17 top-level sections, ~80 complex types, and ~9 enum types as defined by the official XSD

### Modified Capabilities

## Impact

- **New files**: `src/model/types.ts`, `schemas/reltio-metadata.schema.json`, `package.json`, `tsconfig.json`, `src/extension.ts`, `samples/example.reltio.json`
- **Dependencies**: `jsonc-parser` (runtime), `typescript`, `@types/vscode`, `@types/node`, `esbuild` (dev)
- **APIs**: VS Code built-in JSON Language Server (via `contributes.jsonValidation`)
- **Reference material**: `examples/RBMschema-for-json.xsd` (XSD specification used to inform the model design, not a build input)
