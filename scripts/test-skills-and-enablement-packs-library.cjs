#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: skills-and-enablement-packs-library
 * Tier A/B: velocity manifest validation, agent assets JSON, default skills exist
 * Tier C (manual): syncReltioAgentAssets in workspace — ARCHITECTURE.md agent assets
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validateVelocityPacks } = require('./lib/validate-velocity-packs.cjs');
const { repoRoot } = require('./lib/load-sample.cjs');

const errors = validateVelocityPacks();
assert.strictEqual(errors, 0, 'velocity packs manifest');

const assetsPath = path.join(repoRoot, 'resources', 'reltio-agent-assets.json');
const assets = JSON.parse(fs.readFileSync(assetsPath, 'utf8'));
assert.ok(assets.skillsBundleVersion);
assert.ok(assets.velocityPacksBundleVersion);
assert.ok(assets.lcaKnowledgeBaseBundleVersion);

const skillMd = path.join(repoRoot, 'skills', 'reltio-default', 'entity-type-concepts', 'SKILL.md');
assert.ok(fs.existsSync(skillMd), 'bundled default skill');

const lcaSkill = path.join(repoRoot, 'skills', 'reltio-default', 'lca-assistant', 'SKILL.md');
assert.ok(fs.existsSync(lcaSkill), 'lca-assistant skill');

console.log('test-skills-and-enablement-packs-library: OK');
