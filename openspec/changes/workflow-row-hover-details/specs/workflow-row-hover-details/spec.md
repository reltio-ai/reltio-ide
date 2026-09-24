## ADDED Requirements

### Requirement: Workflow rows identify themselves on hover
Hovering a process definition or registered JAR in the Workflows tree SHALL show a formatted summary that leads with the information determining what the user may safely do to it.

#### Scenario: Whether a definition is Reltio's or the customer's leads
- **WHEN** the user hovers a process definition
- **THEN** the first line SHALL state, emphasised, whether it is a built-in or a custom workflow
- **AND** the display name, process id, deploying user and deployment time SHALL follow

#### Scenario: A field the service did not send is omitted
- **WHEN** a definition carries no deploying user or no deployment time
- **THEN** that line SHALL be absent from the hover
- **AND** the hover SHALL NOT render a placeholder such as an invalid date or an undefined value

#### Scenario: An unnamed definition is still identifiable
- **WHEN** a definition has no display name
- **THEN** the hover SHALL show its process id in place of the name

#### Scenario: Customer-authored text cannot reformat the hover
- **WHEN** a display name or description contains Markdown emphasis or link syntax
- **THEN** the hover SHALL render it as literal text

#### Scenario: Escaping does not damage copyable values
- **WHEN** the hover shows an email address or a fully-qualified module path
- **THEN** the value SHALL appear exactly as the service reported it, with no escape characters inserted

#### Scenario: Service-supplied text cannot become a clickable command
- **WHEN** the hover is rendered
- **THEN** it SHALL NOT be marked trusted
- **AND** SHALL NOT render executable command links

#### Scenario: Local state is reported without displacing identity
- **WHEN** a definition has an undeployed local edit, or a local copy matching the tenant
- **THEN** the hover SHALL say so after the identifying fields, not in place of them

#### Scenario: A registered JAR identifies itself the same way
- **WHEN** the user hovers a registered JAR
- **THEN** the first line SHALL identify it as a custom JAR
- **AND** its name, module path, registering user and registration time SHALL follow
- **AND** an absent description SHALL be omitted rather than shown empty
