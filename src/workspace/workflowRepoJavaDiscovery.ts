/**
 * Java source discovery inside a connected Custom Workflow Repository (D2).
 *
 * The provisioned repository is mostly Java — `WORKFLOW REPO TEMPLATE` as Reltio ships it
 * has eleven main classes, seven test classes and no BPMN at all — so this, not
 * `workflowRepoDiscovery.ts`, is what populates the repository row for a repository a
 * customer has just received.
 *
 * Deliberately the opposite policy to BPMN discovery. There, D4 forbids trusting the
 * filename, because a customer's BPMN naming is their own and only `<process id>` is
 * authoritative. Here the path *is* authoritative: Java and Maven both require that a
 * class's directory encode its package, so a file whose `package` declaration disagrees
 * with its location does not compile. Reading the file would add cost and no truth.
 *
 * The load-bearing consequence of matching on the `src/{main,test}/java` convention is
 * that generated build output cannot appear in the results — no `target/classes`, no
 * shaded jar, no `node_modules`. The question of whether to honour the repository's
 * `.gitignore` is not answered here; under this rule it never arises.
 */
import * as vscode from 'vscode';
import { nearestModuleFor } from './workflowRepoModule';

/**
 * Deliberately larger than `workflowRepoDiscovery.ts`'s `MAX_DEPTH` of 10, which is a
 * BPMN-shaped limit borrowed from `l3Discovery.ts`. Java package directories make paths
 * much deeper: the deepest file in the provisioned template,
 * `workflow-external-dcr/src/main/java/com/reltio/workflow/external/services/beans/ChangeRequest.java`,
 * already sits at depth 10 — exactly at that limit, so a customer whose packages are one
 * level deeper would silently lose classes from the tree. 16 leaves the same headroom
 * again for a module-per-domain layout.
 */
const MAX_DEPTH = 16;

/** Source-root suffixes, longest-first is irrelevant — they are the same length and mutually exclusive. */
const SOURCE_ROOTS: readonly { readonly segments: readonly string[]; readonly kind: JavaSourceKind }[] = [
	{ segments: ['src', 'main', 'java'], kind: 'main' },
	{ segments: ['src', 'test', 'java'], kind: 'test' },
];

/**
 * Directory names never walked into. `target` is Maven's output directory and can hold
 * generated sources under paths that would otherwise look like a source root; skipping it
 * outright makes "no build output in the tree" a guarantee rather than a near-certainty,
 * and avoids walking thousands of class files to discover nothing.
 */
const SKIP_DIRS = new Set(['target', 'node_modules', 'build', 'out']);

export type JavaSourceKind = 'main' | 'test';

export interface DiscoveredJavaSource {
	readonly fileUri: vscode.Uri;
	/** `com.reltio.workflow.external.services.beans.ChangeRequest` */
	readonly fullyQualifiedName: string;
	/** `ChangeRequest` — the tree row's label. */
	readonly simpleName: string;
	/** `com.reltio.workflow.external.services.beans`, or `''` for the default package. */
	readonly packageName: string;
	/** Owning Maven module: the nearest ancestor directory holding a `pom.xml`. */
	readonly moduleName: string;
	/** Repository-relative, forward-slashed, for tooltips. */
	readonly relativePath: string;
	readonly kind: JavaSourceKind;
}

/**
 * Depth-limited walk collecting every `.java` file beneath a `src/main/java` or
 * `src/test/java` root. Dotfolders and build-output directories are skipped; a `.java`
 * file outside any source root is ignored rather than guessed at.
 */
export async function discoverJavaSources(root: vscode.Uri): Promise<DiscoveredJavaSource[]> {
	const found: DiscoveredJavaSource[] = [];
	await walk(root, 0, [], basename(root), undefined, found);
	found.sort((a, b) => a.fullyQualifiedName.localeCompare(b.fullyQualifiedName));
	return found;
}

function basename(uri: vscode.Uri): string {
	const parts = uri.path.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? '';
}

/**
 * `relParts` is the path from the repository root to `dir`. `moduleName` is the nearest
 * enclosing `pom.xml` directory found so far, seeded with the repository folder name so a
 * single-module repository with sources at its root still reports something useful.
 * `srcRoot` is set once a source root is entered and carries the depth at which it began,
 * which is what lets the package name be computed by slicing rather than re-matching.
 */
async function walk(
	dir: vscode.Uri,
	depth: number,
	relParts: readonly string[],
	moduleName: string,
	srcRoot: { readonly kind: JavaSourceKind; readonly depth: number } | undefined,
	found: DiscoveredJavaSource[],
): Promise<void> {
	if (depth > MAX_DEPTH) return;
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(dir);
	} catch {
		return;
	}

	// A `pom.xml` here makes this directory the owning module for everything below it —
	// the shared check in `workflowRepoModule.ts` (BPMN discovery seeds the same logic
	// differently, so the two walks agree without duplicating the `pom.xml` check).
	const module = nearestModuleFor(entries, relParts, moduleName);

	for (const [name, type] of entries) {
		if (name.startsWith('.')) continue;
		const child = vscode.Uri.joinPath(dir, name);

		if (type === vscode.FileType.Directory) {
			if (SKIP_DIRS.has(name)) continue;
			const childRel = [...relParts, name];
			await walk(child, depth + 1, childRel, module, srcRoot ?? matchSourceRoot(childRel), found);
			continue;
		}

		if (type !== vscode.FileType.File || !name.endsWith('.java') || !srcRoot) continue;

		// Directories between the source root and this file are the package.
		const packageName = relParts.slice(srcRoot.depth).join('.');
		const simpleName = name.slice(0, -'.java'.length);
		found.push({
			fileUri: child,
			fullyQualifiedName: packageName ? `${packageName}.${simpleName}` : simpleName,
			simpleName,
			packageName,
			moduleName: module,
			relativePath: [...relParts, name].join('/'),
			kind: srcRoot.kind,
		});
	}
}

/**
 * Does `relParts` end with a source-root triple? Returns the kind plus the depth at which
 * the package begins, so `relParts.slice(depth)` is the package path for any file below.
 */
function matchSourceRoot(
	relParts: readonly string[],
): { readonly kind: JavaSourceKind; readonly depth: number } | undefined {
	for (const { segments, kind } of SOURCE_ROOTS) {
		if (relParts.length < segments.length) continue;
		const tail = relParts.slice(relParts.length - segments.length);
		if (segments.every((segment, i) => tail[i] === segment)) {
			return { kind, depth: relParts.length };
		}
	}
	return undefined;
}
