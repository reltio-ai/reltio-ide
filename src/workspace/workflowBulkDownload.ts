/**
 * Decisions for downloading every deployed BPMN when the Process Definitions list loads.
 *
 * The list endpoint returns no XML, so each definition costs one call. Two rules keep that safe:
 *
 *   - **Never overwrite.** A definition whose `{id}.bpmn20.xml` already exists is skipped, whatever
 *     it is: an earlier download (refreshing those is `refreshLocalBpmnCopies`' job and respects
 *     local edits), a draft, or a file from the connected repository. Without this a bulk download
 *     could silently replace work in progress.
 *   - **Only ids that are safe filenames.** The id comes from the server and becomes a file name,
 *     so anything `isValidProcessId` refuses is skipped, never written.
 *
 * Pure and total: file-system and network access stay in `extension.ts`, as with `workflowDeployPlan`.
 */

import { bpmnFileName, isValidProcessId } from './workflowBpmnFiles';

export interface BulkDownloadPlan {
	/** Process ids to download, in list order, each at most once. */
	readonly toDownload: readonly string[];
	/** Ids left alone because a file with that name is already on disk. */
	readonly alreadyOnDisk: readonly string[];
	/** Ids whose name cannot be a local file, so they stay on-demand only. */
	readonly unusable: readonly string[];
}

/**
 * @param definitionIds  `type` of every deployed definition, as listed by the tenant.
 * @param existingFileNames  names of the files currently in `Workflows/bpmn/`.
 *
 * File names are compared case-insensitively: on Windows and macOS `Foo.bpmn20.xml` and
 * `foo.bpmn20.xml` are the same file, and two ids differing only by case must not race to write it.
 */
export function planBulkDownload(
	definitionIds: readonly string[],
	existingFileNames: Iterable<string>,
): BulkDownloadPlan {
	const taken = new Set<string>();
	for (const name of existingFileNames) taken.add(name.toLowerCase());

	const toDownload: string[] = [];
	const alreadyOnDisk: string[] = [];
	const unusable: string[] = [];
	for (const id of definitionIds) {
		if (typeof id !== 'string' || !isValidProcessId(id)) {
			unusable.push(String(id));
			continue;
		}
		const key = bpmnFileName(id).toLowerCase();
		if (taken.has(key)) {
			alreadyOnDisk.push(id);
			continue;
		}
		// Claimed immediately, so a second id that maps to the same file is not downloaded too.
		taken.add(key);
		toDownload.push(id);
	}
	return { toDownload, alreadyOnDisk, unusable };
}

export interface BoundedRunResult {
	readonly succeeded: number;
	readonly failed: number;
	/** True when the run stopped early because the failures never let up. */
	readonly aborted: boolean;
}

/**
 * Runs `worker` over `items` with at most `limit` in flight. A worker that throws counts as a
 * failure and does not stop the others; `abortAfterConsecutiveFailures` consecutive failures stop
 * the run (an expired token fails every call identically, and hundreds of 401s help nobody).
 * `isCancelled` is polled before each item starts.
 */
export async function runBounded<T>(
	items: readonly T[],
	limit: number,
	worker: (item: T) => Promise<void>,
	options: { abortAfterConsecutiveFailures?: number; isCancelled?: () => boolean } = {},
): Promise<BoundedRunResult> {
	const maxConcurrent = Math.max(1, Math.floor(limit));
	const abortAfter = options.abortAfterConsecutiveFailures ?? Number.POSITIVE_INFINITY;
	let next = 0;
	let succeeded = 0;
	let failed = 0;
	let consecutiveFailures = 0;
	let aborted = false;

	const lane = async (): Promise<void> => {
		while (!aborted && !(options.isCancelled?.() ?? false)) {
			const index = next++;
			if (index >= items.length) return;
			try {
				await worker(items[index]);
				succeeded++;
				consecutiveFailures = 0;
			} catch {
				failed++;
				consecutiveFailures++;
				if (consecutiveFailures >= abortAfter) aborted = true;
			}
		}
	};

	await Promise.all(Array.from({ length: Math.min(maxConcurrent, items.length) }, lane));
	return { succeeded, failed, aborted };
}
