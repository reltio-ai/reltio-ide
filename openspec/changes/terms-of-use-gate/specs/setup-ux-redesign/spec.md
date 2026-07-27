## ADDED Requirements

### Requirement: Setup Wizard is gated behind Terms of Use acceptance at launch
`launchSetupWizard` SHALL check Terms of Use acceptance once at the very start of the wizard, before its first step runs — not later, inside whichever step handles authentication.

#### Scenario: Wizard launch is gated
- **WHEN** the user launches the Setup Wizard
- **AND** has not yet accepted the current Terms of Use version
- **THEN** the Terms of Use modal is shown before the first wizard step (host entry) is presented
- **AND** declining closes the wizard immediately, before any step has run

#### Scenario: Accepting lets the wizard proceed normally
- **WHEN** the user accepts the Terms of Use at wizard launch
- **THEN** the wizard proceeds through its steps exactly as it would have before this gate existed
