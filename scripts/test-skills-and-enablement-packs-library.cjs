#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: skills-and-enablement-packs-library
 * Tier A/B: velocity manifest validation, agent assets JSON, default skills exist
 * Regression rows: BIZCFG-008 per-pack declared
 * bytes equal each BusinessConfig.json size; both bundle version fields are non-empty.
 * Tier C (manual): syncReltioAgentAssets in workspace — ARCHITECTURE.md agent assets
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validateVelocityPacks, manifestPath, root: packsRoot } = require('./lib/validate-velocity-packs.cjs');
const { repoRoot } = require('./lib/load-sample.cjs');

const errors = validateVelocityPacks();
assert.strictEqual(errors, 0, 'velocity packs manifest');

// BIZCFG-008: the summed check above can hide
// two packs whose errors cancel out, so each pack's declared bytes must equal its own file size.
{
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	assert.ok(Array.isArray(manifest.packs) && manifest.packs.length > 0, 'BIZCFG-008 #1: the manifest lists packs');
	for (const p of manifest.packs) {
		const file = path.join(packsRoot, p.businessConfigPath);
		assert.ok(fs.existsSync(file), `BIZCFG-008 #1: pack ${p.id}: ${p.businessConfigPath} exists`);
		const size = fs.statSync(file).size;
		assert.strictEqual(Number(p.bytes), size, `BIZCFG-008 #1: pack ${p.id}: declared bytes ${p.bytes} must equal file size ${size}`);
	}
	const bundle = JSON.parse(fs.readFileSync(path.join(repoRoot, 'resources', 'reltio-agent-assets.json'), 'utf8'));
	for (const key of ['skillsBundleVersion', 'velocityPacksBundleVersion']) {
		assert.ok(typeof bundle[key] === 'string' && bundle[key].trim() !== '', `BIZCFG-008 #1: reltio-agent-assets.json ${key} is a non-empty string`);
	}
}

const assetsPath = path.join(repoRoot, 'resources', 'reltio-agent-assets.json');
const assets = JSON.parse(fs.readFileSync(assetsPath, 'utf8'));
assert.ok(assets.skillsBundleVersion);
assert.ok(assets.velocityPacksBundleVersion);

const skillMd = path.join(repoRoot, 'skills', 'reltio-default', 'entity-type-concepts', 'SKILL.md');
assert.ok(fs.existsSync(skillMd), 'bundled default skill');

console.log('test-skills-and-enablement-packs-library: OK');
