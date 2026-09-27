const JAVA_KEYWORDS = new Set([
	'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
	'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
	'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
	'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
	'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
	'volatile', 'while', 'true', 'false', 'null',
]);

/** Lowercase, strip spaces and punctuation, and force a legal Java identifier segment. */
export function normalizePackageSegment(raw: string): string {
	let segment = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
	if (!segment) segment = 'lca';
	if (/^[0-9]/.test(segment) || JAVA_KEYWORDS.has(segment)) {
		segment = `n${segment}`;
	}
	return segment;
}

export function isForbiddenGenericPackage(javaPackage: string): boolean {
	const value = javaPackage.trim().toLowerCase();
	return value === 'com.example.lca' || value.startsWith('com.example.');
}

/**
 * `com.reltio.lca.<customer>.<type>`, or tenant id when no customer name is available.
 * Does not change the Reltio type name; only the package segment is normalized.
 */
export function buildJavaPackage(input: {
	customerName?: string;
	tenantId?: string;
	typeName: string;
}): string {
	const owner = input.customerName?.trim() ? input.customerName : input.tenantId;
	if (!owner?.trim()) {
		throw new Error('A customer name or tenant id is required to build the Java package.');
	}
	const javaPackage = `com.reltio.lca.${normalizePackageSegment(owner)}.${normalizePackageSegment(input.typeName)}`;
	if (isForbiddenGenericPackage(javaPackage)) {
		throw new Error('Refusing generic package com.example.lca.');
	}
	return javaPackage;
}
