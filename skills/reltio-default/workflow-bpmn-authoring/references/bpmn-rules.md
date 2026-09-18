# BPMN rules for Reltio Workflow

Read this before writing a single line of BPMN XML. Every rule here exists because breaking it
produces a deploy rejection or a workflow that appears to work and does nothing.

The engine is **Activiti 5.x**. Anything valid in generic BPMN 2.0 but not listed here should be
treated as unsupported until proven otherwise on a tenant.

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
| A DCR customization **must keep** `id="dataChangeRequestReview"` | Any other id and the HUB/Inbox stops auto-triggering it; it can then only be started via API |
| `isExecutable="true"` always | A non-executable process deploys but never runs |
| Deploying an id that already exists creates **version N+1** of that process | New instances immediately use your version. This is how you replace a live workflow — including a Reltio built-in |

## 3. Every `userTask` needs both OOTB create listeners

Omitting either produces **`errorCode 10044`** at runtime. This applies to *every* user task in the
process, not only the first one — secondary review and clarification tasks included.

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

## 4. Gateways — four rules, all enforced at deploy

1. **Always set `default="<flowId>"`** on an exclusive gateway. Without it, an unexpected value
   matches no condition and the process hangs forever with no error.
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
| `com.reltio.workflow.activiti.service.DCRTypeTaskListener` | `create` |
| `com.reltio.workflow.activiti.service.EntityTypeTaskListener` | `create` (potential match) |
| `com.reltio.workflow.activiti.service.TaskAssignmentEventListener` | `assignment` |

**Validators**

| Class | Applies to |
|---|---|
| `com.reltio.workflow.core.task.validator.DataChangeRequestValidator` | DCR tasks |
| `com.reltio.workflow.core.task.validator.PotentialMatchTaskValidator` | Potential match tasks |

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

1. Every element `id` is unique within the process.
2. Every `sequenceFlow` has a `sourceRef` and `targetRef` that resolve to elements in this file.
3. Every exclusive gateway has a `default`, and that default flow carries no condition.
4. No gateway has fewer than two outgoing flows.
5. Every `userTask` carries both `create` listeners from §3.
6. Every `activiti:class` appears in the §5 tables, or is a class you are shipping in a JAR.
7. Every gateway condition value matches a form-property value exactly, including case.
8. The process `id` is what you intend as the `processType` — and if this is a DCR customization,
   it is `dataChangeRequestReview`.
9. `isExecutable="true"`.
10. You have said, explicitly, whether this id already exists on the tenant — because if it does,
    deploying creates a new version of a live workflow rather than a new one.

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
| A custom `<process id>` expected to auto-trigger from the HUB UI | The UI only ever starts `dataChangeRequestReview` |
| An invented `activiti:class` not in §5 and not in your own JAR | Deploys, then fails at runtime |
