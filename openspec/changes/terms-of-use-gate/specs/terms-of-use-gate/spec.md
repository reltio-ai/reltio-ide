## ADDED Requirements

### Requirement: User must accept the Terms of Use before logging in
The extension SHALL require the user to accept the Reltio IDE Terms of Use before any login action (`reltio.provideToken`, `reltio.loginWithBrowser`, or the Setup Wizard) proceeds. Acceptance SHALL be requested via a modal dialog showing the terms text with **Accept** and **Decline** options.

#### Scenario: First login attempt with no prior acceptance
- **WHEN** the user has never accepted the Terms of Use (or accepted an older version)
- **AND** invokes **Provide Token**, **Login with Browser**, or the Setup Wizard
- **THEN** a modal dialog shows the Terms of Use text with **Accept** and **Decline** buttons
- **AND** the underlying login action does not proceed until the user responds

#### Scenario: User declines
- **WHEN** the user clicks **Decline**, or dismisses the modal (Escape/close)
- **THEN** the login action does not proceed
- **AND** no error message is shown and no state is persisted — behavior is indistinguishable from dismissing any other prompt in these flows

#### Scenario: User accepts
- **WHEN** the user clicks **Accept**
- **THEN** the accepted version and an acceptance timestamp are persisted, and the underlying login action proceeds immediately afterward in the same invocation

### Requirement: Acceptance is asked once per accepted version, not on every login
Once the user has accepted the current Terms of Use version, subsequent login attempts SHALL NOT re-show the modal, until the version changes.

#### Scenario: Repeat login after acceptance
- **WHEN** the user previously accepted the current Terms of Use version
- **AND** invokes any gated login action again
- **THEN** no modal is shown and the login action proceeds directly

#### Scenario: Terms version bump forces re-acceptance
- **WHEN** the bundled Terms of Use version differs from the version the user previously accepted
- **AND** the user invokes a gated login action
- **THEN** the modal is shown again, identically to a first-time acceptance
- **AND** accepting persists the new version

### Requirement: Everything except login remains usable without accepting
The Terms of Use gate SHALL only block login actions. It SHALL NOT affect the tree view, offline `*.reltio.json` editing, ontology preview, or any other feature that doesn't require a live tenant connection.

#### Scenario: Non-login features work without acceptance
- **WHEN** the user has never accepted the Terms of Use
- **THEN** they can still open and edit `*.reltio.json` files, browse the tree view for already-fetched configuration, and use the ontology preview
- **AND** none of these actions trigger the Terms of Use modal

### Requirement: A read failure for the bundled terms text fails closed
If the bundled Terms of Use text cannot be read, the gate SHALL block login with an error message rather than silently allowing it to proceed.

#### Scenario: Terms text file missing or unreadable
- **WHEN** `resources/legal/termsOfUse.txt` cannot be read (e.g. a packaging regression)
- **AND** the user invokes a gated login action
- **THEN** an error message is shown stating the terms could not be loaded and login cannot proceed
- **AND** no acceptance state is written and the login action does not proceed

### Requirement: Acceptance can be reset for support/testing, and reset revokes active sessions
The extension SHALL provide a `reltio.resetTermsAcceptance` command that clears the stored acceptance, so the next login attempt shows the terms again. Because a live, already-authenticated session would otherwise keep working regardless of terms state, the reset SHALL also revoke all active sessions and stored refresh tokens.

#### Scenario: Resetting acceptance
- **WHEN** the user runs **Reltio: Reset Terms Acceptance** (or the command is otherwise invoked)
- **THEN** the stored acceptance version and timestamp are cleared
- **AND** the next gated login action shows the Terms of Use modal again, as if never accepted

#### Scenario: Resetting acceptance revokes active sessions
- **WHEN** the user runs **Reltio: Reset Terms Acceptance** while one or more environments have an active session or a stored refresh token
- **THEN** all in-memory tokens are cleared and every stored refresh token is deleted
- **AND** those environments show as unauthenticated afterward, requiring the user to sign in (and accept the terms) again
