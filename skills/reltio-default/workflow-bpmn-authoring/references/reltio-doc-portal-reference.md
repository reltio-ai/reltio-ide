# Reltio doc portal & source reference — Workflow / BPMN

A curated, citable index of the official pages and the public source repository this domain has —
so an assistant can point to an authoritative link instead of only this team's own notes. Crawled
2026-09-22; re-crawled 2026-10-03 for the Java-customization and local-adapter-setup pages, which
were previously only indexed, not actually fetched for content.

**Precedence:** if `bpmn-rules.md` and anything below disagree, the page or source file below wins.
Flag the conflict in `bpmn-rules.md` §12 rather than silently picking a side — see that section for
the two disagreements already found while building this file, and
`workflow-jar-customization/references/java-patterns.md`'s own Known Ambiguities section for two
more found on the 2026-10-03 re-crawl.

## Page map — docs.reltio.com

| Page | URL | Key content |
|---|---|---|
| Overview of Workflow Customizations (objectives path) | [link](https://docs.reltio.com/en/objectives/manage-workflow-tasks/workflow-management-at-a-glance/workflow-management-set-up/overview-of-workflow-customizations) | Listener/validator/service-task customization overview; one example `<userTask>` with a `create` listener |
| Overview of Workflow Customizations (engage path) | [link](https://docs.reltio.com/en/engage/manage-data-workflows/overview-of-workflow-customizations) | **Fetched directly 2026-10-03 — this is where the real content lives.** Confirms `WorkflowTaskListener`/`WorkflowExecutionListener` as the two listener interfaces, a validator's `doValidate(TaskValidationInfo taskInfo): boolean throws InvalidTaskException` signature, `ROLE_WORKFLOW`/`ROLE_WORKFLOW_MANAGER`, JDK 17, and a stated 70% test-coverage minimum. Full extraction in `workflow-jar-customization/references/java-patterns.md`. **Not confirmed whether this and the row above are the same content reachable by two nav paths, or genuinely different revisions** — cite this one; it's the one actually fetched. |
| Workflow FAQ | [link](https://docs.reltio.com/en/engage/manage-data-workflows/overview-of-workflow-customizations/workflow-faq) | **Fetched directly 2026-10-03.** Confirms: Sonar + Snyk run automatically on every pull request (answers "what does the review pipeline actually check"); a JAR can be registered across multiple tenants and its classes used in multiple workflows (one JAR ≠ one tenant ≠ one workflow); multi-module Maven repos are an officially documented way to ship multiple custom workflows from one repository; version bumps are recommended to avoid silently overwriting a registered JAR. See `workflow-repo-contribution/SKILL.md`. |
| Overview of Workflow Configuration | [link](https://docs.reltio.com/en/objectives/manage-workflow-tasks/workflow-management-at-a-glance/workflow-management-set-up/overview-of-workflow-customizations/overview-of-workflow-configuration) | Workflow config concepts |
| Business process definition overview | [link](https://docs.reltio.com/en/objectives/manage-workflow-tasks/workflow-management-at-a-glance/workflow-management-reference/business-process-definition-overview) | Process `id`, `isExecutable`, `manualStart` data object; example uses `dataChangeRequestReviewComment` as its sample id (a variant, not evidence against `dataChangeRequestReview` as the DCR-review id — see `bpmn-rules.md` §2) |
| Workflow Modeler at a glance | [link](https://docs.reltio.com/en/applications/console/configuration-applications/workflow-modeler-at-a-glance) | The Workflow Modeler UI: open/import a BPMN diagram, edit visually; requires `ROLE_WORKFLOW_MANAGER` — independently reconfirmed by the Java-customization page above, which also names it as the role required "to publish process definitions" |
| Workflow Tasks | [link](https://docs.reltio.com/en/objectives/manage-workflow-tasks/workflow-management-at-a-glance/workflow-management-operation/workflow-tasks) | End-user task handling, not authoring |
| Workflow API | [link](https://docs.reltio.com/en/developer-resources/workflow-apis/workflow-apis-at-a-glance/workflow-api) | Workflow Adapter REST API path prefix (`{workflow environment url}/workflow`); this crawl found no deploy-endpoint payload detail — the extension's own `src/api/workflowAdapterClient.ts` contract was verified directly against a live adapter instead (see `docs/06-WORKFLOW-ADAPTER-AUTODISCOVERY.md` in the project handoff package, not this KB) |
| Setting Up the Reltio Workflow Adapter | [link](https://docs.reltio.com/workflow/setupwfadapter.html) | **Fetched directly 2026-10-03 — confirmed to be an index/table-of-contents page, not a content page.** It links to (but this crawl did not fetch, to avoid guessing at unconfirmed child URLs) sections titled "Setting up JAVA HOME variables," "Install MariaDB server," and "Debugging a custom JAR file" — these section titles are confirmed real; their content is not yet indexed here. `workflow-local-adapter-setup/SKILL.md` should defer to the real child pages for anything its own content doesn't already state, and flags where it's currently guessing in their absence. |

## Also provisioned directly to every customer (not a doc-portal page, but equally authoritative)

**`com.reltio.workflow:reltio-custom-workflows-archetype`** — the actual Maven archetype Reltio uses
to generate a customer's Bitbucket repository. Read directly (not summarized from a doc) during the
2026-10-03 pass. Confirms: exactly one Maven module (`custom-workflow`) on first generation, zero
BPMN files ever provisioned, the real `pom.xml` (dependency versions, shade-plugin config, the
80%-line-coverage JaCoCo gate — see the coverage-number discrepancy this creates against the Workflow
FAQ's stated 70%, in `java-patterns.md`'s Known Ambiguities), a per-customer S3 path convention
(`reltio.workflow-custom-jars/<customer>/`) and JAR-ready email notification list in
`repository.properties`, and a Bitbucket Pipelines config importing shared `pr-checks`/`deploy`
steps from a separate Reltio-owned pipeline repository. Its own `README.md` is the source for "add
one sub-module per additional custom workflow" — see
`docs/custom-workflow-repo-tree-design-explainer.md` in this repo for why that matters to the
Custom Workflow Repository tree's design.

## Source repository — github.com/reltio-ai/samples-custom-workflow

**The single highest-value source this skill set cites, added 2026-10-05.** 14 complete, working
sample modules — real BPMN, real Java, real unit tests, each with its own `Readme.md` and a diagram
— covering most of the patterns this skill set documents. Cloned and read directly, not summarized
from a listing:

| Module | What it's a real, working example of |
|---|---|
| `delete-review-with-validation/`, `due-date-validator/` | A real `TaskValidator` (two independent copies, identical interface) |
| `dcr-review-loop/` | The clarification/back-to-creator loop, with real reviewer-continuity capture (`dcrReviewer` dataObject + `UpdateDcrReviewerListener`) |
| `parallel-approve/` | Real multi-instance quorum: unique-reviewer assignment and decision aggregation, both as real `WorkflowTaskListener`s |
| `two-approval-default-flows/` | `dcrTwoApprovals.bpmn20.xml` — the same file `bpmn-rules.md` §12.1 already cites for the type-listener ambiguity, independently re-confirmed from this clone |
| `update-task-timer/` | A real boundary-timer escalation, with a real `WorkflowAction` reassigning the task |
| `change-due-date/`, `change-priority/` | Real `WorkflowTaskListener`s mutating a task's due date / priority |
| `custom-notifications/` | A real `WorkflowAction` (escalation) and `WorkflowTaskListener` (saving task info) pair |
| `field-injection/` | A real `WorkflowExecutionListener` using `activiti:field`-injected values |
| `workflow-external-dcr/`, `aws-access/` | Further real `WorkflowAction` implementations, incl. one calling out to S3 |

This is what resolved several items this file and `java-patterns.md` previously could only reason
about or cite a documentation page for — real compiled code in an official Reltio GitHub org is
stronger evidence than either, and is cited directly (file path and all) everywhere it settled
something.

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
