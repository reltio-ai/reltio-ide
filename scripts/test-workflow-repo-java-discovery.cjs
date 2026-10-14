#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: workflow-repo-contents-and-agent-access
 *
 * Tier A — `discoverJavaSources()` against a real in-memory tree
 *   (`scripts/lib/memory-fs.cjs`), covering design.md D2/D3:
 *   1. main and test sources separated by `src/{main,test}/java` root;
 *   2. generated build output excluded — `target/**`, including a `.java` under a
 *      `target/generated-sources` path that mimics a source root;
 *   3. dotfolders skipped;
 *   4. the depth limit, which is deliberately *not* BPMN discovery's 10;
 *   5. identity derived from the path alone — fully-qualified name, simple name,
 *      package, and owning Maven module — including a nested package and the
 *      default package;
 *   6. a `.java` file outside any source root ignored rather than guessed at.
 *
 * Tier B for this change lives in `test-custom-workflow-repository.cjs`, alongside the
 * Part 3 structural assertions it extends.
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');
const { installMemoryFs } = require('./lib/memory-fs.cjs');

const { discoverJavaSources } = importDist('workspace/workflowRepoJavaDiscovery');

const enc = s => new TextEncoder().encode(s);

/** Source text is never parsed (D3), so its contents are irrelevant — but not empty. */
const JAVA = 'public class Whatever {}\n';

(async () => {
	// ── 1. Main/test separation, module attribution, path-derived identity ────
	{
		const mem = installMemoryFs();
		const write = p => mem.writeFile(vscode.Uri.file(`/repo/${p}`), enc(JAVA));

		await mem.writeFile(vscode.Uri.file('/repo/pom.xml'), enc('<project/>'));
		await mem.writeFile(vscode.Uri.file('/repo/delete-review/pom.xml'), enc('<project/>'));
		await mem.writeFile(vscode.Uri.file('/repo/workflow-external-dcr/pom.xml'), enc('<project/>'));

		await write('delete-review/src/main/java/com/company/workflow/delete/DeleteReviewValidator.java');
		await write('delete-review/src/test/java/com/company/workflow/delete/DeleteReviewValidatorTest.java');
		await write(
			'workflow-external-dcr/src/main/java/com/reltio/workflow/external/services/beans/ChangeRequest.java',
		);

		const found = await discoverJavaSources(vscode.Uri.file('/repo'));

		assert.deepStrictEqual(
			found.map(f => f.fullyQualifiedName),
			[
				'com.company.workflow.delete.DeleteReviewValidator',
				'com.company.workflow.delete.DeleteReviewValidatorTest',
				'com.reltio.workflow.external.services.beans.ChangeRequest',
			],
			'fully-qualified names come from the path below the source root, sorted',
		);

		assert.deepStrictEqual(
			found.filter(f => f.kind === 'main').map(f => f.simpleName),
			['DeleteReviewValidator', 'ChangeRequest'],
			'src/main/java sources are kind "main"',
		);
		assert.deepStrictEqual(
			found.filter(f => f.kind === 'test').map(f => f.simpleName),
			['DeleteReviewValidatorTest'],
			'src/test/java sources are kind "test"',
		);

		const bean = found.find(f => f.simpleName === 'ChangeRequest');
		assert.strictEqual(
			bean.packageName, 'com.reltio.workflow.external.services.beans',
			'a deeply nested package is reported in full',
		);
		assert.strictEqual(
			bean.moduleName, 'workflow-external-dcr',
			'moduleName is the nearest ancestor directory holding a pom.xml, not the repo root',
		);
		assert.strictEqual(
			bean.relativePath,
			'workflow-external-dcr/src/main/java/com/reltio/workflow/external/services/beans/ChangeRequest.java',
			'relativePath is repository-relative and forward-slashed',
		);
	}

	// ── 2. Build output is excluded, even when it mimics a source root ────────
	{
		const mem = installMemoryFs();
		const write = (p, body) => mem.writeFile(vscode.Uri.file(`/repo/${p}`), enc(body ?? JAVA));

		await write('mod/src/main/java/com/acme/Real.java');
		// Post-`mvn package` reality: compiled output, a shaded jar, and generated
		// sources sitting under a path that would otherwise match a source root.
		await write('mod/target/classes/com/acme/Real.java');
		await write('mod/target/generated-sources/annotations/src/main/java/com/acme/Generated.java');
		await write('mod/target/mod-1.0-everything.jar', 'not really a jar');
		await write('node_modules/some-pkg/src/main/java/com/vendor/Vendored.java');

		const found = await discoverJavaSources(vscode.Uri.file('/repo'));
		assert.deepStrictEqual(
			found.map(f => f.simpleName), ['Real'],
			'nothing beneath target/ or node_modules/ may appear, however source-root-like the path',
		);
	}

	// ── 3. Dotfolders skipped ────────────────────────────────────────────────
	{
		const mem = installMemoryFs();
		await mem.writeFile(vscode.Uri.file('/repo/mod/src/main/java/com/acme/Kept.java'), enc(JAVA));
		await mem.writeFile(
			vscode.Uri.file('/repo/.git/mod/src/main/java/com/acme/Hidden.java'), enc(JAVA),
		);

		const found = await discoverJavaSources(vscode.Uri.file('/repo'));
		assert.deepStrictEqual(found.map(f => f.simpleName), ['Kept'], 'dotfolders are not walked');
	}

	// ── 4. Depth limit — deliberately deeper than BPMN discovery's 10 ────────
	{
		const mem = installMemoryFs();
		// A ten-segment package under a module is depth 14 from the repository root,
		// which BPMN discovery's MAX_DEPTH of 10 would silently drop. The provisioned
		// template already reaches depth 10, so reusing that limit was not an option.
		let deep = 'mod/src/main/java';
		for (let i = 1; i <= 10; i++) deep += `/p${i}`;
		await mem.writeFile(vscode.Uri.file(`/repo/${deep}/AtLimit.java`), enc(JAVA));

		const found = await discoverJavaSources(vscode.Uri.file('/repo'));
		assert.deepStrictEqual(
			found.map(f => f.simpleName), ['AtLimit'],
			'a ten-segment package must still be discovered',
		);
		assert.strictEqual(
			found[0].packageName, 'p1.p2.p3.p4.p5.p6.p7.p8.p9.p10',
			'every package segment below the source root is preserved',
		);
	}

	// ── 5. Outside a source root, and the default package ────────────────────
	{
		const mem = installMemoryFs();
		await mem.writeFile(vscode.Uri.file('/repo/Stray.java'), enc(JAVA));
		await mem.writeFile(vscode.Uri.file('/repo/scripts/Helper.java'), enc(JAVA));
		await mem.writeFile(vscode.Uri.file('/repo/mod/src/main/resources/NotSource.java'), enc(JAVA));
		await mem.writeFile(vscode.Uri.file('/repo/mod/src/main/java/Rooted.java'), enc(JAVA));

		const found = await discoverJavaSources(vscode.Uri.file('/repo'));
		assert.deepStrictEqual(
			found.map(f => f.simpleName), ['Rooted'],
			'a .java file outside any src/{main,test}/java root is ignored',
		);
		assert.strictEqual(found[0].packageName, '', 'a file at the source root is in the default package');
		assert.strictEqual(
			found[0].fullyQualifiedName, 'Rooted',
			'the default package yields a bare class name, with no leading dot',
		);
	}

	// ── 6. An empty or absent repository is not an error ─────────────────────
	{
		installMemoryFs();
		assert.deepStrictEqual(
			await discoverJavaSources(vscode.Uri.file('/nope')),
			[],
			'an unreadable root yields no results rather than throwing',
		);
	}

	console.log('test-workflow-repo-java-discovery: OK');
})().catch(err => {
	console.error(err);
	process.exit(1);
});
