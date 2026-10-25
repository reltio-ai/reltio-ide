## ADDED Requirements

### Requirement: Authoring and deploying a BPMN process definition from the IDE
The extension SHALL allow a user to create a BPMN process definition from a skeleton or by duplicating a deployed one, edit it as a file on disk, and deploy it to a tenant's Workflow Adapter, without leaving the IDE and without requiring the Bitbucket repository or a pull request.

#### Scenario: A new draft requires a valid process id before anything is written
- **WHEN** the user runs New Workflow
- **THEN** the extension SHALL prompt for a process id and reject one that is empty, starts with a digit, contains whitespace or path separators, or exceeds 64 characters
- **AND** SHALL NOT write any file until a valid, non-colliding id has been supplied
- **AND** SHALL NOT write a placeholder id for the user to replace later

#### Scenario: A new draft is a deployable skeleton
- **WHEN** a valid process id and display name are supplied
- **THEN** the extension SHALL write a BPMN containing a start event, one user task and an end event, marked `isExecutable="true"`
- **AND** every interpolated value SHALL be XML-escaped
- **AND** the file SHALL open in an editor and be revealed in the tree

#### Scenario: Drafts persist as real files under the tenant
- **WHEN** a draft is created
- **THEN** it SHALL be written to that tenant's directory as `{processId}.bpmn20.xml`
- **AND** it SHALL still be listed after the window is reloaded
- **AND** the on-disk filename SHALL match the filename sent in the upload

#### Scenario: The Drafts folder appears only when drafts exist
- **WHEN** a tenant has no drafts
- **THEN** no Drafts folder SHALL be shown under Workflows
- **AND** when at least one draft exists the folder SHALL appear with its count

#### Scenario: Duplicating defaults to a new identity, not the original
- **WHEN** the user duplicates a deployed process definition
- **THEN** the extension SHALL pre-fill the new process id as the original id suffixed with `Copy`
- **AND** SHALL rewrite the `id` and `name` of only the first `<process>` element in the copied XML
- **AND** SHALL warn before accepting an id that matches a definition marked as a Reltio built-in

#### Scenario: Deploying uploads the saved contents
- **WHEN** the user deploys a draft whose editor has unsaved changes
- **THEN** the extension SHALL save the document before reading it
- **AND** SHALL upload the saved contents rather than stale contents from disk

#### Scenario: Deploy is a multipart upload through the host allowlist
- **WHEN** a deploy is issued
- **THEN** the request SHALL be a POST with a `multipart/form-data` body to the Workflow Adapter's deployments endpoint
- **AND** the adapter URL SHALL pass the same host allowlist check as every other outbound call before any Authorization header is attached
- **AND** the request SHALL carry the `EnvironmentURL` header and SHALL NOT carry the platform routing header

#### Scenario: The deployed list reflects server state after a deploy
- **WHEN** a deploy succeeds
- **THEN** the extension SHALL re-fetch the tenant's process definitions from the Adapter
- **AND** SHALL NOT synthesise the new entry locally

#### Scenario: A draft survives its own deployment
- **WHEN** a deploy succeeds
- **THEN** the draft file SHALL remain on disk unmodified
- **AND** SHALL remain listed under Drafts

#### Scenario: A permissions failure explains itself
- **WHEN** a deploy is refused with HTTP 403
- **THEN** the extension SHALL show a message naming the role required to deploy on that tenant
- **AND** SHALL confirm that the draft is saved and unchanged
- **AND** SHALL NOT offer the Edit Adapter URL action, since the URL is not implicated

#### Scenario: Deploy is never gated on a role the extension cannot know
- **WHEN** the tree renders a draft for any signed-in user
- **THEN** the Deploy action SHALL be enabled regardless of that user's Reltio roles
- **AND** insufficient permission SHALL be surfaced only as a response to an attempted deploy

#### Scenario: Deleting a draft is confirmed
- **WHEN** the user deletes a draft
- **THEN** the extension SHALL require a modal confirmation before removing the file
- **AND** SHALL NOT affect anything already deployed on the tenant

#### Scenario: Deploy is reachable without tree context
- **WHEN** the user triggers Deploy from an editor tab or the command palette rather than the tree
- **THEN** the extension SHALL determine the target environment and tenant from the draft file's own path
- **AND** SHALL NOT deploy to a tenant inferred from the current tree selection
