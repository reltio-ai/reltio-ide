## MODIFIED Requirements

### Requirement: REST validation and tenant listing
The extension SHALL call `GET https://{host}/reltio/status` without authentication to validate reachability before creating an environment directory, and `GET https://{host}/reltio/enhancedTenants?showAll=true` with a Bearer token to populate the tenant picker. The extension SHALL NOT call `GET https://{host}/reltio/tenants`.

#### Scenario: Validation without token
- **WHEN** the user adds an environment and the status endpoint returns HTTP 200
- **THEN** the environment directory SHALL be created without requiring a token

#### Scenario: Tenant list requires token
- **WHEN** the user invokes add tenant without a stored token for that environment
- **THEN** the extension SHALL refuse the operation and prompt for a token first

#### Scenario: Tenant listing uses the enhanced tenants endpoint
- **WHEN** the extension needs the list of tenants for an environment, whether from the setup wizard, the Add Tenant command, or the post-login auto-add check
- **THEN** it SHALL issue a `GET` request to `https://{host}/reltio/enhancedTenants` with the query parameter `showAll=true` and an `Authorization: Bearer` header
- **AND** it SHALL NOT send the `xxx-client` header on that request
- **AND** it SHALL NOT issue any request to `https://{host}/reltio/tenants`

#### Scenario: Tenant records reduced to tenant IDs
- **WHEN** the endpoint returns HTTP 200 with a JSON array of objects, each carrying `tenantId`, `tenantName`, and `customerName`
- **THEN** the extension SHALL use the `tenantId` value of each record, preserving the order in which records were returned
- **AND** it SHALL ignore `tenantName` and `customerName`
- **AND** the tenant picker SHALL display the tenant ID alone

#### Scenario: Malformed tenant listing response
- **WHEN** the response body is not a JSON array, or any element is not an object carrying a non-empty string `tenantId`
- **THEN** the extension SHALL raise an error identifying the tenant listing call as the failure
- **AND** it SHALL NOT present a partial or placeholder tenant list to the user

#### Scenario: Unauthorized tenant listing
- **WHEN** the endpoint returns HTTP 401
- **THEN** the extension SHALL surface it as an unauthorized condition carrying status code 401, so the existing re-authentication path is triggered

#### Scenario: Other tenant listing failures
- **WHEN** the endpoint returns any other non-2xx status
- **THEN** the extension SHALL raise an error that reports that status to the user
