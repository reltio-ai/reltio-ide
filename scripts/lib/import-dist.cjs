'use strict';

const path = require('path');
const Module = require('module');

const stubPath = path.join(__dirname, 'vscode-stub.cjs');
const distRoot = path.join(__dirname, '..', '..', 'dist');

let vscodeMockInstalled = false;

function installVscodeMock() {
	if (vscodeMockInstalled) {
		return;
	}
	const original = Module._resolveFilename;
	Module._resolveFilename = function (request, parent, isMain, options) {
		if (request === 'vscode') {
			return stubPath;
		}
		return original.call(this, request, parent, isMain, options);
	};
	vscodeMockInstalled = true;
}

/**
 * Require a compiled module from `dist/` (run `npm run compile` first).
 * @param {string} relativePath e.g. `navigation/uriIndex` (no extension)
 */
function importDist(relativePath) {
	installVscodeMock();
	const full = path.join(distRoot, relativePath.replace(/\.js$/, '') + '.js');
	// eslint-disable-next-line import/no-dynamic-require, global-require
	return require(full);
}

module.exports = { importDist, installVscodeMock, distRoot };
