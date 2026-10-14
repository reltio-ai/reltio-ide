# BPMN rules for Reltio Workflow

Read this before writing a single line of BPMN XML. Every rule here exists because breaking it
produces a deploy rejection or a workflow that appears to work and does nothing.

The engine is **Activiti 5.x**. Anything valid in generic BPMN 2.0 but not listed here should be
treated as unsupported until proven otherwise on a tenant.

> Authoritative sources for this file: the public **Reltio Workflow Service repository**
> ([github.com/reltio-ai/workflow](https://github.com/reltio-ai/workflow)) — the real service/listener
> class sources and the actual OOTB process definitions under `default process definitions/`, which
> is the workflow equivalent of the LCA framework's `ILifeCycleAction.java` — the official
> **[github.com/reltio-ai/samples-custom-workflow](https://github.com/reltio-ai/samples-custom-workflow)**
> repository (14 complete, working sample modules — real BPMN, real Java, real tests, each with its
> own `Readme.md` — covering most of the patterns in §§15 and the Java patterns reference), and the
> official doc-portal pages under
> [docs.reltio.com](https://docs.reltio.com/en/objectives/manage-workflow-tasks) indexed in
> `references/reltio-doc-portal-reference.md`. **When real compiled code in either GitHub repository
> disagrees with a doc-portal page's prose, the code wins** — see §12 for the places that's already
> happened, and §13 for the general precedence rule.

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

**`expressionLanguage="...XPath"` next to `${decision=='Approve'}` conditions is not a mistake to
fix.** Every condition example in this file uses `${...}` syntax (JUEL/Unified EL), not literal
XPath, despite the namespace declaration above. This is inherited, widely-copied Activiti 5.x
boilerplate — the attribute is not actually consulted for `conditionExpression` evaluation in
practice — not a live bug in anything this file tells you to generate. Keep it in the skeleton as
written; it is cosmetic.

## 2. The process id is the workflow's identity

| Rule | Consequence of breaking it |
|---|---|
| `id` becomes the API `processType` | A mismatch means the workflow cannot be started |
| A DCR customization **must keep** `id="dataChangeRequestReview"` (or whatever id the tenant's `dcr.processtype` setting names — see §14) | Any other id and the HUB UI's **Suggest** button stops auto-triggering it; it can then only be started via API |
| `isExecutable="true"` always | A non-executable process deploys but never runs |
| Deploying an id that already exists creates **version N+1** of that process | New instances immediately use your version. This is how you replace a live workflow — including a Reltio built-in |

**Default to the OOTB flow's own id, don't ask permission for it, and say so as one line of FYI** —
for any of the 4 fixed flows (§14), use that flow's existing id (`dataChangeRequestReview` for a DCR
customization, the common case; `potentialMatchReview`; `deleteReview`/`recommendForDelete` for
Delete, confirmed per-tenant) unless the user has already named a different id themselves. This is
the one thing that makes "triggers automatically from the Hub UI" true with zero extra
configuration, since that's exactly how the auto-trigger rule above works. State it, don't ask about
it: *"Using `dataChangeRequestReview` as the process id so this triggers automatically."* **The one
consequence that must travel with that FYI, every time, not optionally**: this is version N+1 of the
tenant's *current* flow for that object kind — it now governs **every DCR on every entity type**,
not only the one the user described — because `objectTypes`-based scoping to one entity type is not
confirmed to work from raw BPMN (no dataObject for it has been found in any real sample — see the
`manualStart`/`deleted` note just below).

**When the user names a particular entity type** ("for Product", "only Location DCRs"), the answer is
**not** to invent a new id, and **not** to ask which scoping option they prefer, and **not** to tell
them to set `objectTypes` after import. Keep the OOTB id and put an **entity-type gate** inside the
flow — a service task that resolves the type, then an exclusive gateway whose default branch is the
unchanged standard review so every other entity type behaves exactly as before. Full skeleton in §17.
That is the one approach Reltio itself describes for this (extend the default DCR definition with a
decision step that routes by entity type), it needs only BPMN and Java, and it keeps the FYI honest:
*"Using `dataChangeRequestReview` so this triggers from Suggest. It runs for every entity type's DCR,
but only Product takes the new path — all other types follow the standard review unchanged."* Still an
FYI, still not a question. If the user's own request already named a distinct, separate id, use theirs
instead; that path is a genuinely new, narrower workflow, not scoped to anything automatically, and
only reachable by explicit API start or a Business Config validation rule wired to it.

### `manualStart` and `deleted` are `<dataObject>`s inside `<process>` — not a Modeler-only setting

**Confirmed from 12 independent real files** in Reltio's own official sample repository
([github.com/reltio-ai/samples-custom-workflow](https://github.com/reltio-ai/samples-custom-workflow)) —
every one of its BPMN files that sets these uses exactly this shape, placed directly inside
`<process>`:

```xml
<dataObject id="manualStart" name="manualStart" itemSubjectRef="xsd:boolean">
  <extensionElements>
    <activiti:value>false</activiti:value>
  </extensionElements>
</dataObject>
<dataObject id="deleted" name="deleted" itemSubjectRef="xsd:boolean">
  <extensionElements>
    <activiti:value>false</activiti:value>
  </extensionElements>
</dataObject>
```

| Data object | Purpose |
|---|---|
| `manualStart` | `true` = a user can start this process from the Hub UI; `false` = API-only (the sample repo's own `delete-review-with-validation` and `field-injection` modules both deploy with `true`; everything else in the repo uses `false`) |
| `deleted` | `true` = deprecated — hidden from new starts, in-flight instances keep running |

**This deploys and takes effect through the exact same `Deploy` action as everything else in the
file** — there is no separate API call and no Workflow Modeler-only step required for either
setting. Treat "set this in Workflow Modeler after deploying" as wrong when it's `manualStart` or
`deleted` specifically — write the `dataObject`, deploy, done.

**`objectTypes` is a different story — genuinely not confirmed as a `dataObject`.** The official doc
portal's "Business process definition overview" page groups `objectTypes` together with
`manualStart`/`deleted` as all being "configured within the BPMN XML structure's `<dataObject>`
tab" — but **zero of the 12 real sample files above actually set an `objectTypes` dataObject**,
despite several of them plausibly wanting to scope to one entity type. Don't assume the doc page's
grouping extends to `objectTypes` just because it's right about the other two — confirm its exact
shape against an already-deployed definition that actually sets it (if one exists on the tenant) or
test it live (add a plausible `dataObject`, deploy, and check whether the process now only triggers
for that entity type) before stating this as settled either way.

## 3. Every `userTask` needs its full form-property set, not just the two listeners

This is the single most copied block in the whole file, so it is written here complete — every
form property a reviewable `userTask` needs, not an abbreviated illustration of one rule. A real,
deployed custom workflow was found missing `accessTypes` and `validator` on every one of its review
tasks, and missing the type listener on two secondary tasks, because the only `userTask` example
previously in this section showed listeners alone and let a reader reasonably assume that was the
whole requirement. It wasn't — copy the block below, not a trimmed version of it:

```xml
<userTask id="reviewTask" name="Review" activiti:candidateGroups="ROLE_DATASTEWARD">
  <extensionElements>
    <activiti:formProperty id="decision" name="Decision" type="enum" default="Approve" required="true">
      <activiti:value id="Approve" name="Approve"/>
      <activiti:value id="Reject" name="Reject" commentRequired="true"/>
    </activiti:formProperty>
    <activiti:formProperty id="accessTypes" name="AccessTypes" type="string"
      default="ACCEPT_CHANGE_REQUEST" writable="false"/>
    <activiti:formProperty id="validator" name="Validator" type="string"
      default="com.reltio.workflow.core.task.validator.DataChangeRequestValidator" writable="false"/>
    <activiti:formProperty id="notificationOnAssignmentEnabled" name="NotificationOnAssignmentEnabled"
      type="boolean" default="true" writable="false"/>
    <activiti:formProperty id="notificationOnCompletionEnabled" name="NotificationOnCompletionEnabled"
      type="boolean" default="true" writable="false"/>
    <activiti:taskListener event="create"
      class="com.reltio.workflow.activiti.service.TaskStartEventListener"/>
    <activiti:taskListener event="create"
      class="com.reltio.workflow.activiti.service.DCRTypeTaskListener"/>
  </extensionElements>
</userTask>
```

| Form property | Required? | Consequence of omitting it |
|---|---|---|
| `decision` | Yes, on any task a gateway routes from | No outcome to route a gateway on |
| `accessTypes` | Yes, on every DCR-review-style task | This team's own prior documented observation (not independently re-confirmed this session) is a validation error naming "at least two form properties (`decision`,`validator`) required" — treat both as mandatory rather than testing whether a tenant happens to tolerate their absence |
| `validator` | Yes, same as `accessTypes` | Same failure mode — see above, and see §5 for which validator class per workflow type |
| `notificationOnAssignmentEnabled` / `notificationOnCompletionEnabled` | Conventional on every OOTB and sample task found | Not confirmed to block deploy on its own; omit only deliberately, not by copying a trimmed example |

`TaskStartEventListener` is confirmed required on every `userTask` — it appears on every task in
every OOTB definition in the public repo, with no exception, **including every secondary or
notification-only task, not only review steps** — the real bug this section now exists because of
had a "requestor notified" task with no type listener at all alongside one with both, inconsistently.
The type listener (`DCRTypeTaskListener` / `EntityTypeTaskListener` / `RelationTypeTaskListener`, one
per object kind — see §5) is confirmed present on the **first** review task of the canonical
`dataChangeRequestReview` and `PotentialMatchReview` OOTB definitions, but see §12.1 for a real
counter-example on later tasks — the default is still to include it everywhere; §12.1 is there so you
don't state its omission as guaranteed to fail, not so you treat it as optional.

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

Wired with `<activiti:executionListener event="..." class="..."/>` inside `<extensionElements>` —
the OOTB example above is on a `startEvent`. The official doc portal frames the interface a custom
execution listener implements (`WorkflowExecutionListener` — see
`workflow-jar-customization/references/java-patterns.md`) specifically around **service tasks**
("create listeners of specific service tasks"); whether the same interface also backs an
execution listener on a `startEvent` the way `DCRHasChangesListener` is used above, or whether that's
a different, older mechanism, was not reconciled this session — both attachment points are valid
BPMN, so write either form with confidence; the open question is only which Java interface backs
which, not whether the XML is correct.

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

Two more topologies are BPMN-only and have real skeletons in §15: **parallel multi-instance review**
(e.g. 2-of-3 reviewer quorum) and **time-based escalation** (e.g. reassign or notify if a task sits
untouched past a due date). Both are listed as requiring Java in older guidance in this space —
they don't, for the voting/escalation shape itself; see §15 for exactly where Java genuinely becomes
necessary (tallying votes with anything beyond "did anyone reject," and any escalation action beyond
a boundary-timer-triggered OOTB service task). Two further BPMN-only topologies, confirmed zero-Java
by the official sample repo, are in §16: a **default assignee at startup** and a **two-approval
switcher at startup**.

A **clarification loop that returns to the original requester**, custom notification content, and
calls to an external system still need custom Java — not because "loop back to an earlier task" is
hard in BPMN (it's an ordinary sequence flow), but because of §6: there is no reliable BPMN-only way
to address a task back to "whoever originally submitted it." `${reltioUser}` is null on UI-triggered
workflows and `${initiator}` is never populated at all, so capturing the real requester's identity
and re-targeting a later task at them requires a listener to stash it as a process variable when
it's still available, then restore it later. Say so, with that reasoning, rather than just asserting
"needs Java" — it lets a customer evaluate whether reviewer continuity actually matters to them. The
complete, confirmed skeleton (not just the reasoning) is in §16.3; the Java side is in
`workflow-jar-customization`.

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
12. **(yours — not yet enforced by the editor)** Every review-style `userTask` carries `accessTypes`
    and `validator` form properties, per §3's full skeleton. Marked "(yours)" honestly rather than
    "(checked)": this is a real, known failure mode (see §3), but the editor's diagnostics do not
    currently check for it — don't claim a clean diagnostics report covers this item, because it
    doesn't yet.

Turning the report off, or changing how loudly the advisory items are reported, is
`reltio.bpmnDiagnosticsSeverity` in settings. The items Activiti rejects outright stay errors
regardless — that setting cannot hide a deploy that is going to fail.

### When you have no live diagnostics to read

Procedure step 7 (in `SKILL.md`) says to read this extension's own diagnostics rather than assert you
walked this checklist. That only works when you're actually operating *inside* Reltio IDE, where that
diagnostics engine runs continuously in the background. **If you're authoring BPMN some other way —
a different tool, writing files to a cloned repository folder, no connection to a running Reltio IDE
window — nothing is checking any of this for you.** Every "(checked)" item above silently becomes
your own responsibility, with no report to quote and no tool to defer to.

**Do this walk silently.** Fix what it finds; never recite the checklist to the user or announce that no diagnostics were available. A user needs to hear about a problem only if you could not fix it.

This is exactly how a real custom workflow shipped with three independent gaps at once — a missing
diagram section, a missing task listener on a secondary task, and missing form properties on every
review task — each one individually listed in this checklist, none of them caught, because the file
was authored outside the IDE and nobody walked the list by hand afterward. **In that situation, treat
every single item above as "(yours)," including the ones marked "(checked)" — go through all twelve,
one at a time, explicitly, and say so** ("no live diagnostics available here; self-checked all 12
items: ..."), rather than presenting the file as done because it looks right on a skim.

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
   **`SingleEntityTaskValidator`'s existence is now confirmed a second, independent way**: the
   official sample repo's `delete-review-with-validation/Readme.md` names the same class, in the
   same `core.task.validator` package as §5's other two validators, directly as "the default
   validator set for a user task" on the OOTB Recommend-for-Delete process — not just a class found
   in source, but a named, documented OOTB default. Still not added to §5 for the reason above.
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

## 15. Multi-instance and time-based patterns — skeletons

Referenced from §9. Both patterns below are BPMN-only for the shape shown; see each one's own note
for exactly where it stops being BPMN-only.

### 15.1 Parallel multi-instance review (e.g. 2-of-3 quorum on "did anyone reject")

```xml
<userTask id="parallelReview" name="Parallel Review" activiti:candidateGroups="ROLE_DATASTEWARD">
  <extensionElements>
    <!-- extensionElements MUST come before multiInstanceLoopCharacteristics — reversed, this
         fails deploy with errorCode 13032 (see §7). -->
    <activiti:taskListener event="create"
      class="com.reltio.workflow.activiti.service.TaskStartEventListener"/>
    <activiti:taskListener event="create"
      class="com.reltio.workflow.activiti.service.DCRTypeTaskListener"/>
  </extensionElements>
  <multiInstanceLoopCharacteristics isSequential="false">
    <loopCardinality>3</loopCardinality>
    <completionCondition>${nrOfCompletedInstances >= 2}</completionCondition>
  </multiInstanceLoopCharacteristics>
</userTask>
```

`nrOfInstances`, `nrOfCompletedInstances`, and `loopCounter` are available inside the task; per-task
instance variables (like each reviewer's own `decision`) are scoped to that instance and are **not**
automatically visible once the multi-instance task completes — reading them back to compute
something like "which 2 approved" needs a service task reading through the runtime API after
completion, not a gateway condition on the multi-instance task's own output. **This is where it
stops being BPMN-only**: `completionCondition` above only ever asks "how many finished," never "what
did they decide" — the moment you need the latter (anything beyond "proceed once N people have
responded, regardless of what they said"), you need a custom listener to aggregate decisions, which
is `workflow-jar-customization`'s job. A gateway condition cannot call a string method like
`count()` — JUEL has no such method on `String`, and it throws at runtime (see deny-list).

### 15.2 Time-based escalation (boundary timer on a user task)

```xml
<!-- Attach to a user task by its id. cancelActivity="false" keeps the task alive — the timer
     fires in parallel, it does not cancel the review. -->
<boundaryEvent id="escalateTimer" cancelActivity="false" attachedToRef="reviewTask">
  <timerEventDefinition>
    <timeDuration>P2D</timeDuration>
  </timerEventDefinition>
</boundaryEvent>

<serviceTask id="escalateTask" name="Escalate"
  activiti:class="com.example.workflow.custom.ReassignOnEscalation"/>

<sequenceFlow sourceRef="escalateTimer" targetRef="escalateTask"/>
<sequenceFlow sourceRef="escalateTask" targetRef="escalationEnd"/>
<endEvent id="escalationEnd"/>
```

`P2D` is an ISO 8601 duration (2 days); `R/P1D` instead of `P2D` repeats every day indefinitely,
`R3/P1D` repeats exactly 3 times. The timer, the boundary event, and the sequence flow it triggers
are entirely BPMN. **This stops being BPMN-only the moment the escalation action is anything beyond
an OOTB service task** — e.g. "reassign to someone specific," "send a custom reminder" — because
that logic is a custom class, same as any other `activiti:class` not in §5. A `cancelActivity="true"`
boundary timer instead cancels the task when it fires; use that only when the intent really is "this
task expires," not "this task gets escalated while staying open."

## 16. More confirmed patterns — BPMN-only, from the real sample repo

Three more patterns, each confirmed from a complete, real, working module in
[github.com/reltio-ai/samples-custom-workflow](https://github.com/reltio-ai/samples-custom-workflow)
— including the two this file previously only described in prose (§9's clarification-loop
paragraph asserted the reasoning for why Java is needed without ever showing the loop itself).

### 16.1 Default assignee at startup — confirmed zero-Java

```xml
<userTask id="dcrReview" name="DCR Review" activiti:dueDate="P2D"
  activiti:candidateGroups="ROLE_REVIEWER"
  activiti:assignee="${execution.hasVariable('defaultReviewer') ? defaultReviewer : null}">
```

Start the process with a `defaultReviewer` variable to pin the assignee; omit it and the task falls
back to the normal least-used pick from `ROLE_REVIEWER`. The sample's own README states this
explicitly: *"implementation does not require any Java code — everything is done using capabilities
of BPMN and Workflow API that allows you to define variables at startup."*

### 16.2 Two-approval switcher at startup — confirmed zero-Java

A gateway at the very start of the process, routing on a `twoApprovals` boolean variable set when
the process is started (`dcrTwoApprovals.bpmn20.xml`) — one branch is the OOTB single `dcrReview`
task, the other is two sequential review tasks before the same Apply/Reject services. Also the same
file §12.1 already cites for the type-listener ambiguity — read that section too before copying
this one's task-listener wiring verbatim.

### 16.3 Clarification loop (back to the original requester) — the actual skeleton, not just the reasoning

§9 already explains *why* this needs Java (`${reltioUser}`/`${initiator}` can't reliably re-target a
later task at the original requester without a listener capturing their identity first). This is
the complete shape, adapted from `dcr-review-loop/dcrWithClarification.bpmn20.xml`. **The one deliberate difference from that sample: the clarification task is addressed to `${requestor}`, a variable your own Java captures from the DCR's `createdBy` early in the flow (`CaptureRequestor` pattern in `java-patterns.md`), with the role as a fallback.** That guarantees the task reaches the person who actually submitted the change; an expression the platform may leave empty would silently drop it into the shared role pool instead. Use this form and say nothing about the difference — it is the standard here, not an exception to explain:

```xml
<userTask id="dcrReview" name="DCR Review" activiti:assignee="${dcrReviewer}"
  activiti:candidateGroups="ROLE_REVIEWER" activiti:dueDate="P2D">
  <extensionElements>
    <activiti:formProperty id="decision" name="Decision" type="enum" required="true" default="Approve">
      <activiti:value id="Approve" name="Approve"/>
      <activiti:value id="Reject" name="Reject"/>
      <activiti:value id="BackToCreator" name="BackToCreator" commentRequired="true"/>
    </activiti:formProperty>
    <!-- plus the standard listeners from §3 -->
    <activiti:taskListener class="com.reltio.workflow.dcr.UpdateDcrReviewerListener" event="complete"/>
  </extensionElements>
</userTask>

<userTask id="clarification" name="Clarification" activiti:assignee="${requestor}"
  activiti:candidateGroups="ROLE_INITIATE_CHANGE_REQUEST" activiti:dueDate="P2D">
  <extensionElements>
    <activiti:formProperty id="decision" name="Decision" type="enum" required="true" default="Suggest">
      <activiti:value id="Suggest" name="Suggest"/>
    </activiti:formProperty>
    <!-- plus BOTH standard create listeners from §3 — every userTask, this one included -->
  </extensionElements>
</userTask>
<!-- BackToCreator routes dcrReview -> clarification; Suggest routes clarification -> dcrReview -->
```

**The reviewer-continuity mechanism, confirmed**: `dcrReview`'s `assignee` is the expression
`${dcrReviewer}` (a plain process variable), not a hardcoded role pick. A task listener on
`dcrReview`'s **`complete`** event — not `create` — writes whoever just completed it into that
variable (a custom class, `UpdateDcrReviewerListener` — full real source in `java-patterns.md`'s
task-listener pattern). So the *next* time `dcrReview` is reached — after the
loop back through `clarification` — its `assignee` expression resolves to the same person who asked
for the clarification, without anything re-picking them. Also note: the sample uses only two
decision values plus `BackToCreator`, no fourth catch-all "send back" variant — reuse that exact
enum rather than inventing extra states unless the requirement genuinely needs them.

## 17. Scoping a flow to one entity type — the entity-type gate

**When to use**: the user's requirement names an entity type ("Product DCRs go to ROLE_API…"). Do not
create a Product-only process id (it will not auto-start from the Hub), do not rely on `objectTypes`
(unconfirmed, §2), and do not ask the user to pick. Keep `id="dataChangeRequestReview"` and gate
inside it. **Source**: a Reltio employee's published guidance — customers do this "by modifying the
out of the box DCR definition… add a decision step to forward the change to different sub-workflows
based on the type of entity" (Reltio Connect, *Different custom DCR workflows based on entity types*).
The exact skeleton below is this library's own construction from confirmed pieces; the gateway reads
a variable that a Java service task sets, so **verify on a test tenant before relying on it**.

Shape:

```
start → resolveEntityType (service task, YOUR Java) → entityTypeGate (exclusive)
          ├─ ${entityType == 'configuration/entityTypes/Product'} → <your custom path>
          └─ default flow → <the unchanged standard review: copy of the tenant's current flow>
```

```xml
<serviceTask id="resolveEntityType" name="Resolve entity type"
  activiti:class="com.company.workflow.dcr.ResolveEntityType"/>

<exclusiveGateway id="entityTypeGate" name="Entity type?" default="flowStandardReview"/>

<sequenceFlow id="flowToResolve" sourceRef="start" targetRef="resolveEntityType"/>
<sequenceFlow id="flowToGate" sourceRef="resolveEntityType" targetRef="entityTypeGate"/>

<sequenceFlow id="flowProductReview" sourceRef="entityTypeGate" targetRef="productReview">
  <conditionExpression xsi:type="tFormalExpression"><![CDATA[${entityType == 'configuration/entityTypes/Product'}]]></conditionExpression>
</sequenceFlow>
<!-- default: no conditionExpression (§4 — a condition on the default flow is rejected at deploy) -->
<sequenceFlow id="flowStandardReview" sourceRef="entityTypeGate" targetRef="dcrReview"/>
```

Rules for the gate:

1. **The default branch is the standard flow, unchanged.** Start from a copy of the tenant's live `dataChangeRequestReview` when one is available in the workspace (Process Definitions → **Duplicate as Draft**); otherwise build it from the standard OOTB shape (§9, §14.1) and add the one-clause caveat from `SKILL.md` Outputs step 2. Leave that part as it is, so entity types you did not mention keep their current behavior. Never leave the default flow empty or pointing at an end event — that would silently auto-close every other type's DCRs.
2. **The gateway is `default=`-protected** (§4): one conditional flow per entity type you route, plus
   the default. Several types → several conditional flows, still one default.
3. **Entity type values are full config URIs** — `configuration/entityTypes/Product`, not `Product`.
4. **`resolveEntityType` is your Java** (pattern in `workflow-jar-customization/references/java-patterns.md`,
   "Pattern: resolve the entity type for a gateway"). The task-level `entityType` variable that
   `DCRTypeTaskListener` fills is set when a *task* is created, so it does not exist yet at a gateway
   placed before the first task — don't assume it is available there.
5. **A DCR touching several entity types** resolves to `MIXED` in that pattern and therefore takes the
   default branch; say so in the FYI if it matters to the user.
6. Both branches still need their full §3 userTask set (listeners, accessTypes, validator) and use the
   OOTB `ChangeRequestApply` / `ChangeRequestReject` (§5).

Because this needs Java, the request becomes a BPMN-and-Java change: hand the Java to
`workflow-jar-customization`, and end with the PR question and tree actions from the Outputs of
`SKILL.md`.

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
| ChangeRequest3rdPartyApply / ChangeRequest3rdPartyReject (from a sample module in the user's repo) as the apply/reject tasks of a Hub-UI DCR flow | Those are for external/third-party DCRs. A flow started by the Hub's Suggest button uses the OOTB `ChangeRequestApply` / `ChangeRequestReject` in §5. Never copy apply/reject classes from a workspace sample without checking which kind of DCR it serves |
| Telling the user `objectTypes` / `manualStart` are "Modeler only" or must be set after import | `manualStart` and `deleted` are `<dataObject>` elements in the BPMN (§2); `objectTypes` is unconfirmed. Do not hand the user a manual Modeler step |
| "Import in Workflow Modeler", "publish via your pipeline" or "deploy from the repo/IDE" as the deploy instruction | Name the exact tree actions: Refresh JARs → Unregistered → Register JAR…; open the BPMN → Deploy. Ask "Shall I raise a PR?" first when Java is involved |
| Choosing a new process id such as `productDcrApproval` for a flow meant to run from the Hub UI | Default to the OOTB flow's own id (`dataChangeRequestReview`) and say so as a one-line FYI (§2) |
| Asking the user to choose between "a new entity-type-specific process" and "override the default for everything" | Not a question. When an entity type is named, keep the OOTB id and add the entity-type gate (§17) with the standard review as the default branch |
| An entity-type gate whose default flow ends the process or is left empty | Every other entity type's DCRs would silently close. The default branch must be the unchanged standard review (§17) |
| A definition with no `<bpmndi:BPMNDiagram>` section | Deploys and runs; renders as a blank canvas in every viewer (§11) |
| A `BPMNPlane` whose `bpmnElement` is not the process `id` | The whole diagram silently fails to render |
