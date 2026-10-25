## ADDED Requirements

### Requirement: Resolving a tenant's Workflow Adapter URL from bundled knowledge
The extension SHALL consult a bundled environment-to-adapter mapping before probing for an Adapter URL or asking the user for one, and SHALL NOT let a bundled host bypass the outbound host allowlist.

#### Scenario: A documented environment is not asked about
- **WHEN** a tenant's Workflows folder is opened and no Adapter URL is saved for it
- **AND** the environment appears in the bundled mapping with a single host
- **THEN** the extension SHALL use that host without prompting the user
- **AND** SHALL NOT make a probe request to confirm it
- **AND** SHALL NOT require a token to be present for the environment
- **AND** SHALL persist the resolved URL to the tenant's sidecar so the lookup happens once

#### Scenario: A shared adapter is resolved despite sharing no name with the environment
- **WHEN** the environment is one of several served by a single shared adapter
- **THEN** the extension SHALL resolve it to that shared adapter's host
- **AND** SHALL NOT resolve it to the `{environment}-workflow` host the naming convention would produce

#### Scenario: An adapter that breaks the naming convention is still resolved
- **WHEN** the environment's adapter uses the `-workflow-adapter` suffix, or a domain other than `reltio.com`
- **THEN** the extension SHALL resolve it to the documented host

#### Scenario: An environment name is recognised however it is spelled
- **WHEN** the environment is named with a scheme, in mixed case, with a trailing path, or as a bare label
- **THEN** all spellings SHALL resolve to the same adapter host
- **AND** a `.cloud.reltio.com` host SHALL reduce to the same label as the bare environment name
- **AND** an alternate spelling documented in the source table SHALL resolve to the same host as its canonical name

#### Scenario: An environment the source documents two ways is asked about, not guessed
- **WHEN** the environment maps to more than one documented adapter
- **THEN** the extension SHALL present both candidates for the user to choose
- **AND** SHALL NOT select one on the user's behalf
- **AND** if the user dismisses the choice, SHALL fall back to asking for the URL
- **AND** SHALL NOT fall back to the naming-convention probe, whose result would be a confirmed but arbitrary choice between them

#### Scenario: Bundling a host grants it no trust
- **WHEN** a bundled host is on a domain outside the configured `reltio.trustedHostSuffixes` allowlist
- **THEN** the extension SHALL refuse it with the allowlist error, exactly as it would a hand-typed URL
- **AND** SHALL NOT attach a bearer token to any request to it
- **AND** SHALL open the manual prompt pre-filled with that host, so the error and the value it refers to are shown together
- **AND** SHALL accept the same host once an operator extends the allowlist

#### Scenario: An unknown environment keeps the previous behaviour
- **WHEN** the environment does not appear in the bundled mapping
- **THEN** the extension SHALL attempt the naming-convention probe
- **AND** SHALL prompt the user if that does not resolve

#### Scenario: A saved URL still wins
- **WHEN** an Adapter URL is already saved for the tenant
- **THEN** the extension SHALL use it
- **AND** SHALL NOT consult the bundled mapping

#### Scenario: An environment name cannot reach an inherited object member
- **WHEN** an environment is named after a JavaScript object property such as `constructor` or `__proto__`
- **THEN** the lookup SHALL report no match
- **AND** SHALL NOT return an inherited member as though it were a configured host

#### Scenario: The mapping is internally consistent
- **WHEN** the bundled mapping is loaded
- **THEN** no environment SHALL resolve to two different hosts
- **AND** no environment SHALL be both unambiguously mapped and listed as ambiguous
- **AND** every bundled host SHALL be a bare lowercase hostname carrying no scheme and no path
