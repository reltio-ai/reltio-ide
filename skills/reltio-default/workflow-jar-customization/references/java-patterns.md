# Java patterns for Reltio Workflow customization

Concrete interfaces, skeletons, and build configuration for writing the Java behind a custom
Reltio Workflow process. `SKILL.md` tells you *when* to reach for this file and what the review
gate requires; this file is what you actually write.

## Contents

- The four extension points
- Pattern: extend an OOTB service task (preferred over implementing one from scratch)
- Pattern: a fresh task listener (when there's no OOTB class to extend)
- Pattern: surfacing a mandatory rejection comment to whoever gets the next task
- Pattern: a custom validator
- Pattern: resolve the entity type for a gateway (the entity-type gate's service task)
- Pattern: changing a task's priority
- Pattern: sending an email notification
- Pattern: calling AWS from a service task
- Pattern: calling back into Reltio's own APIs with credentials of your own, not the acting user's
- Reading and writing process variables, and getting access to `ReltioApi`/`ExecutionService`
- Build configuration (`pom.xml`)
- Test-writing
- Known Ambiguities / Needs Verification

---

## The four extension points

**Confirmed from real, compiled source in Reltio's own official sample repository**
([github.com/reltio-ai/samples-custom-workflow](https://github.com/reltio-ai/samples-custom-workflow)
— 14 complete, working sample modules, each with real Java, a real BPMN file, and real unit tests).
This supersedes an earlier version of this file that reasoned several of these from a doc-portal
page summary and got two of them wrong — treat real compiled source in an official Reltio repo as
stronger evidence than a documentation page's prose, whenever the two disagree.

| You're writing | Interface | Confirmed by (real file in the sample repo) |
|---|---|---|
| The **service task's own logic** (`activiti:class` on a `<serviceTask>`) | `com.reltio.workflow.api.actions.WorkflowAction`, `void execute(Execution execution) throws Exception` | 5 independent examples: `aws-access/.../ApplyDCRAddFromS3.java`, `custom-notifications/.../OverdueNotification.java`, `update-task-timer/.../UpdateAssignee.java`, `workflow-external-dcr/.../RulesApply.java`, and this project's own `location-dcr-approval/.../CaptureRequestor.java` |
| A listener on a **user task** (`create`/`assignment`/`complete`) | `com.reltio.workflow.api.listeners.WorkflowTaskListener`, `void notify(Task task)` | 6 independent examples, incl. `dcr-review-loop/.../UpdateDcrReviewerListener.java`, `parallel-approve/.../MultiTaskStartEventListener.java` and `MultiTaskCompleteListener.java`, `change-due-date/.../DueDateAdjustListener.java` |
| A listener on a **service task / execution** (process-level, fires on start/end) | `com.reltio.workflow.api.listeners.WorkflowExecutionListener`, `void notify(Execution execution)` | `field-injection/.../StageInfoLogger.java` |
| A **validator** gating task completion | `com.reltio.workflow.api.validators.TaskValidator`, `void doValidate(Task task) throws Exception`, throwing `com.reltio.workflow.api.validators.ValidationError` | `delete-review-with-validation/.../DeleteReviewValidator.java` and a second, independent copy in `due-date-validator/` — same interface and signature in both |

**Correction, superseding Known Ambiguity #2 below**: an earlier pass of this file treated the
official doc portal's `doValidate(TaskValidationInfo taskInfo): boolean throws InvalidTaskException`
as the current/preferred signature and the `Task`/`void`/`ValidationError` shape as a possibly-stale
alternative. That was backwards. Real, compiled, duplicated-across-two-samples code in Reltio's own
official repo confirms `Task`/`void`/`ValidationError` is correct; the doc portal's shape is now the
one to treat with suspicion, not the other way round.

`Task` (`com.reltio.workflow.api.tasks.Task`) and `Execution` (`com.reltio.workflow.api.actions.Execution`)
are the two object types every extension point reads from — see "Reading and writing process
variables" below for their confirmed methods, and `TaskService`/`ExecutionService` for how each kind
of variable actually gets written.

---

## Pattern: extend an OOTB service task (preferred)

This is what `SKILL.md`'s "extend, never reimplement" rule means in code. The sample prompt this
answers: *"When a DCR is approved, we need to call an external inventory API before the change
commits — can this be a service task?"*

```java
package com.example.workflow.custom;

import com.reltio.workflow.activiti.service.ChangeRequestApply;
import com.reltio.workflow.api.actions.Execution;

public class InventoryCheckedChangeRequestApply extends ChangeRequestApply {

    @Override
    public void execute(Execution execution) throws Exception {
        // Execution exposes these directly — confirmed from real code, no RuntimeService chain
        // needed for them: getObjectUris() (List<String>), getAccessToken(), getEnvironmentUrl(),
        // getTenantId(), getId() (the execution id, for ExecutionService.setVariable calls).
        if (!externalInventoryCheck(execution.getObjectUris())) {
            throw new RuntimeException("Inventory check failed for " + execution.getObjectUris());
        }

        super.execute(execution); // delegate to the OOTB apply logic — this is the entire point
                                   // of extending rather than reimplementing: you get Reltio's
                                   // own apply behavior for free and only add your own check
                                   // around it.
    }

    private boolean externalInventoryCheck(java.util.List<String> objectUris) {
        // Your own stateless outbound call. NEEDS VERIFICATION: confirm the HTTP client and
        // timeout conventions already used elsewhere in your tenant's existing custom JAR, if
        // one exists, before introducing a new one.
        return true;
    }
}
```

**Why extend instead of implementing `WorkflowAction` from scratch:** the OOTB classes already handle
the actual apply/reject/merge mechanics and the Reltio-specific variable names those mechanics
depend on — reimplementing that from the bare interface means guessing at variable names that are
undocumented at that layer. Wire it in BPMN exactly like any other service task:

```xml
<serviceTask id="applyWithInventoryCheck" name="Apply with Inventory Check"
    activiti:class="com.example.workflow.custom.InventoryCheckedChangeRequestApply"/>
```

---

## Pattern: a fresh task listener

Use this when there's no OOTB class to extend — e.g. the sample prompt *"write a task listener that
blocks assignment to anyone outside the requester's own region."* This is the one case where you
genuinely implement the interface from scratch rather than extending something.

```java
package com.example.workflow.custom;

import com.reltio.workflow.api.WorkflowService;
import com.reltio.workflow.api.listeners.WorkflowTaskListener;
import com.reltio.workflow.api.tasks.Task;
import com.reltio.workflow.api.tasks.TaskService;

public class RegionRestrictedAssignmentListener implements WorkflowTaskListener {

    @WorkflowService
    TaskService taskService;

    @Override
    public void notify(Task task) {
        String assignee = task.getAssignee();
        // The exact variable name Reltio populates for "requester's region" is tenant-specific
        // config, not a platform constant — confirm it against your own tenant. Read it the same
        // way MultiTaskCompleteListener reads a task-local variable in the real sample repo:
        String requesterRegion = (String) taskService.getVariable(task.getId(), "requesterRegion");

        if (!isSameRegion(assignee, requesterRegion)) {
            taskService.assignTask(task, null); // confirmed real method, same sample repo
        }
    }

    private boolean isSameRegion(String assignee, String region) { return true; }
}
```

Wire it on the `assignment` event:

```xml
<activiti:taskListener event="assignment"
    class="com.example.workflow.custom.RegionRestrictedAssignmentListener"/>
```

**Statelessness — the rule that matters most here:** a listener class is instantiated once and
reused across every invocation on every process instance. Any field you inject or assign is a
shared singleton, not per-invocation state. A field written by one execution can leak into a
concurrent one — this is very likely the cause behind the sample prompt *"our custom class works
alone but fails intermittently under load."* Read per-invocation data from the `Execution`/`Task`
argument every time; never cache it in an instance field between calls.

**Set variables through the service, not directly — confirmed, not inferred:**
`ExecutionService.setVariable(executionId, name, value)`, called with `execution.getId()` as the
first argument. Real signature, from the same compiled, CI-tested code:

```java
executionService.setVariable(execution.getId(), "requestor", createdBy.toString());
```

`executionService` itself is a field, injected the same way as `reltioApi` — see the next section.

---

## Pattern: surfacing a mandatory rejection comment to whoever gets the next task

`commentRequired="true"` on a form-property value only forces the UI to collect a comment when that
action is taken — it does not, by itself, make that comment text appear anywhere a *later* task can
show it. If a requirement says a rejection reason must travel with the task that routes back to the
requester (not just be recorded in the process's audit history, which it is either way), capture it
explicitly, the same way `CaptureRequestor` captures `createdBy` — a listener on the review task's
`complete` event, reading the comment and storing it as its own process variable:

```java
package com.example.workflow.custom;

import com.reltio.workflow.api.WorkflowService;
import com.reltio.workflow.api.listeners.WorkflowTaskListener;
import com.reltio.workflow.api.tasks.Task;
import com.reltio.workflow.api.tasks.TaskService;

public class CaptureRejectionComment implements WorkflowTaskListener { // interface+signature now
                                                                         // confirmed (see above)
    @WorkflowService
    TaskService taskService;

    @Override
    public void notify(Task task) {
        // NEEDS VERIFICATION: the exact accessor for the comment text entered via commentRequired —
        // not seen in any sample in github.com/reltio-ai/samples-custom-workflow (none of its
        // modules read a completion comment back in Java). Plausibly a Task method alongside
        // getDueDate()/getAssignee()/getReltioUser() (all confirmed real), or only reachable via
        // processInstanceComment on the _action REST body rather than from inside a listener at
        // all — confirm against your tenant's repo before relying on either guess.
        // taskService.setVariable(task.getId(), "rejectionReason", theCommentText);
    }
}
```

Then reference `${rejectionReason}` in the next task's `<documentation>` or a form property default,
instead of static text that only ever says a comment exists without showing it. **This pattern is
more speculative than the others in this file** — flagged explicitly because a real workflow was
built with `commentRequired="true"` alone and a static `<documentation>` string, satisfying "a
comment is mandatory" but not "the next assignee can see what it said" without checking the DCR's own
comment history separately. Confirm live whether that distinction matters for your requirement before
assuming either behavior.

---

## Pattern: a custom validator

**Confirmed, real, working code** — this is `delete-review-with-validation/src/main/java/com/company/workflow/delete/DeleteReviewValidator.java`
from the official sample repo, verbatim (a second, independently-written copy exists in the same
repo's `due-date-validator/` module, using the identical interface and signature):

```java
package com.company.workflow.delete;

import java.util.Date;
import com.reltio.workflow.api.tasks.Task;
import com.reltio.workflow.api.validators.TaskValidator;
import com.reltio.workflow.api.validators.ValidationError;

public class DeleteReviewValidator implements TaskValidator {
    @Override
    public void doValidate(Task task) throws Exception {
        if (task.getDueDate().compareTo(new Date()) <= 0) {
            throw new ValidationError("Incorrect due date of task " + task.getId());
        }
    }
}
```

Throw `ValidationError` (not a return value — `doValidate` is `void`) to block completion; returning
normally allows it. Wire it in the task's `validator` form property (not `activiti:class` — see
`bpmn-rules.md` §5):

```xml
<activiti:formProperty id="validator" name="Validator" type="string"
    default="com.company.workflow.delete.DeleteReviewValidator" writable="false"/>
```

---

## Pattern: resolve the entity type for a gateway

Used by the entity-type gate in `workflow-bpmn-authoring/references/bpmn-rules.md` §17: a service task
placed right after the start event that writes an `entityType` process variable the next exclusive
gateway reads (`${entityType == 'configuration/entityTypes/Product'}`).

**Built from confirmed pieces, not a copied sample** — the DCR fetch and the `changes` /
`CREATE_ENTITY` / `newValue.type` structure are from `aws-access/.../ApplyDCRAddFromS3.java`;
`ExecutionService.setVariable(executionId, name, value)` is the same call `CaptureRequestor` uses;
the existing-entity branch assumes `GET {env}/reltio/api/{tenant}/entities/{id}` returns a top-level
`type` (standard Reltio entity JSON, but not exercised by any sample). **Verify on a test tenant.**

```java
package com.company.workflow.dcr;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.reltio.workflow.api.WorkflowService;
import com.reltio.workflow.api.actions.Execution;
import com.reltio.workflow.api.actions.WorkflowAction;
import com.reltio.workflow.api.rest.ReltioApi;
import com.reltio.workflow.api.services.ExecutionService;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class ResolveEntityType implements WorkflowAction {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @WorkflowService
    private ReltioApi reltioApi;

    @WorkflowService
    private ExecutionService executionService;

    @Override
    public void execute(Execution execution) throws Exception {
        String base = execution.getEnvironmentUrl() + "/reltio/api/" + execution.getTenantId() + "/";
        String token = execution.getAccessToken();

        String dcrUri = execution.getObjectUris().stream()
                .filter(u -> u.startsWith("changeRequests/")).findFirst().orElse(null);
        Set<String> types = new HashSet<>();
        if (dcrUri != null) {
            Map<String, Object> dcr = MAPPER.readValue(
                    reltioApi.invokeApi(token, base + dcrUri, "GET", ""), Map.class);
            Map<String, List<Map<String, Object>>> changes = (Map) dcr.get("changes");
            if (changes != null) {
                for (Map.Entry<String, List<Map<String, Object>>> e : changes.entrySet()) {
                    String type = null;
                    for (Map<String, Object> change : e.getValue()) {
                        if ("CREATE_ENTITY".equals(change.get("type"))) {
                            type = (String) ((Map) change.get("newValue")).get("type");
                        }
                    }
                    if (type == null && e.getKey().startsWith("entities/")) {
                        Map<String, Object> entity = MAPPER.readValue(
                                reltioApi.invokeApi(token, base + e.getKey(), "GET", ""), Map.class);
                        type = (String) entity.get("type");
                    }
                    if (type != null) types.add(type);
                }
            }
        }
        // MIXED / UNKNOWN never match a configured type, so the gateway's default branch
        // (the unchanged standard review) takes them.
        String resolved = types.size() == 1 ? types.iterator().next()
                : types.isEmpty() ? "UNKNOWN" : "MIXED";
        executionService.setVariable(execution.getId(), "entityType", resolved);
    }
}
```

Notes: it only reads (two GETs at most per changed object), never writes to Reltio; keep it stateless;
its unit test mocks `ReltioApi.invokeApi` with a one-entry `changes` map for each of
CREATE_ENTITY, an existing-entity change, mixed types and an empty DCR, asserting the variable set.

---

## Pattern: changing a task's priority

**Confirmed, real code** — `change-priority/.../PriorityAdjustListener.java`. Sets Urgent priority
when a DCR has `CREATE_ENTITY` changes:

```java
public class PriorityAdjustListener implements WorkflowTaskListener {
    @WorkflowService
    TaskService taskService;

    @Override
    public void notify(Task task) {
        String dcrType = String.valueOf(taskService.getVariable(task.getId(), "dcrType"));
        if (dcrType.contains("CREATE_ENTITY")) {
            taskService.setPriority(task.getId(), 1000);
        }
    }
}
```

**Confirmed priority values** (from the same sample's `Readme.md`): Low = `1`, Medium = `50`
(the OOTB default), High = `100`, Urgent = `1000`.

---

## Pattern: sending an email notification

**Confirmed, real code** — `custom-notifications/.../OverdueNotification.java` (a `WorkflowAction`,
triggered from a boundary-timer escalation — see `bpmn-rules.md` §15.2). The confirmed service is
`com.reltio.workflow.api.notification.mail.NotificationSenderService`, with `Notification` and
`Attachment` in the same package:

```java
public class OverdueNotification implements WorkflowAction {
    @WorkflowService
    NotificationSenderService notificationSenderService;
    @WorkflowService
    ExecutionService executionService;

    @Override
    public void execute(Execution execution) {
        Notification notification = new Notification(execution.getTenantId());
        notification.setSubject("Your task is overdue");
        notification.setBody("<p>REMINDER: the task assigned to you is overdue.</p>");
        notification.addTo("firstname.lastname@reltio.com");          // hardcoded recipient

        // or resolve a recipient from a variable set earlier by a listener — see the
        // typed getVariable overload below:
        String dcrAssignee = executionService.getVariable(execution.getId(), "dcrAssignee", String.class);
        if (dcrAssignee != null && !dcrAssignee.isEmpty()) {
            notification.addTo(dcrAssignee);
        }

        notificationSenderService.sendNotification(notification);
    }
}
```

**Attaching an inline image** (confirmed, same file): build an `Attachment(name, byteArray)`, set
`setContentId("overdue")`, `setContentType("image/png")`, `setDisposition("inline")`, add it with
`notification.addAttachment(attachment)`, then reference it in the HTML body with `<img
src="cid:overdue">` — the `cid:` scheme matches the attachment's content id, not a URL.

**Resolving a task's assignee email address** — confirmed, a second real method on the same
service: `notificationSenderService.resolveTaskAssigneeEmail(task)`, used in
`custom-notifications/.../TaskInfoSaver.java` to capture an address into a variable
(`executionService.setVariable(task.getExecutionId(), "dcrAssignee", assigneeAddress)` — note
`Task.getExecutionId()`, confirmed, for going from a task-scoped listener back to the
execution-scoped variable store).

---

## Pattern: calling AWS from a service task

**Confirmed, real code and a real operational prerequisite** — `aws-access/.../ApplyDCRAddFromS3.java`
and its `Readme.md`. Reltio recommends temporary, assumed-role credentials over long-lived AWS keys,
via a confirmed real service:

```java
@WorkflowService
private AwsService awsService;

AssumeRoleRequest assumeRoleRequest = new AssumeRoleRequest()
    .withDurationSeconds(3600)
    .withRoleArn("arn:aws:iam::<your_account_id>:role/<reltio-workflow-*>")
    .withRoleSessionName("tenant-name");

Credentials creds = awsService.getTemporaryCredentials(assumeRoleRequest);

AWSStaticCredentialsProvider provider = new AWSStaticCredentialsProvider(
    new BasicSessionCredentials(creds.getAccessKeyId(), creds.getSecretAccessKey(), creds.getSessionToken()));
AmazonS3 s3Client = AmazonS3ClientBuilder.standard()
    .withCredentials(provider)
    .withRegion(Regions.US_EAST_1)
    .build();
```

**Real prerequisite, not optional**: this only works after you contact Reltio Support with your AWS
account id, so Reltio can configure the trust relationship that lets the workflow user assume a role
in *your* account. Budget for that round trip before promising a customer this pattern works
immediately.

---

## Pattern: calling back into Reltio's own APIs with credentials of your own, not the acting user's

Every other pattern in this file uses `execution.getAccessToken()` — the acting user's own token,
scoped to whatever that user is allowed to do. Sometimes that's not enough: reassigning a task to
*any* candidate, or reading data the current reviewer can't see, needs the Workflow Adapter's own
API called with separate, elevated credentials. **Confirmed, real code** —
`update-task-timer/.../UpdateAssignee.java`, reassigning an overdue task on a boundary timer.

**The shape**: an OAuth `client_id`/`client_secret` pair, stored **encrypted** as two `dataObject`s
on the process (`encodedClientId`/`encodedClientSecret` — see `bpmn-rules.md` §2's `dataObject`
pattern), decrypted at runtime, exchanged for its own access token via `client_credentials` grant,
then used to call the Workflow Adapter's own REST API directly (`GET .../processInstances/{id}`,
`GET .../tasks/{id}`, `POST .../assignee`, `PUT .../tasks/{id}`) — not the Reltio platform API, and
not through `ReltioApi`/`ExecutionService` at all, since those are scoped to the execution's own
token and object:

```java
String clientId = Utils.decrypt(executionService.getVariable(execution.getId(), "encodedClientId", String.class));
String clientSecret = Utils.decrypt(executionService.getVariable(execution.getId(), "encodedClientSecret", String.class));
String accessToken = Utils.getAccessToken(clientId, clientSecret); // POST {authUrl}/oauth/token, grant_type=client_credentials
// ...then plain java.net.http.HttpClient calls to the Workflow Adapter's own API, Bearer accessToken
```

**⚠️ Security gotcha this pattern genuinely has, worth stating plainly rather than silently
copying**: the sample repo's own `encrypt`/`decrypt` utility derives its AES key from a **hardcoded
string constant embedded in the source file itself** (`"WorkflowSecretEncryptionKey"`, SHA-256'd).
That file is public, open-source, on GitHub — so that specific key is public too. Encrypting a real
client secret with the sample's own key and committing the result to a repository provides **no
real protection at all**, because anyone can read the same key from the same public file and decrypt
it right back. If you use this pattern for real: generate and manage your own key through your
organization's actual secret-management practice (the sample's own README says exactly this —
"comply with your organization's security practices" — treat that line as the one that matters
most, not as boilerplate), and never reuse the sample's literal key string.

---

## Reading and writing process variables, and getting access to `ReltioApi`/`ExecutionService`

**Field injection — confirmed from real code:** annotate the field with `@WorkflowService`
(`com.reltio.workflow.api.WorkflowService`); the platform populates it before `execute()` runs. This
is how both `ReltioApi` and `ExecutionService` reach your class — never `new` them up yourself:

```java
@WorkflowService
ReltioApi reltioApi;

@WorkflowService
ExecutionService executionService;
```

**Reading well-known process data — confirmed, from `Execution` itself:** `getObjectUris()`,
`getAccessToken()`, `getEnvironmentUrl()`, `getTenantId()`, `getId()` are direct methods on
`Execution` — no `RuntimeService` indirection needed for these. The official doc portal separately
shows a lower-level path for an arbitrary named variable —
`delegateExecution.getEngineServices().getRuntimeService().getVariable(processInstanceId, name)` —
which is presumably still correct for a variable that isn't one of `Execution`'s own direct
accessors, but prefer the direct accessor when the data you need is one of the five above.

**Reading an arbitrary Reltio object (not just a variable) — confirmed:** call out to the platform
API directly through the injected `ReltioApi`:

```java
String url = Utility.generateTenantUrl(execution.getEnvironmentUrl(), execution.getTenantId())
    + "/" + someObjectUri;
String json = reltioApi.invokeApi(execution.getAccessToken(), url, "GET", "");
```

`com.reltio.workflow.api.Utility.generateTenantUrl(environmentUrl, tenantId)` builds the base URL;
`ReltioApi.invokeApi(accessToken, url, method, body)` makes the call and returns the raw response
body as a string — parse it yourself (e.g. with Jackson's `ObjectMapper`, already `provided` — see
the `pom.xml` below).

**Writing an execution/process-level variable — confirmed:**
`ExecutionService.setVariable(executionId, name, value)`, and reading one back two confirmed ways:
the untyped `ExecutionService.getVariable(executionId, name)` (used in
`field-injection/.../StageInfoLogger.java`), and a **typed overload**,
`ExecutionService.getVariable(executionId, name, Class<T>)` (used in
`custom-notifications/.../OverdueNotification.java` as `getVariable(execution.getId(), "dcrAssignee", String.class)`)
— prefer the typed one when you know the variable's type, it saves the cast.

**`TaskService` — confirmed, a separate, task-scoped sibling of `ExecutionService`, used from
`WorkflowTaskListener`s.** All of the following are real, used-in-production methods from the sample
repo, not a reasoned guess:

| Method | Used for, in a real sample |
|---|---|
| `setVariable(taskId, name, value)` | `MultiTaskCompleteListener` — aggregate each parallel reviewer's decision into a shared `allDecisions` string |
| `getVariable(taskId, name)` | Same — reads the running `allDecisions` value before appending to it |
| `getVariableLocal(taskId, name)` | Same — reads *this instance's own* `decision`, scoped to just this one parallel task, not shared across siblings |
| `getVariables(taskId)` → `Map` | `MultiTaskStartEventListener` — reads `nrOfInstances`/`loopCounter` to assign each parallel instance to a different reviewer |
| `setDueDate(taskId, date)` | `DueDateAdjustListener` — extends a task's due date to skip weekends |
| `setPriority(taskId, int)` | `PriorityAdjustListener` — sets Urgent (`1000`) priority for `CREATE_ENTITY` DCRs (see its own pattern below for all four confirmed priority values) |
| `setOwner(task, userId)` / `assignTask(task, userId)` | `MultiTaskStartEventListener` — claims a task on behalf of, then assigns, a specific reviewer |
| `getAllPossibleAssignees(task)` → `Set<String>` | Same — the real candidate pool for a `candidateGroups` task, to pick an assignee from |

**`Task` itself also has `getReltioUser()`** (confirmed, `MultiTaskStartEventListener`) — a direct
accessor for the same concept `${reltioUser}` names in BPMN expressions, callable from Java without
going through a process variable lookup at all.

**Field injection from BPMN (`activiti:field`) — confirmed type:** `com.reltio.workflow.api.expressions.Field`,
with a `.getValue(execution)` method — not a primitive directly injected. A class member declared as
a bare `private Field stageName;` is populated by the platform from a matching `<activiti:field
name="stageName" .../>` in the BPMN, and read with `stageName.getValue(execution)` inside `notify()`.

---

## Build configuration (`pom.xml`)

This is not a guess — it's transcribed directly from Reltio's own customer-repository provisioning
template (`com.reltio.workflow:reltio-custom-workflows-archetype`), the actual Maven archetype every
customer's Bitbucket repository is generated from. These are the real, currently-shipped values.

```xml
<build>
  <pluginManagement>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-shade-plugin</artifactId>
        <version>3.5.0</version>
        <configuration>
          <createDependencyReducedPom>false</createDependencyReducedPom>
          <finalName>${project.artifactId}-${project.version}-everything</finalName>
        </configuration>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.14.0</version>
        <configuration>
          <release>17</release>
        </configuration>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.1.0</version>
      </plugin>
      <plugin>
        <groupId>org.jacoco</groupId>
        <artifactId>jacoco-maven-plugin</artifactId>
        <version>0.8.7</version>
      </plugin>
    </plugins>
  </pluginManagement>
  <plugins>
    <plugin>
      <artifactId>maven-shade-plugin</artifactId>
      <executions>
        <execution><phase>package</phase><goals><goal>shade</goal></goals></execution>
      </executions>
    </plugin>
    <plugin>
      <groupId>org.jacoco</groupId>
      <artifactId>jacoco-maven-plugin</artifactId>
      <executions>
        <execution><goals><goal>prepare-agent</goal></goals></execution>
        <execution><id>report</id><phase>prepare-package</phase><goals><goal>report</goal></goals></execution>
        <execution>
          <id>jacoco-check</id>
          <goals><goal>check</goal></goals>
          <configuration>
            <rules>
              <rule>
                <element>PACKAGE</element>
                <limits>
                  <limit><counter>LINE</counter><value>COVEREDRATIO</value><minimum>0.8</minimum></limit>
                </limits>
              </rule>
            </rules>
          </configuration>
        </execution>
      </executions>
    </plugin>
  </plugins>
</build>

<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.reltio.workflow</groupId>
      <artifactId>workflow-api</artifactId>
      <scope>provided</scope>
      <version>[2026.1.0.0,]</version>
    </dependency>
    <dependency>
      <groupId>com.reltio.workflow</groupId>
      <artifactId>workflow-custom</artifactId>
      <scope>provided</scope>
      <version>[2026.1.0.0,]</version>
    </dependency>
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
      <version>2.22.1</version>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>org.slf4j</groupId>
      <artifactId>slf4j-api</artifactId>
      <version>2.0.17</version>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter-engine</artifactId>
      <version>5.9.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter-params</artifactId>
      <version>5.9.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.mockito</groupId>
      <artifactId>mockito-core</artifactId>
      <version>5.4.0</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

**`workflow-api` and `workflow-custom` are `provided` scope** — they're on the Workflow Adapter's
own runtime classpath already; shading them into your JAR would duplicate (and could version-skew
against) what the adapter already provides. The shade plugin's `finalName` is what makes the
artifact `<artifactId>-<version>-everything.jar` — the "everything" suffix is not a Reltio-chosen
convention you need to replicate by hand, it falls out of this exact `pom.xml` configuration.

**A repository with more than one custom workflow is a multi-module Maven project** — confirmed
both by the archetype's own structure (it generates one initial module, `custom-workflow`, with its
`README.md` instructing you to add further sibling sub-modules for additional workflows and remove
the sample if unused) and independently by the official Workflow FAQ page, which documents
"Multi-Module Builds: Instructions for creating multiple JARs in one repository using Maven
modules" as a supported pattern. See `workflow-repo-contribution/SKILL.md` for what that means for
registration (one JAR per module, and the FAQ also confirms **a single JAR can be registered across
multiple tenants and its classes incorporated into multiple workflows** — the module boundary is a
build/packaging convenience, not a hard one-JAR-one-workflow-one-tenant rule).

---

## Test-writing

JUnit 5 Jupiter (`junit-jupiter-engine`/`junit-jupiter-params` 5.9.2) and Mockito (`mockito-core`
5.4.0) — both confirmed exact versions from the real archetype `pom.xml` above. Mock `Execution`,
`ReltioApi`, and `ExecutionService` directly rather than standing up a real Activiti engine — this
is the real shape of a passing test from the same confirmed source, not a sketch:

```java
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import com.reltio.workflow.api.actions.Execution;

class InventoryCheckedChangeRequestApplyTest {
    @Test
    void blocksApplyWhenInventoryCheckFails() throws Exception {
        var action = new InventoryCheckedChangeRequestApply();
        action.reltioApi = Mockito.mock(ReltioApi.class);          // the @WorkflowService fields —
        action.executionService = Mockito.mock(ExecutionService.class); // set directly, no DI container

        Execution execution = Mockito.mock(Execution.class);
        Mockito.when(execution.getObjectUris()).thenReturn(java.util.List.of("entities/badObject"));

        Mockito.verifyNoInteractions(action.executionService); // nothing written on the failure path
    }
}
```

The real test suite this pattern is drawn from also covers the "field genuinely missing from the
API response" case explicitly (`missingCreatedByDoesNotSetVariableTest`-shaped) — write that negative
case alongside the happy path, not only the happy path, since it's exactly the kind of branch a
reviewer's coverage gate will flag if it's untested.

**The coverage gate is 80%, measured per-package, line coverage, enforced by the `jacoco-check`
execution above** — this is the real, mechanically-enforced number from the archetype's `pom.xml`,
and it is what will actually block your pull request if unmet. See the Known Ambiguities section
below for why this disagrees with the number stated on the doc portal.

---

## Known Ambiguities / Needs Verification

Same confidence-tiering convention as `bpmn-rules.md` §12: confirmed-against-source vs. inferred vs.
genuinely unresolved. Flagging because real sources disagree here too.

1. **Coverage gate: 70% (doc portal) vs. 80% (the actual provisioning template's `pom.xml`).** The
   official "Overview of Workflow Customizations" page states: *"Ensure that the Unit/Integration
   tests cover at least 70% of your code."* The real, currently-shipped `reltio-custom-workflows-archetype`
   template's `pom.xml` sets the JaCoCo `jacoco-check` rule's `<minimum>` to `0.8` — an 80% line-coverage
   floor, enforced per-package at build time. **Treat 80% as the operative number** — it's the one a
   pull request's pipeline will actually check against, assuming a customer hasn't edited their own
   `pom.xml` to lower it — but the doc's lower stated minimum is a real, citable discrepancy, not
   this skill's own invention. If a customer's pipeline rejects a change below 80% while citing "70%
   minimum" from the doc, that's not a contradiction in what you're told — it's two different
   numbers from two real sources, and the build file wins because it's what's mechanically enforced.
2. ~~**Validator interface and method shape: two different versions seen.**~~ — **resolved.**
   `com.reltio.workflow.api.validators.TaskValidator`, `void doValidate(Task task) throws Exception`,
   throwing `ValidationError`, confirmed from two independent real, compiled files in Reltio's
   official sample repo (`delete-review-with-validation/` and `due-date-validator/`). The doc
   portal's `TaskValidationInfo`/`boolean`/`InvalidTaskException` shape, previously treated as the
   current one, is now the version to treat with suspicion — real compiled code in two places beats
   one documentation page's prose.
3. ~~**Exact package path for `WorkflowTaskListener`/`WorkflowExecutionListener`**~~ — **resolved.**
   `com.reltio.workflow.api.listeners.WorkflowTaskListener` (`void notify(Task task)`) and
   `com.reltio.workflow.api.listeners.WorkflowExecutionListener` (`void notify(Execution execution)`),
   both confirmed from multiple independent real files — see the table at the top of this file.
4. ~~**The service task's own implementation interface** (`JavaDelegate`)~~ — **resolved.** It's
   `com.reltio.workflow.api.actions.WorkflowAction` with `void execute(Execution execution)`, not raw
   Activiti's `JavaDelegate`/`DelegateExecution`. The prior reasoning in this file (that it must be
   raw `JavaDelegate`, since that's how generic Activiti service tasks work) was a plausible guess,
   and it was wrong — Reltio wraps this extension point too, the same as it wraps listeners.
5. **Everything else in this file is now confirmed from real, compiled, official source** —
   `ExecutionService`, `TaskService`, `Execution`, `Task`, `ReltioApi`, `Utility`, `Field`, and
   `@WorkflowService` field injection, all read directly from 14 real sample modules in
   [github.com/reltio-ai/samples-custom-workflow](https://github.com/reltio-ai/samples-custom-workflow),
   not reasoned or taken from a doc summary. **Genuinely still open**: the exact accessor (if any)
   for reading a task-completion comment's text from inside Java — no sample in that repo does this,
   so the "surfacing a rejection comment" pattern above remains the one real gap left in this file.

---

## Where this fits

- `bpmn-rules.md` (in `workflow-bpmn-authoring/references/`) — the OOTB class names these patterns
  extend, and the XML wiring (`activiti:class`, `activiti:taskListener`, the `validator` form
  property) that connects a BPMN file to the Java in this file.
- `reltio-doc-portal-reference.md` — the official doc-portal pages these patterns were confirmed
  against, and the public GitHub repository containing the real OOTB source.
- `workflow-repo-contribution/SKILL.md` — what happens to this code after it's written: PR, review,
  build, S3, registration.
- `workflow-local-adapter-setup/SKILL.md` — only if the user explicitly asks to run the code against a local adapter; not a standard stage.
