#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { validateBpmnDefinition } = require('./lib/validate-bpmn-definition.cjs');

const file = process.argv[2];
if (!file) {
	console.error('Usage: node scripts/validate-bpmn-definition.cjs <file.bpmn20.xml>');
	process.exit(2);
}

const xml = fs.readFileSync(file, 'utf8');
const result = validateBpmnDefinition(xml, path.basename(file));
if (result.ok) process.exit(0);
for (const error of result.errors) console.error(error);
process.exit(1);
