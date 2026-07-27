## ADDED Requirements

### Requirement: Baseline capture on fetch

The system SHALL persist a **baseline copy** of the remote configuration whenever a successful **Fetch L3** (download tenant configuration) completes, representing the remote tenant configuration at that moment for later **staleness checks**. The baseline SHALL be updated to match the same effective configuration content written to **`L3.reltio.json`** for that fetch.

#### Scenario: Fetch L3 establishes baseline

- **WHEN** the user successfully fetches L3 configuration for a tenant into **`L3.reltio.json`**
- **THEN** the system SHALL write or replace a dedicated baseline artifact on disk associated with that tenant so it can be compared later to a fresh **GET** response

### Requirement: Apply command availability

The system SHALL expose a **apply configuration to tenant** command for a tenant that has **`L3.reltio.json`**, a stored baseline as defined above, and a valid in-memory token for the environment.

#### Scenario: Missing baseline blocks apply

- **WHEN** the user invokes apply configuration but no baseline exists for that tenant
- **THEN** the system SHALL refuse the operation with a clear message instructing the user to **Fetch L3** first (or otherwise establish a baseline)

### Requirement: Pre-flight GET and drift detection

Before modifying the remote tenant, the system SHALL **GET** the current configuration from **`GET …/reltio/api/{tenantId}/configuration`** using the same **Bearer** authorization model as the existing fetch-L3 command. The system SHALL compare the retrieved configuration to the **baseline** using **parsed JSON structural equality** (not merely raw string equality of files).

#### Scenario: Remote matches baseline

- **WHEN** the GET result is structurally equal to the baseline
- **THEN** the system SHALL treat the tenant remote as **unchanged since baseline** and proceed to the confirmation flow that offers **Yes**, **Cancel**, and **View changes**

#### Scenario: Remote differs from baseline

- **WHEN** the GET result is not structurally equal to the baseline
- **THEN** the system SHALL treat the tenant remote as **changed since baseline** and require **review** by offering **Review changes** and **Skip** (abort)

### Requirement: Comparison view

The system SHALL provide **View changes** / **Review changes** such that the user can open a **comparison view** between **remote configuration** (from the pre-flight GET) and the **user’s configuration** (saved local tenant **`L3.reltio.json`** content intended for upload).

#### Scenario: View changes opens diff

- **WHEN** the user chooses **View changes** or **Review changes**
- **THEN** the system SHALL open a VS Code diff comparing remote versus local configuration text (pretty-printed consistently enough to be reviewable)

### Requirement: Confirmation paths

When remote matches baseline, after any optional diff review, the system SHALL only continue to **PUT** when the user explicitly confirms **Yes** (and SHALL cancel on **Cancel**).

When remote differs from baseline, the system SHALL not **PUT** unless the user completes the mandatory review path (**Review changes**) and explicitly confirms that they still want to proceed; **Skip** SHALL abort with no **PUT**.

#### Scenario: Cancel aborts

- **WHEN** the user chooses **Cancel** or **Skip** as defined in the flow
- **THEN** the system SHALL not send **PUT** to the tenant

### Requirement: Configuration upload via PUT

The system SHALL upload configuration using **`PUT https://<environment>/reltio/api/<tenantId>/configuration`** with **`Authorization: Bearer`** consistent with **`GET`** configuration, sending the **local** tenant configuration JSON as the request body after required saves and user confirmation per the flows above.

#### Scenario: Successful apply

- **WHEN** the user confirms apply after all gates pass and the PUT returns success
- **THEN** the system SHALL notify success and SHALL refresh the baseline to match the newly applied remote state (via the same mechanism as a successful fetch baseline update) so subsequent applies use a consistent reference

#### Scenario: Unauthorized on PUT

- **WHEN** the PUT returns **401**
- **THEN** the system SHALL clear or invalidate the environment token using the same behavior as other API commands that receive **401**
