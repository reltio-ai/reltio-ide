# Reltio doc portal & source reference — Workflow / BPMN

A curated, citable index of the official pages and the public source repository this domain has —
so an assistant can point to an authoritative link instead of only this team's own notes. Crawled
2026-09-22.

**Precedence:** if `bpmn-rules.md` and anything below disagree, the page or source file below wins.
Flag the conflict in `bpmn-rules.md` §12 rather than silently picking a side — see that section for
the two disagreements already found while building this file.

## Page map — docs.reltio.com

| Page | URL | Key content |
|---|---|---|
| Overview of Workflow Customizations | [link](https://docs.reltio.com/en/objectives/manage-workflow-tasks/workflow-management-at-a-glance/workflow-management-set-up/overview-of-workflow-customizations) | Listener/validator/service-task customization overview; one example `<userTask>` with a `create` listener |
| Overview of Workflow Configuration | [link](https://docs.reltio.com/en/objectives/manage-workflow-tasks/workflow-management-at-a-glance/workflow-management-set-up/overview-of-workflow-customizations/overview-of-workflow-configuration) | Workflow config concepts |
| Business process definition overview | [link](https://docs.reltio.com/en/objectives/manage-workflow-tasks/workflow-management-at-a-glance/workflow-management-reference/business-process-definition-overview) | Process `id`, `isExecutable`, `manualStart` data object; example uses `dataChangeRequestReviewComment` as its sample id (a variant, not evidence against `dataChangeRequestReview` as the DCR-review id — see `bpmn-rules.md` §2) |
| Workflow Modeler at a glance | [link](https://docs.reltio.com/en/applications/console/configuration-applications/workflow-modeler-at-a-glance) | The Workflow Modeler UI: open/import a BPMN diagram, edit visually; requires `ROLE_WORKFLOW_MANAGER` |
| Workflow Tasks | [link](https://docs.reltio.com/en/objectives/manage-workflow-tasks/workflow-management-at-a-glance/workflow-management-operation/workflow-tasks) | End-user task handling, not authoring |
| Workflow API | [link](https://docs.reltio.com/en/developer-resources/workflow-apis/workflow-apis-at-a-glance/workflow-api) | Workflow Adapter REST API path prefix (`{workflow environment url}/workflow`); this crawl found no deploy-endpoint payload detail — the extension's own `src/api/workflowAdapterClient.ts` contract was verified directly against a live adapter instead (see `docs/06-WORKFLOW-ADAPTER-AUTODISCOVERY.md` in the project handoff package, not this KB) |
| Setting Up the Reltio Workflow Adapter | [link](https://docs.reltio.com/workflow/setupwfadapter.html) | Local adapter install/debug — this is the source `workflow-local-adapter-setup/SKILL.md` should defer to for anything beyond what that playbook already states |

## Source repository — github.com/reltio-ai/workflow

The public **Reltio Workflow Service repository** is the workflow domain's equivalent of the LCA
framework's `ILifeCycleAction.java` — real, redistributable source, not a summary of it.

| Path | Content |
|---|---|
| `default process definitions/DataChangeRequestReview/DataChangeRequestReview.bpmn20.xml` | The canonical, single-task DCR review process — confirms the namespace block, the `dataChangeRequestReview` id, both `create` listeners on its one task, and DI placement |
| `default process definitions/DataChangeRequestReview/dcrTwoApprovals.bpmn20.xml` | A Reltio-shipped two-approval variant — see `bpmn-rules.md` §12.1, the source of the type-listener ambiguity |
| `default process definitions/PotentialMatchReview/PotentialMatchReview.bpmn20.xml` | Confirms `EntityTypeTaskListener` and the `Merge`/`NotAMatch` service tasks |
| `default process definitions/DeleteReview/`, `Authoring/` | Further OOTB variants, not yet cross-checked against every rule in this file |
| `src/workflow-custom/.../com/reltio/workflow/activiti/service/*.java` | Source for every service task and listener class in `bpmn-rules.md` §5 |
| `src/workflow-custom/.../com/reltio/workflow/activiti/service/validators/*.java` | Validator class *names* — see `bpmn-rules.md` §12.4 for the package-name discrepancy against the deployed form-property value |
| `src/workflow-api/` | The public `workflow-api`/`workflow-custom` Maven artifacts referenced in `workflow-jar-customization/SKILL.md` |

## Access notes

- The doc portal pages crawled here are narrative/customization guides, not a request/response API
  reference — they do not state error codes, gateway-default enforcement, or the mandatory-listener
  rule as a platform contract. `bpmn-rules.md` §12.5 is explicit about which rules that leaves as
  this team's own inference rather than a documented one.
- The GitHub repository is the stronger source for anything about real class names, real OOTB
  process definitions, or real deploy-time XML shape — prefer it over the doc portal's narrative
  examples when the two differ, and prefer either over this team's own notes.
- Re-crawl periodically; doc-portal pages carry their own "Updated" metadata and move independently
  of this file.
