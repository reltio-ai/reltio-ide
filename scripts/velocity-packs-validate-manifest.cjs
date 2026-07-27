#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: velocity-packs-validate-manifest (maintainer CLI)
 * Delegates to scripts/lib/validate-velocity-packs.cjs
 */
const { validateVelocityPacks } = require('./lib/validate-velocity-packs.cjs');

const errors = validateVelocityPacks({ jsonStats: process.argv.includes('--json-stats') });
if (errors > 0) {
	process.exit(1);
}
console.log('OK');
