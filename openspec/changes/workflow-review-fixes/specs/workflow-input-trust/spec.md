## ADDED Requirements

### Requirement: Clone URLs are validated and never carry credentials
The extension SHALL accept a clone URL only if it is an https, http, ssh or scp-style URL with no userinfo password, does not start with `-`, and is passed to git after `--`. A URL that violates this SHALL be rejected before git is run, with a message that names SSH and the user's Git credential manager as the alternatives.

#### Scenario: Credentials in an https URL
- **WHEN** the user supplies `https://user:token@bitbucket.org/acme/wf.git`
- **THEN** the clone is rejected before git is invoked
- **AND** the message does not contain the token

#### Scenario: Option-looking URL
- **WHEN** the URL is `-ofoo@host:path` or begins with `-`
- **THEN** it is rejected, and git is never given it as an option

#### Scenario: Branch names with regex characters
- **WHEN** a branch such as `feat(x` is requested and git reports it missing
- **THEN** the user sees the real git error and a branch-not-found result, not a SyntaxError

### Requirement: URLs are redacted wherever they are shown
Every URL placed in a message, tooltip, log line or error SHALL pass through a single redaction that removes userinfo.

#### Scenario: Git failure message
- **WHEN** git fails on a URL that (through an older sidecar) contained credentials
- **THEN** the displayed error contains the host and path but not the credentials

### Requirement: The committed sidecar is validated on read
`WorkflowRepo.reltio.json` SHALL be treated as untrusted. `relativePath` MUST be a relative path without `..` segments, an absolute prefix, or control characters (including newlines). `repoUrl` MUST satisfy the clone-URL rules. An invalid sidecar SHALL be reported once and ignored.

#### Scenario: Newline injection into .gitignore
- **WHEN** `relativePath` contains a newline followed by a negation line
- **THEN** the sidecar is rejected and nothing is written to `.gitignore`

#### Scenario: Traversal
- **WHEN** `relativePath` is `../../etc` or an absolute path
- **THEN** the sidecar is rejected

### Requirement: External links open only over https
`vscode.env.openExternal` SHALL be called only with an `https` URL derived from a validated `repoUrl`. For ssh or scp-style remotes the extension SHALL copy the remote to the clipboard and say so instead of opening it.

#### Scenario: command: scheme in repoUrl
- **WHEN** `repoUrl` is `command:workbench.action.openSettings`
- **THEN** it is rejected by validation and never opened

### Requirement: Network calls do not follow redirects and bound their bodies
Adapter and API calls SHALL use `redirect: "error"`, SHALL return only the parsed origin from `toHttpsBase()` (rejecting userinfo, path and query), and SHALL read response bodies under the same timeout as the headers and with a size cap.

#### Scenario: Redirect to another host
- **WHEN** the adapter answers with a 302 to a host outside the allowlist
- **THEN** the call fails with an error and the body is never sent there

#### Scenario: Stalled body
- **WHEN** headers arrive and the body never completes
- **THEN** the call fails at the timeout rather than hanging the progress notification

#### Scenario: Path in the adapter URL
- **WHEN** the adapter URL is `https://a.reltio.com/x?y=1`
- **THEN** `toHttpsBase()` rejects it

### Requirement: Process ids cannot name Windows device files
A process id SHALL NOT be a Windows reserved device name (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`) in any case, and the process-identity rewrite SHALL change only the `id` and `name` of the first `<process>` element.

#### Scenario: Reserved name
- **WHEN** the user enters `con` as a process id
- **THEN** it is rejected with the id-validation message

#### Scenario: Attribute that merely contains id
- **WHEN** the first `<process>` has `data-id="x"` before `id="y"`
- **THEN** only `id="y"` is rewritten
