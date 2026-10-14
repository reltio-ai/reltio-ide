/**
 * Pure classification of a Workflow Adapter failure into a message and, where the failure
 * implicates the saved Adapter URL, an "Edit Adapter URL" action.
 *
 * Split out of `reportWorkflowError()` in `extension.ts` so this decision logic can be unit tested
 * without a `vscode` import: `reportWorkflowError()` itself stays in `extension.ts` because turning
 * an action into an actual `vscode.window.showErrorMessage()` / `vscode.commands.executeCommand()`
 * call, or a 401's re-authentication prompt, only makes sense wired into the live extension.
 */
import { ReltioApiError, UntrustedHostError } from '../api/reltioClient';
import { WorkflowConnectionError } from '../api/workflowAdapterClient';

export type WorkflowOperation = 'fetch' | 'open' | 'deploy' | 'register';

export type WorkflowErrorAction =
	| { readonly kind: 'reauthenticate' }
	| { readonly kind: 'message'; readonly message: string }
	| { readonly kind: 'message-with-edit-adapter-url'; readonly message: string };

/**
 * Decide what `reportWorkflowError()` should do about `e`.
 *
 * The action is decided by the error *class* (and, for a Reltio API failure, its status code),
 * never by matching on message text: `WorkflowConnectionError` and `UntrustedHostError` implicate
 * the URL, an HTTP status does not.
 */
export function classifyWorkflowError(
	e: unknown,
	ctx: { readonly tenantId: string; readonly operation: WorkflowOperation },
): WorkflowErrorAction {
	if (e instanceof ReltioApiError && e.statusCode === 401) {
		return { kind: 'reauthenticate' };
	}
	if (e instanceof ReltioApiError && e.statusCode === 403) {
		// The extension cannot know the signed-in user's Reltio roles — it never
		// decodes the JWT and there is no roles endpoint — so a 403 is the first
		// point at which a permissions problem is knowable. Name the role rather
		// than leaving the user to guess, and say the draft is safe.
		return {
			kind: 'message',
			message:
				ctx.operation === 'deploy'
					? `Deploy refused (403). Deploying a workflow requires the ROLE_WORKFLOW_MANAGER role on tenant "${ctx.tenantId}". Your draft is saved and unchanged — ask a tenant admin to grant the role, then deploy again.`
					: ctx.operation === 'register'
						? `Registration refused (403). Registering a JAR requires the ROLE_WORKFLOW_MANAGER role on tenant "${ctx.tenantId}". Ask a tenant admin to grant the role, then try again.`
						: `Access denied (403). Your account may not have sufficient permissions on tenant "${ctx.tenantId}". Ask a tenant admin to grant access.`,
		};
	}
	if (e instanceof ReltioApiError && e.statusCode === 404 && ctx.operation === 'deploy') {
		// The read endpoints and the deployments endpoint share a host, so a 404
		// here is far more likely a wrong Adapter URL than a missing resource.
		return {
			kind: 'message-with-edit-adapter-url',
			message: `Deploy failed (404). The Workflow Adapter URL saved for "${ctx.tenantId}" may be wrong.`,
		};
	}
	if (e instanceof ReltioApiError && e.statusCode === 429) {
		// `retryAfterSeconds` is only ever populated from a real `Retry-After` response header
		// (see `adapterHttpError()` in `workflowAdapterClient.ts`) — never invented here, since a
		// made-up wait time is worse than none at all.
		const wait =
			e.retryAfterSeconds !== undefined
				? ` It reports a retry-after of ${e.retryAfterSeconds} second${e.retryAfterSeconds === 1 ? '' : 's'}.`
				: ' Wait a moment before retrying.';
		return {
			kind: 'message',
			message: `Rate limited (429). The Workflow Adapter is asking you to slow down.${wait}`,
		};
	}
	if (e instanceof WorkflowConnectionError || e instanceof UntrustedHostError) {
		return { kind: 'message-with-edit-adapter-url', message: (e as Error).message };
	}
	return { kind: 'message', message: (e as Error).message };
}
