## ADDED Requirements

### Requirement: Webview CSP nonce is cryptographically random

Every webview panel that sets a Content-Security-Policy nonce SHALL derive that nonce from a cryptographically secure pseudo-random number generator, not from `Math.random()`.

#### Scenario: Ontology preview panel nonce

- **WHEN** the Ontology preview webview is created and its HTML (including CSP header) is generated
- **THEN** the nonce value SHALL come from `crypto.randomBytes(16).toString('hex')`

#### Scenario: Entity detail panel nonce

- **WHEN** the Entity Detail webview's HTML (including CSP header) is generated
- **THEN** the nonce value SHALL come from `crypto.randomBytes(16).toString('hex')`

#### Scenario: No source file uses Math.random for nonce generation

- **WHEN** either panel's source file is inspected
- **THEN** it SHALL NOT contain a call to `Math.random()`
