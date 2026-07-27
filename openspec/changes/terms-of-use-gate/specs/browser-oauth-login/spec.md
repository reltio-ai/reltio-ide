## ADDED Requirements

### Requirement: Login commands are gated behind Terms of Use acceptance
`reltio.provideToken` and `reltio.loginWithBrowser` SHALL check Terms of Use acceptance before doing any credential, token, or network work, and SHALL NOT proceed if the user declines or dismisses the prompt.

#### Scenario: Provide Token is gated
- **WHEN** the user right-clicks an environment node and selects **Provide Token**
- **AND** has not yet accepted the current Terms of Use version
- **THEN** the Terms of Use modal is shown before the Bearer token input box
- **AND** declining prevents the input box from appearing and no token is stored

#### Scenario: Login with Browser is gated
- **WHEN** the user selects **Login with Browser**
- **AND** has not yet accepted the current Terms of Use version
- **THEN** the Terms of Use modal is shown before any OAuth credential resolution or browser navigation
- **AND** declining prevents the browser from opening and no session is stored
