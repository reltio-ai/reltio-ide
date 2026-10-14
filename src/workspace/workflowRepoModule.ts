/**
 * Maven-module attribution shared between BPMN discovery (`workflowRepoDiscovery.ts`) and
 * Java discovery (`workflowRepoJavaDiscovery.ts`): which is the nearest ancestor directory,
 * between a file and the connected repository's root, that holds a `pom.xml`.
 *
 * Both walks already visit every directory between the repository root and a file exactly
 * once, top-down, in the course of discovering files at all — so this is applied once per
 * directory during that existing walk (the caller threads the running answer through its
 * own recursion as `inherited`) rather than as a second, bottom-up walk per file, which
 * would redo the same `pom.xml` checks `O(files * depth)` times for an identical answer.
 *
 * This function makes exactly one claim: "this file's nearest module-defining ancestor is
 * named X" (or "none was found"). It is not, and must never become, a claim about which
 * BPMN process calls which Java class — `bpmnModel.ts` only ever extracts the literal
 * `activiti:class` string, not delegate expressions or listener bindings, so a module
 * sharing many unrelated classes (or a BPMN file sitting next to code it never calls) would
 * make any stronger claim actively misleading (see `workflow-repo-contents-and-agent-access`
 * design.md, decision D4).
 */
import * as vscode from 'vscode';

/**
 * Given the directory listing of the directory currently being visited (`entries`, exactly
 * what `vscode.workspace.fs.readDirectory()` returns), the path segments from the
 * repository root down to it (`relParts`), and the module name already established by an
 * ancestor directory on this same path (`inherited`), returns the module name that applies
 * to this directory and to everything beneath it until a nearer `pom.xml` is found.
 *
 * `inherited` is also how the two callers differ on "no ancestor `pom.xml` at all":
 *   - `workflowRepoJavaDiscovery.ts` seeds it with the repository folder's own name, so a
 *     single-module repository whose sources sit at its root (no nested `pom.xml` at all)
 *     still reports something useful instead of `undefined`.
 *   - `workflowRepoDiscovery.ts` seeds it with `undefined`, so a customer's BPMN — which is
 *     never provisioned by Reltio and may sit entirely outside every Maven module — reports
 *     "no module" rather than borrowing the repository folder's name as a false module.
 *
 * A `pom.xml` sitting at the repository root itself (`relParts.length === 0`) does not
 * change the answer: whichever name the caller seeded `inherited` with already describes
 * the root correctly, and there is no shallower path segment to rename it to.
 */
export function nearestModuleFor<T extends string | undefined>(
	entries: readonly (readonly [string, vscode.FileType])[],
	relParts: readonly string[],
	inherited: T,
): T | string {
	const hasPom = entries.some(([name, type]) => name === 'pom.xml' && type === vscode.FileType.File);
	if (!hasPom) return inherited;
	return relParts.length > 0 ? relParts[relParts.length - 1] : inherited;
}
