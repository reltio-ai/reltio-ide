## Context

Reltio metadata configurations are single large JSON files defining a tenant's entire data model. The official structure is specified by `RBMschema-for-json.xsd` — a 1337-line XML Schema with ~80 complex types, 17 top-level sections, recursive attribute nesting, and complex match/survivorship/cleanse rule systems.

The workspace is currently empty (no source code). We are building a VS Code/Cursor extension from scratch. This change establishes the foundational code model and JSON Schema that all subsequent features (tree view, diagram, AI assistant) will build on.

## Goals / Non-Goals

**Goals:**
- Define TypeScript interfaces covering the complete Reltio Business Model as specified by the XSD
- Create a JSON Schema that provides real-time validation, autocomplete, and hover docs via VS Code's built-in JSON Language Server
- Establish a project scaffold sufficient to build and test the extension
- Design the code model for future editability — all extension components will eventually observe and mutate this model

**Non-Goals:**
- Automated XSD-to-schema conversion (we design the model manually, informed by the XSD)
- Tree view, diagram, or AI features (those are separate changes)
- Custom language server (VS Code's built-in JSON Language Server is sufficient)
- Runtime schema generation from custom XSD files

## Decisions

### D1: Code model as central abstraction
**Decision**: Define TypeScript interfaces in `src/model/types.ts` that mirror every XSD complex type. All extension features (tree view, diagram, AI, editing) will consume these same interfaces.
**Rationale**: A single shared model prevents divergence between components. When the tree shows an entity type's attributes, it reads the same `Attribute` interface the diagram uses to render nodes. Future editability (add/delete/rename operations) will mutate instances of these interfaces, and all observers will update.
**Alternative considered**: No shared model — each feature parses JSON independently. Rejected because it leads to duplicated logic and inconsistent behavior.

### D2: XSD as specification, not build input
**Decision**: The XSD (`examples/RBMschema-for-json.xsd`) is reference material. We hand-craft both the TypeScript interfaces and JSON Schema by reading the XSD, making deliberate design choices about naming, grouping, and documentation.
**Rationale**: Mechanical XSD-to-JSON-Schema translation produces a schema that inherits XSD idioms (like `mixed="true"`, `xs:choice`, attribute/element distinction) that don't map cleanly to JSON. Hand-crafting lets us produce idiomatic TypeScript (PascalCase interfaces, camelCase properties) and a clean JSON Schema with helpful descriptions.
**Alternative considered**: Automated converter script. Rejected because it adds build complexity and produces less readable output.

### D3: JSON Schema mirrors the code model
**Decision**: Every TypeScript interface has a corresponding `$defs` entry in the JSON Schema. Property names, types, required fields, and enums are kept in sync manually.
**Rationale**: When a developer reads the TypeScript interface for `MatchGroup`, the JSON Schema definition for `MatchGroup` has the same properties. This makes maintenance straightforward — changes to the model are reflected in the schema and vice versa.
**Risk**: Manual sync may drift. Mitigation: the spec includes test scenarios that validate both the TS model and JSON Schema against the same sample files.

### D4: File convention `*.reltio.json` for activation
**Decision**: Use file extension pattern `*.reltio.json` for schema association and extension activation.
**Rationale**: Simple, explicit, no false positives. The `contributes.jsonValidation` fileMatch and the extension's activation event both key off this pattern.

### D5: `jsonc-parser` for position-aware parsing
**Decision**: Use Microsoft's `jsonc-parser` library as the JSON parser.
**Rationale**: It provides AST nodes with offset/length positions (essential for click-to-reveal and surgical editing in future changes), handles comments, and is the same parser VS Code uses internally. A single `parseConfig()` function will produce both a typed `ReltioBusinessModel` object and the AST root.

### D6: `additionalProperties: false` on all definitions
**Decision**: Set `additionalProperties: false` on every object definition in the JSON Schema.
**Rationale**: Catches typos and undocumented properties immediately. Users who need to bypass validation can remove the `$schema` reference or use VS Code's `json.schemas` setting to override.

## Risks / Trade-offs

- **[Schema completeness]** The XSD may not cover every property that Reltio accepts in practice (undocumented extensions, version-specific additions). → Mitigation: `additionalProperties: false` surfaces unknowns immediately. The schema can be relaxed on specific types if the community reports false positives.

- **[Model-schema sync]** TypeScript interfaces and JSON Schema are maintained separately, so they could drift. → Mitigation: Sample `.reltio.json` files serve as integration tests — they must parse into the TS model without errors and validate against the JSON Schema without warnings.

- **[XSD interpretation]** Some XSD constructs (`mixed="true"`, `xs:choice` inside `xs:sequence`) don't have a 1:1 JSON Schema equivalent. → Mitigation: We interpret these pragmatically — `mixed="true"` is ignored (JSON has no mixed content), `xs:choice` becomes optional properties (any combination allowed).
