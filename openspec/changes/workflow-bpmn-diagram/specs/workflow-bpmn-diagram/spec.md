## ADDED Requirements

### Requirement: BPMN process definitions authored in the IDE are viewable
The extension SHALL emit diagram interchange for every BPMN it authors, and SHALL provide a read-only diagram preview for drafts, deployed definitions and open BPMN files.

#### Scenario: A new draft can be seen in any BPMN tool
- **WHEN** a draft is created from the skeleton
- **THEN** the document SHALL declare the diagram namespaces alongside the model and Activiti ones
- **AND** SHALL contain a diagram section positioning every flow element it defines
- **AND** the diagram plane SHALL reference the process by its id
- **AND** shapes SHALL use the standard BPMN sizes for events, gateways and tasks

#### Scenario: A duplicated definition keeps a working diagram
- **WHEN** a deployed definition is duplicated and its process id is rewritten
- **THEN** the diagram plane's element reference SHALL be rewritten to the new id
- **AND** shape references naming flow elements SHALL be left unchanged
- **AND** if the source carried no diagram section, one SHALL be generated for the copy

#### Scenario: A definition fetched from a tenant is not re-arranged
- **WHEN** the preview is opened on a document whose diagram section positions every element
- **THEN** the extension SHALL render those positions
- **AND** SHALL NOT compute its own layout
- **AND** SHALL NOT modify the document

#### Scenario: A definition without positions is still drawn
- **WHEN** the preview is opened on a document with no diagram section
- **THEN** the extension SHALL compute a layout and render it
- **AND** the process SHALL read left to right
- **AND** no two shapes SHALL overlap

#### Scenario: Partial diagram information is not mixed with computed positions
- **WHEN** a document's diagram section positions some but not all of its flow elements
- **THEN** the extension SHALL compute a layout for the whole diagram
- **AND** SHALL NOT render the authored positions for some elements and computed positions for the rest

#### Scenario: The diagram shows what makes the workflow Reltio's
- **WHEN** a user task declares candidate groups, or a service task declares a delegate class
- **THEN** that value SHALL be rendered with the task
- **AND** a fully-qualified class name SHALL be shortened for display, with the full value available on hover

#### Scenario: Clicking a shape locates it in the XML
- **WHEN** the user clicks a shape in the preview
- **THEN** the extension SHALL move the editor's cursor to that element
- **AND** SHALL clamp a position that is no longer within the document rather than failing

#### Scenario: The preview follows the document
- **WHEN** the underlying BPMN is edited
- **THEN** the preview SHALL re-render without the user reopening it

#### Scenario: The preview is read-only
- **WHEN** the preview is open
- **THEN** it SHALL NOT offer any means of moving, adding or deleting elements
- **AND** the only action it SHALL send to the extension is a request to reveal an element

#### Scenario: An undrawable document degrades rather than fails
- **WHEN** the preview is opened on a document with no process element, no flow elements, or malformed markup
- **THEN** the extension SHALL show an explanatory empty state
- **AND** SHALL NOT raise an error notification
- **AND** generating a diagram for such a document SHALL leave it unchanged rather than writing an empty plane

#### Scenario: A flow referencing a missing element does not break the diagram
- **WHEN** a sequence flow names a source or target that is not defined in the document
- **THEN** the extension SHALL render the remaining elements and connectors
- **AND** SHALL omit that connector rather than failing to draw anything

#### Scenario: The preview handles document content safely
- **WHEN** the preview renders element names, ids and conditions taken from the document
- **THEN** it SHALL insert them as text and never as markup
- **AND** SHALL check the origin of every incoming message before acting on it
- **AND** its scripts SHALL be restricted by a deny-by-default content security policy with a per-panel nonce
- **AND** the webview SHALL be able to load resources only from the extension's own build output

#### Scenario: Reading a BPMN does not introduce an XML parser
- **WHEN** the extension reads structure out of BPMN content
- **THEN** it SHALL do so without a general-purpose XML parser
- **AND** SHALL NOT resolve external entities

#### Scenario: Commented-out and diagram markup are not read as process content
- **WHEN** a document contains commented-out flow elements, or a diagram section referencing every element
- **THEN** neither SHALL contribute elements to the extracted process
- **AND** the positions reported for real elements SHALL still index the original document text

#### Scenario: A default flow does not inherit a neighbour's condition
- **WHEN** a conditionless sequence flow is declared adjacent to one carrying a condition
- **THEN** the conditionless flow SHALL be read as having no condition
