'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..', 'resources', 'velocity-packs');
const manifestPath = path.join(root, 'manifest.json');

/**
 * Validate velocity-packs manifest and on-disk assets.
 * @param {{ jsonStats?: boolean }} [opts]
 * @returns {number} error count (0 = success)
 */
function validateVelocityPacks(opts = {}) {
	const jsonStats = opts.jsonStats === true;
	let raw;
	try {
		raw = fs.readFileSync(manifestPath, 'utf8');
	} catch (e) {
		console.error(`Cannot read manifest: ${manifestPath}`, e.message);
		return 1;
	}
	const manifest = JSON.parse(raw);
	const packs = manifest.packs || [];
	let sumDeclared = 0;
	let sumActual = 0;
	let errors = 0;

	for (const p of packs) {
		const bc = path.join(root, p.businessConfigPath);
		if (!fs.existsSync(bc)) {
			console.error(`Missing businessConfig: ${p.businessConfigPath}`);
			errors++;
		} else {
			const st = fs.statSync(bc);
			sumActual += st.size;
		}
		sumDeclared += Number(p.bytes) || 0;

		if (p.readmePath) {
			const rm = path.join(root, p.readmePath);
			if (!fs.existsSync(rm)) {
				console.error(`Missing readme: ${p.readmePath}`);
				errors++;
			}
		}

		if (jsonStats && fs.existsSync(bc)) {
			try {
				const doc = JSON.parse(fs.readFileSync(bc, 'utf8'));
				const schemaVersion = doc.schemaVersion != null ? String(doc.schemaVersion) : '';
				const sourceCount = Array.isArray(doc.sources) ? doc.sources.length : 0;
				console.log(
					`${p.id}\tbytes=${fs.statSync(bc).size}\tschemaVersion=${schemaVersion}\tsources=${sourceCount}`,
				);
			} catch (e) {
				console.error(`Invalid JSON: ${p.businessConfigPath}`, e.message);
				errors++;
			}
		}
	}

	if (sumDeclared !== sumActual) {
		console.warn('Declared bytes do not match filesystem sum — update manifest.json');
		errors++;
	}

	return errors;
}

module.exports = { validateVelocityPacks, manifestPath, root };
