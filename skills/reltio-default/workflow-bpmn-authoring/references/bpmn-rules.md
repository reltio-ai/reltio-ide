# BPMN rules for Reltio Workflow

Read this before writing a single line of BPMN XML. Every rule here exists because breaking it
produces a deploy rejection or a workflow that appears to work and does nothing.

The engine is **Activiti 5.x**. Anything valid in generic BPMN 2.0 but not listed here should be
treated as unsupported until proven otherwise on a tenant.

> Authoritative sources for this file: the public **Reltio Workflow Service repository**
> ([github.com/reltio-ai/workflow](https://github.com/reltio-ai/workflow)) — the real service/listener
> class sources and the actual OOTB process definitions under `default process definitions/`, which
> is the workflow equivalent of the LCA framework's `ILifeCycleAction.java` — and the official
> doc-portal pages under
> [docs.reltio.com](https://docs.reltio.com/en/objectives/manage-workflow-tasks) indexed in
> `references/reltio-doc-portal-reference.md`. **See §12 for what is confirmed against those sources,
> inferred from observed deploy behavior, or still unresolved — and §13 for what to do when this file
> and the official docs disagree.**

---

## 1. The skeleton — copy this, do not retype it

```xml
<?xml version="1.0" encoding="UTF-8"?>
<definitions
  xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:activiti="http://activiti.org/bpmn"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI"
  typeLanguage="http://www.w3.org/2001/XMLSchema"
  expressionLanguage="http://www.w3.org/1999/XPath"
  targetNamespace="http://www.activiti.org/test">

  <process id="myProcessId" name="My Process" isExecutable="true">
    <!-- elements -->
  </process>
</definitions>
```

All seven namespaces are required. Dropping `activiti` or `xsi` fails at deploy, not at author time.

## 2. The process id is the workflow's identity

| Rule | Consequence of breaking it |
|---|---|
| `id` becomes the API `processType` | A mismatch means the workflow cannot be started |
| A DCR customization **must keep** `id="dataChangeRequestReview"` (or whatever id the tenant's `dcr.processtype` setting names — see §14) | Any other id and the HUB UI's **Suggest** button stops auto-triggering it; it can then only be started via API |
| `isExecutable="true"` always | A non-executable process deploys but never runs |
| Deploying an id that already exists creates **version N+1** of that process | New instances immediately use your version. This is how you replace a live workflow — including a Reltio built-in |

## 3. Every `userTask` needs both OOTB create listeners

Omitting either produces **`errorCode 10044`** at runtime. Default to putting both on *every* user
task in the process, not only the first one — secondary review and clarification tasks included.
**This default is contradicted by a real Reltio-shipped file — see §12.1 before treating the second
listener as unconditionally mandatory on a task that isn't the process's first review step.**

```xml
<userTask id="reviewTask" name="Review" activiti:candidateGroups="ROLE_DATASTEWARD">
  <extensionElements>
    <activiti:taskListener event="create"
      class="com.reltio.workflow.activiti.service.TaskStartEventListener"/>
    <activiti:taskListener event="create"
      class="com.reltio.workflow.activiti.service.DCRTypeTaskListener"/>
  </extensionElements>
</userTask>
```

`TaskStartEventListener` is confirmed required on every `userTask` — it appears on every task in
every OOTB definition in the public repo, with no exception. The type listener
(`DCRTypeTaskListener` / `EntityTypeTaskListener` / `RelationTypeTaskListener`, one per object kind —
see §5) is confirmed present on the **first** review task of the canonical `dataChangeRequestReview`
and `PotentialMatchReview` OOTB definitions, but see §12.1 for a real counter-example on later tasks.

## 4. Gateways — four rules, all enforced at deploy

1. **Always set `default="<flowId>"`** on an exclusive gateway. Without it, a value matching no
   condition leaves the instance stuck at the gateway. Conditions over a required two-value enum
   are exhaustive and cannot hit this, so the editor reports a missing default as a warning rather
   than an error — but set one anyway: the enum is in a form property that a later edit can widen.
2. **The default flow must have no `<conditionExpression>`.** Activiti rejects the deploy with
   `activiti-exclusive-gateway-condition-on-seq-flow`.
3. **A gateway with one outgoing flow must be deleted**, not kept. Activiti rejects it with
   `activiti-exclusive-gateway-no-outgoing-seq-flow`. Connect the task straight to the next element.
4. **Condition values are case-sensitive** and must match the `activiti:value id` in the form
   property exactly — `'Approve'`, never `'approve'`.

```xml
<exclusiveGateway id="decisionGateway" name="Decision" default="flowReject"/>
<sequenceFlow id="flowApprove" sourceRef="decisionGateway" targetRef="applyService">
  <conditionExpression xsi:type="tFormalExpression"><![CDATA[${decision=='Approve'}]]></conditionExpression>
</sequenceFlow>
<sequenceFlow id="flowReject" sourceRef="decisionGateway" targetRef="rejectService"/>
```

## 5. Use only these OOTB class names

Inventing a fully-qualified class name is the most common cause of a workflow that deploys and then
fails at runtime. If the logic you need is not in this list, it requires custom Java — which is a
different, much longer path (see the repo-contribution playbook).

**Service tasks**

| Class | Purpose |
|---|---|
| `com.reltio.workflow.activiti.service.ChangeRequestApply` | Apply/approve a data change request |
| `com.reltio.workflow.activiti.service.ChangeRequestReject` | Reject a data change request |
| `com.reltio.workflow.activiti.service.Merge` | Merge matched entities (potential match review) |
| `com.reltio.workflow.activiti.service.NotAMatch` | Mark entities as not a match |
| `com.reltio.workflow.activiti.service.Delete` | Delete an entity |

**Task listeners**

| Class | Event |
|---|---|
| `com.reltio.workflow.activiti.service.TaskStartEventListener` | `create` |
| `com.reltio.workflow.activiti.service.DCRTypeTaskListener` | `create` (DCR review tasks) |
| `com.reltio.workflow.activiti.service.EntityTypeTaskListener` | `create` (potential match / entity tasks) |
| `com.reltio.workflow.activiti.service.TaskAssignmentEventListener` | `assignment` |

This extension's own editor diagnostics enforce `TaskStartEventListener` + `DCRTypeTaskListener` as
the required pair on every `userTask`, regardless of object kind (see §10.5 / §12.1) — so this is the
pair to plan for by default. See §12.5 for a class the public source repo defines for relation-type
tasks that is **not** part of that enforced pair and is not yet on this table.

**Validators**

| Class | Applies to |
|---|---|
| `com.reltio.workflow.core.task.validator.DataChangeRequestValidator` | DCR tasks |
| `com.reltio.workflow.core.task.validator.PotentialMatchTaskValidator` | Potential match tasks |

The validator class goes in the task's `validator` form property (see the OOTB definitions), not in
`activiti:class` — it is not a task listener. **Package-name note (see §12.4):** the OOTB definitions
in the public repo set this form property to this `core.task.validator` package; the same class
*names* live under a differently-named package in that repo's own source tree. Use `core.task.validator`
— it is what the shipped, deployed definitions actually reference — and treat the source-tree
package as a build/packaging detail, not the runtime classpath. See §12.5 for a third validator class
the public source defines that is not on this table.

**Execution listeners**

| Class | Purpose |
|---|---|
| `com.reltio.workflow.activiti.service.DCRHasChangesListener` | Skip the process when the DCR changes nothing |

## 6. Assignment — two traps

- **Never** use `activiti:assignee="${reltioUser}"`. It is silently null when the workflow is
  triggered from the UI, and the task becomes invisible to everyone including its intended owner.
  Use `activiti:candidateGroups` with a role instead.
- **Never** use `${initiator}` to mean the person who raised the request. Reltio does not populate
  Activiti's `initiator` variable; it is always null.

## 7. Ordering rules the schema enforces

- `<extensionElements>` must come **before** `<multiInstanceLoopCharacteristics>`. Reversed, the
  deploy fails with `errorCode 13032`.
- A service task that writes to the entity must run **after** `ChangeRequestApply` on a
  `CREATE_ENTITY` request. Before it, the entity does not exist yet and the write is a silent no-op.

## 8. The file name is part of the contract

The uploaded file must end **exactly** in `.bpmn20.xml` — no spaces, no `(1)`, no other suffix.
Anything else returns `errorCode 10002 Invalid process definition file extension`. Reltio IDE names
draft files this way automatically; keep it if you rename.

## 9. Standard topologies

```
Single approval
  Start → UserTask → ExclusiveGateway → [Apply | Reject] → End

Two-step sequential
  Start → UserTask1 → Gateway1 → [Reject | UserTask2] → Gateway2 → [Apply | Reject] → End
```

Anything more complex than branching on a submitted decision — clarification loops that return to
the requester, N-of-M quorum, custom notification content, calls to an external system — needs
custom Java. Say so rather than approximating it in BPMN.

## 10. Validation checklist — all must pass before deploying

Items marked **(checked)** are enforced by Reltio IDE as you type: it reports them on the file, with
the range on the offending element and a `reltio-bpmn/…` code naming the rule. Read that report
rather than asserting you walked the list — a tool that says the file is clean is worth more than a
claim that it is. The rest are **(yours)**: nothing in the file can answer them.

1. **(checked)** Every element `id` is unique within the process.
2. **(checked)** Every `sequenceFlow` has a `sourceRef` and `targetRef` that resolve to elements in
   this file.
3. **(checked)** Every exclusive gateway has a `default` — as a *warning*, because conditions over a
   required two-value enum are exhaustive and such a gateway cannot actually strand an instance;
   that the default is one of its own outgoing flows, and carries no condition, is checked as an
   error, since Activiti rejects the deploy.
4. **(checked)** No gateway has fewer than two outgoing flows.
5. **(checked)** Every `userTask` carries both `create` listeners from §3.
6. **(checked, as a warning)** Every `activiti:class` appears in the §5 tables, or is a class you are
   shipping in a JAR. It is a warning rather than an error precisely because the editor cannot see
   your JAR — if the class is in one you have deployed, the warning is expected.
7. **(yours)** Every gateway condition value matches a form-property value exactly, including case.
   The form properties are not in this file, so nothing here can check it.
8. **(checked)** The process `id` matches the file name, which is what sets the deployed name.
   Whether that id is what you *intend* as the `processType` — and whether a DCR customization has
   kept `dataChangeRequestReview` — is still yours.
9. **(checked)** `isExecutable="true"`.
10. **(yours)** You have said, explicitly, whether this id already exists on the tenant — because if
    it does, deploying creates a new version of a live workflow rather than a new one. Only the
    tenant can answer this; compare against **Workflows → Process Definitions**.
11. **(checked)** A `<bpmndi:BPMNDiagram>` section is present, its plane's `bpmnElement` is the
    process `id`, and every flow element has a `BPMNShape` (§11).

Turning the report off, or changing how loudly the advisory items are reported, is
`reltio.bpmnDiagnosticsSeverity` in settings. The items Activiti rejects outright stay errors
regardless — that setting cannot hide a deploy that is going to fail.

## 11. Diagram interchange is not optional

The engine executes a definition with no diagram section perfectly well. Every **viewer** reads
nothing else. A definition without one opens as a blank canvas in the Reltio console, in Camunda
Modeler, in the bpmn.io-based editors, and in this extension's own **Show BPMN Diagram** preview —
so a workflow shipped without DI is one nobody can review.

```xml
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="myProcessId">
      <bpmndi:BPMNShape id="BPMNShape_start" bpmnElement="start">
        <omgdc:Bounds x="150" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="BPMNEdge_flow1" bpmnElement="flow1">
        <omgdi:waypoint x="186" y="118" />
        <omgdi:waypoint x="246" y="118" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
```

| Rule | Consequence of breaking it |
|---|---|
| The section sits inside `<definitions>`, **after** `</process>` | Inside the process, schema-aware readers reject the file |
| `BPMNPlane`'s `bpmnElement` is the process `id` | A plane pointing at a missing id renders nothing at all — this is what breaks a copied definition whose id was changed |
| Every flow element has a `BPMNShape` with `Bounds` | Partial DI is worse than none: the shapes present look correct, so the missing ones read as elements that are not in the workflow |
| Coordinates are plain numbers in the shapes' own space | There is no unit or transform to declare |
| Default sizes: event `36x36`, gateway `50x50`, task `100x80` | Other sizes are legal and look wrong beside a hand-drawn diagram — these match this extension's own generator (`src/workflow/bpmnDiagram.ts`), not the OOTB files' own numbers (event `35x35`, gateway `40x40`, task `105x55`), which is fine: DI sizing has no deploy consequence either way |
| Align vertical centres along a straight run | Connectors are then horizontal, which is what makes a generated diagram readable |

**New Workflow…** and **Duplicate as Draft…** both emit this section for you, so a draft created
through the IDE already satisfies item 11. You only have to write it by hand when you are authoring
the file directly.

## 12. Known Ambiguities / Needs Verification

This section separates three confidence levels: confirmed against the public Reltio Workflow source
or the official doc portal; our best inference from observed tenant/Activiti deploy behavior; and
genuinely unresolved — do not present that tier as fact. Flagging these because either sources
disagree, or a real Reltio-authored file contradicts a rule stated elsewhere in this document —
confirm with a Reltio Workflow SME, or test against a live tenant, before treating an item below as
settled.

1. **Whether the type task listener is mandatory on every user task, or only the process's first
   review step.** §3 defaults to putting both `TaskStartEventListener` and a type listener
   (`DCRTypeTaskListener`/`EntityTypeTaskListener`/`RelationTypeTaskListener`) on *every* `userTask`,
   citing `errorCode 10044` on omission. The canonical `dataChangeRequestReview.bpmn20.xml` and
   `PotentialMatchReview.bpmn20.xml` in the public repo support this on their (only) review task. But
   **`dcrTwoApprovals.bpmn20.xml`** — a Reltio-authored, Reltio-shipped variant of the *same* DCR
   review process, in the same repo — omits `DCRTypeTaskListener` entirely, on **all three** of its
   user tasks, including the first (`dcrReview`), keeping only `TaskStartEventListener` +
   `TaskAssignmentEventListener`. This directly contradicts treating the type listener as
   unconditionally required. Two live-shipped files from the same source disagree with each other,
   not just with an internal note, so this is not resolvable from documents alone. **Still default to
   including both listeners on every task** — the cost of an unnecessary listener is nothing, the
   cost of a missing one on a task that needed it is a runtime failure — but do not describe the
   second listener's omission as guaranteed to fail without testing it, and say so if a customer asks
   why a Reltio-shipped file omits it. **Resolution:** deploy a two-task variant with the type
   listener present on only the first task against a live tenant and observe whether the second task
   throws `errorCode 10044`, or ask a Reltio Workflow SME whether the type listener is only required
   once per process rather than once per task.
2. **`TaskStartEventListener` itself is not in question** — it appears on every `userTask` in every
   OOTB definition examined, with no exception, including `dcrTwoApprovals.bpmn20.xml`. Treat it as
   confirmed-mandatory independent of item 1.
3. **The exclusive-gateway `default` attribute's real-world enforcement.** §4.1 and §10.3 already
   treat a missing `default` as a warning, not an error, because a two-value enum's conditions are
   exhaustive. The public repo's own OOTB files confirm this is how Reltio itself authors these
   gateways: `dataChangeRequestReview.bpmn20.xml`'s and `PotentialMatchReview.bpmn20.xml`'s decision
   gateways, and two of the three gateways in `dcrTwoApprovals.bpmn20.xml`, carry **no** `default`
   attribute at all. Only the one gateway in `dcrTwoApprovals.bpmn20.xml` whose routing is not a
   simple two-value enum (`"Two approvals required?"`) sets one. This is confirmed, not ambiguous —
   listed here only so the citation is visible next to the rule it supports.
4. **Validator class package: two names for the same class.** §5's validator table points the task's
   `validator` form property at the `core.task.validator` package — confirmed by every OOTB BPMN
   file's literal form-property default value. The public repo's own source tree, however, puts
   classes of the same simple name (`DataChangeRequestValidator`, `PotentialMatchTaskValidator`)
   under a *different* package — one level under the same top-level tree as the listener classes.
   Whether this is a repackaging between the internal build and the public
   mirror, or the public source is simply stale relative to what tenants actually run, is unresolved.
   **Use `core.task.validator`** — it is what the shipped, deployed definitions reference, and
   mirrors the general principle "trust the artifact that gets deployed over the artifact that
   describes itself as a reference" — but do not assert the public repo's package name is wrong
   outright; say it disagrees, and why the deployed value wins.
5. **Discovered in the public source but not yet on this file's enforced tables.** The public repo
   defines a `RelationTypeTaskListener` (extends the same internal `TypeTaskListener` base as
   `DCRTypeTaskListener` and `EntityTypeTaskListener`, resolving a `relationType` variable instead)
   and a `SingleEntityTaskValidator` alongside the two validators §5 lists. Neither is in this
   extension's editor-enforced allow-list (`RELTIO_OOTB_CLASSES` in `src/workflow/bpmnDiagnostics.ts`)
   yet, and this file's own tables and that allow-list are kept in lockstep by a test — so adding
   either one to §5 without a matching code change would make the editor warn on a class this file
   just told an assistant to use. **Do not put either name in generated BPMN as an
   `activiti:class`/listener until a maintainer adds it to both places together** — treat their
   existence as confirmed, their availability in this workflow as not yet wired in.
6. **Error codes (`10044`, `13032`, `10002`) and the "hangs forever" / "silent no-op" failure modes**
   in §§2–3, §6–8 are **not stated anywhere in the official doc portal** — the portal's "Overview of
   Workflow Customizations" page shows an example listener but never states either listener is
   mandatory, and does not mention error codes at all. These rules are this team's own inference from
   observed tenant deploy behavior, not a documented platform contract. They are the most
   battle-tested rules in this file (each one traces to an actual rejected or misbehaving deploy), but
   "battle-tested against tenants we tested on" is a narrower claim than "documented platform
   behavior" — if a future Activiti/Reltio Workflow platform upgrade changes error codes or relaxes a
   constraint, this file will not know until someone hits it.

## 13. Official Reltio documentation — precedence

Official, citable pages exist for Reltio Workflow and BPMN customization at
[docs.reltio.com](https://docs.reltio.com/en/objectives/manage-workflow-tasks) and the public
[github.com/reltio-ai/workflow](https://github.com/reltio-ai/workflow) source repository — this is
**not** a case, unlike some other domains, where no official material exists. See
`references/reltio-doc-portal-reference.md` for the indexed page map and the extracted facts each
page states.

**If this file and the official docs or the public source repo disagree, the official docs / source
repo win** — flag the conflict in §12 rather than silently picking a side, the same way §12.1 and
§12.4 do for the two disagreements already found while writing this section.

## 14. The 4 fixed OOTB workflows and how each one actually triggers

There are exactly **4 fixed OOTB workflows** — DCR, PMR, Delete, and Authoring. Only one of them is
triggered by a literal button click; the other three are triggered by a system event, not a UI
action. This matters for the same reason the DCR row in §2 does: **none of these triggers let a
user or the platform pick which process to run.** Each one is hardcoded to start whichever process
id is currently configured for that flow on the tenant. Give any of them a different id and it
still deploys — it simply never runs, because nothing left is wired to start it (§10's undeployed-
customization failure mode, generalized to all four).

### 14.1 Data Change Request Review — `dataChangeRequestReview`

**Trigger:** the Hub UI's **Suggest** button. A user proposes a change to an entity, which creates a
Change Request, which auto-starts this workflow — `manualStart: false`; nobody manually kicks it
off. The exact id the button starts is not hardcoded to the literal string `dataChangeRequestReview`
but to the tenant's `dcr.processtype` setting, which **defaults** to `dataChangeRequestReview`:

```json
POST /workflow-adapter/workflow/{tenantId}/processInstances
{ "processType": "dataChangeRequestReview", "objectURIs": ["entities/{id}", "changeRequests/{id}"] }
```

### 14.2 Potential Match Review — `potentialMatchReview`

**Trigger:** the platform's own **matching engine**, not a person clicking anything. When Reltio's
match job identifies a pair of entities as potential duplicates, it starts this workflow
automatically so a human can decide **Merge** vs. **Not a Match**. There is no "run match review"
button in day-to-day use — a reviewer's only interaction is with the resulting task in their Inbox,
not with starting the process itself.

### 14.3 Recommend for Delete — `deleteReview`

**Trigger:** a "Recommend for Delete" action on an entity (or a bulk operation), which starts this
review before the delete actually happens. It is a gate, not something a reviewer initiates; the
reviewer's action is **Delete** vs. **Cancel** on the resulting task.

**Naming gotcha — confirmed, not inferred:** on some tenants this process is deployed as
`recommendForDelete` instead of `deleteReview`. It is the one OOTB workflow whose id is known to
vary by tenant. Always confirm the live id with `GET /processDefinitions` before assuming either
name; do not hardcode one in a skill, a prompt, or generated code.

### 14.4 Authoring — `authoring`

**Trigger:** profile creation or editing under governance — starts when someone creates or edits a
profile on a tenant configured to require authoring review, gating the change before it takes
effect.

### Summary

| Process | What starts it | Human decision |
|---|---|---|
| DCR | User clicks **Suggest** (`dcr.processtype`, default `dataChangeRequestReview`) | Approve / Reject |
| PMR | Match engine finds a duplicate pair | Merge / Not a Match |
| Delete | A delete is recommended (action or bulk op); id varies — `deleteReview` or `recommendForDelete` | Delete / Cancel |
| Authoring | A profile is created/edited under governance | Authoring-specific |

## Deny-list — never generate any of these

| Never | Why |
|---|---|
| `activiti:assignee="${reltioUser}"` | Silently null on UI-triggered workflows |
| `${initiator}` for the requester | Reltio never populates it |
| A `conditionExpression` on a gateway's `default` flow | Deploy rejected |
| An exclusive gateway with one outgoing flow | Deploy rejected |
| A `userTask` without both `create` listeners | `errorCode 10044` |
| `<multiInstanceLoopCharacteristics>` before `<extensionElements>` | `errorCode 13032` |
| A string method such as `count()` inside a gateway condition | Does not exist in JUEL; throws at runtime |
| A file name that is not exactly `*.bpmn20.xml` | `errorCode 10002` |
| A custom `<process id>` expected to auto-trigger from the HUB UI | None of the 4 fixed OOTB triggers (Suggest, the match engine, a delete recommendation, authoring review) will start it — they only ever start the tenant's configured id for that flow (§14) |
| Assuming Recommend-for-Delete is always deployed as `deleteReview` | Some tenants deploy it as `recommendForDelete` instead — confirm with `GET /processDefinitions`, don't assume (§14.3) |
| An invented `activiti:class` not in §5 and not in your own JAR | Deploys, then fails at runtime |
| A definition with no `<bpmndi:BPMNDiagram>` section | Deploys and runs; renders as a blank canvas in every viewer (§11) |
| A `BPMNPlane` whose `bpmnElement` is not the process `id` | The whole diagram silently fails to render |
