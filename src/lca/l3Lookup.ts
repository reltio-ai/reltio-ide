export type TargetKind = 'entity' | 'relation' | 'changeRequest';

export interface ResolvedAttribute {
	name: string;
	uri: string;
	label?: string;
	path: string[];
}

export interface ResolvedObjectType {
	kind: TargetKind;
	name: string;
	label?: string;
	uri: string;
	attributes: ResolvedAttribute[];
	lifecycleActions: Record<string, unknown> | undefined;
}

export interface LookupFailure {
	ok: false;
	message: string;
	suggestions: string[];
}

export interface LookupSuccess {
	ok: true;
	object: ResolvedObjectType;
}

type AttrNode = {
	name?: string;
	label?: string;
	uri?: string;
	attributes?: AttrNode[];
};

type TypeNode = {
	uri?: string;
	label?: string;
	attributes?: AttrNode[];
	lifecycleActions?: unknown;
};

const COLLECTIONS: { key: string; kind: TargetKind }[] = [
	{ key: 'entityTypes', kind: 'entity' },
	{ key: 'relationTypes', kind: 'relation' },
	{ key: 'changeRequestTypes', kind: 'changeRequest' },
];

function localName(uri?: string): string {
	if (!uri) return '';
	const parts = uri.split('/');
	return parts[parts.length - 1] ?? '';
}

function exactName(node: TypeNode, token: string): boolean {
	const want = token.trim().toLowerCase();
	if (!want) return false;
	if ((node.label ?? '').toLowerCase() === want) return true;
	return localName(node.uri).toLowerCase() === want;
}

function flattenAttributes(attrs: AttrNode[] | undefined, prefix: string[] = []): ResolvedAttribute[] {
	const out: ResolvedAttribute[] = [];
	for (const attr of attrs ?? []) {
		const name = attr.name || localName(attr.uri);
		if (!name) continue;
		const path = [...prefix, name];
		out.push({
			name,
			uri: attr.uri ?? '',
			label: attr.label,
			path,
		});
		if (attr.attributes?.length) {
			out.push(...flattenAttributes(attr.attributes, path));
		}
	}
	return out;
}

function asLifecycle(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

export function listObjectTypes(model: Record<string, unknown>): ResolvedObjectType[] {
	const found: ResolvedObjectType[] = [];
	for (const collection of COLLECTIONS) {
		const items = model[collection.key];
		if (!Array.isArray(items)) continue;
		for (const raw of items) {
			if (!raw || typeof raw !== 'object') continue;
			const node = raw as TypeNode;
			const name = localName(node.uri) || node.label || '';
			if (!name) continue;
			found.push({
				kind: collection.kind,
				name,
				label: node.label,
				uri: node.uri ?? '',
				attributes: flattenAttributes(node.attributes),
				lifecycleActions: asLifecycle(node.lifecycleActions),
			});
		}
	}
	return found;
}

function suggestionsFor(types: ResolvedObjectType[], token: string, kind?: TargetKind): string[] {
	const pool = kind ? types.filter(t => t.kind === kind) : types;
	const needle = token.trim().toLowerCase();
	const ranked = pool.filter(t => {
		const name = t.name.toLowerCase();
		const label = (t.label ?? '').toLowerCase();
		return name.includes(needle) || label.includes(needle) || needle.includes(name);
	});
	const rest = pool.filter(t => !ranked.includes(t));
	return [...ranked, ...rest].slice(0, 25).map(t => `${t.uri || t.name}${t.label ? ` (${t.label})` : ''}`);
}

export function resolveObjectType(
	model: Record<string, unknown>,
	token: string,
	kind?: TargetKind,
): LookupSuccess | LookupFailure {
	const types = listObjectTypes(model);
	const pool = kind ? types.filter(t => t.kind === kind) : types;
	const matches = pool.filter(t => exactName({ uri: t.uri, label: t.label ?? t.name }, token) || t.name.toLowerCase() === token.trim().toLowerCase());
	if (matches.length === 1) {
		return { ok: true, object: matches[0] };
	}
	if (matches.length > 1) {
		return {
			ok: false,
			message: `"${token}" matches more than one type in this tenant L3.`,
			suggestions: matches.map(t => t.uri),
		};
	}
	return {
		ok: false,
		message: `"${token}" is not in this tenant L3.`,
		suggestions: suggestionsFor(types, token, kind),
	};
}

export function resolveAttributes(
	object: ResolvedObjectType,
	names: string[],
): { ok: true; attributes: ResolvedAttribute[] } | LookupFailure {
	const resolved: ResolvedAttribute[] = [];
	const missing: string[] = [];
	for (const name of names) {
		const want = name.trim().toLowerCase();
		const hit = object.attributes.find(a =>
			a.name.toLowerCase() === want ||
			(a.label ?? '').toLowerCase() === want ||
			localName(a.uri).toLowerCase() === want ||
			a.path.join('.').toLowerCase() === want,
		);
		if (!hit) missing.push(name);
		else resolved.push(hit);
	}
	if (missing.length) {
		return {
			ok: false,
			message: `Attribute(s) not in ${object.name}: ${missing.join(', ')}.`,
			suggestions: object.attributes.slice(0, 25).map(a => a.path.join('.')),
		};
	}
	return { ok: true, attributes: resolved };
}
