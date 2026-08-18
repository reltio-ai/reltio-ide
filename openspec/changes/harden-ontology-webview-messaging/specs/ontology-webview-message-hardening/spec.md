## ADDED Requirements

### Requirement: Ontology webview validates message origin before acting on it
The ontology preview webview SHALL verify that an incoming `message` event's origin matches the webview's own origin before reading or acting on `event.data`.

#### Scenario: Message from the expected origin is processed
- **WHEN** a `message` event arrives whose `origin` equals the webview's own origin (as observed via `window.origin` at webview bootstrap)
- **THEN** the message SHALL be processed normally (e.g. `setGraph`, `setPositions`)

#### Scenario: Message from an unexpected origin is ignored
- **WHEN** a `message` event arrives whose `origin` does not match the webview's own origin
- **THEN** the handler SHALL return without reading `event.data` or updating any webview state

### Requirement: Data reaching the inspector popup's HTML is escaped
Every string field from the graph model that is interpolated into HTML passed to the inspector popup (`createInspector`'s `bodyHtml`) SHALL be HTML-escaped first.

#### Scenario: Hostile entity/attribute/relation names render as text, not markup
- **WHEN** a `.reltio.json` entity type, attribute, or relation type name contains HTML metacharacters (e.g. `<`, `>`, `"`, `'`) or looks like a tag or event-handler attribute (e.g. `<img src=x onerror=...>`)
- **THEN** the inspector popup's rendered HTML SHALL contain only the escaped form of that text
- **AND** no unescaped `<`, `>`, `"`, or `'` from that field SHALL appear in the HTML passed to `innerHTML`

#### Scenario: Numeric fields are not required to be escaped
- **WHEN** a numeric field (e.g. an attribute or match-group count) is interpolated into inspector HTML
- **THEN** it MAY be interpolated without an escaping call, since a JavaScript `number`'s string form cannot contain HTML metacharacters

### Requirement: Dynamic object keys derived from graph data cannot alter an object's prototype
Any place that uses a graph-derived string (e.g. a node ID) as a dynamic object key for a write SHALL use a key-safe target object, so a value equal to `__proto__`, `constructor`, or `prototype` is stored as an ordinary entry.

#### Scenario: A node ID equal to a magic property name does not corrupt the target object
- **WHEN** a node's ID (derived from an entity/relation type URI in the user's `.reltio.json`) is used as a dynamic key to store a value (e.g. `positions[node.id] = { x, y }`)
- **AND** that ID is `__proto__`, `constructor`, or `prototype`
- **THEN** the target object's own prototype SHALL remain unchanged
- **AND** the value SHALL be retrievable via that same key as an ordinary entry
