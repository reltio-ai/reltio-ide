import { selectCloud, type CloudProvider } from './cloud';
import { isKnownHook } from './hooks';
import { isForbiddenGenericPackage } from './packageName';

const PACKAGE_NAME = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/;
const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface LcaClassSourceInput {
	provider: CloudProvider;
	javaPackage: string;
	className: string;
	hook: string;
}

export interface BaseClassCheck {
	ok: boolean;
	declared?: string;
	expected: string;
	message: string;
}

/** `HCP` + `beforeSave` → `HCPBeforeSave`. */
export function lcaClassName(typeName: string, hook: string): string {
	const parts = `${typeName} ${hook}`
		.replace(/[^A-Za-z0-9]+/g, ' ')
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map(part => part.charAt(0).toUpperCase() + part.slice(1));
	let name = parts.join('');
	if (!name || /^[0-9]/.test(name)) name = `Lca${name}`;
	return name;
}

/**
 * Java compilation unit for one cloud.
 * The class extends that cloud's handler and imports no other LCA base class.
 */
export function renderLcaClass(input: LcaClassSourceInput): string {
	const selected = selectCloud(input.provider);
	if ('error' in selected) {
		throw new Error(selected.error);
	}
	if (isForbiddenGenericPackage(input.javaPackage) || !PACKAGE_NAME.test(input.javaPackage)) {
		throw new Error('Java package must be a lowercase com.reltio.lca package, never com.example.lca.');
	}
	if (!CLASS_NAME.test(input.className)) {
		throw new Error('Class name must be a Java identifier.');
	}
	if (!isKnownHook(input.hook)) {
		throw new Error(`"${input.hook}" is not a supported LCA hook. Hook names are case-sensitive.`);
	}
	return [
		`package ${input.javaPackage};`,
		'',
		`import ${selected.baseClassQualifiedName};`,
		'',
		`/** ${input.hook} LCA for ${selected.provider}. */`,
		`public class ${input.className} extends ${selected.baseClass} {`,
		'}',
		'',
	].join('\n');
}

/** Simple or qualified name in the first `extends` clause. */
export function declaredBaseClass(source: string): string | undefined {
	const match = source.match(/\bextends\s+([A-Za-z_][A-Za-z0-9_.]*)/);
	return match?.[1];
}

/** The generated class extends the handler for `provider` and no other cloud handler. */
export function baseClassMatchesCloud(source: string, provider: CloudProvider): BaseClassCheck {
	const selected = selectCloud(provider);
	if ('error' in selected) {
		return { ok: false, expected: provider, message: selected.error };
	}
	const declared = declaredBaseClass(source);
	const simple = declared?.split('.').pop();
	const others = (['aws', 'gcp', 'azure', 'native'] as const)
		.filter(item => item !== provider)
		.map(item => {
			const cloud = selectCloud(item);
			return 'error' in cloud ? '' : cloud.baseClass;
		})
		.filter(Boolean);
	if (simple !== selected.baseClass) {
		return {
			ok: false,
			declared: simple,
			expected: selected.baseClass,
			message: `Expected extends ${selected.baseClass} for ${provider}.`,
		};
	}
	if (!source.includes(`import ${selected.baseClassQualifiedName};`)) {
		return {
			ok: false,
			declared: simple,
			expected: selected.baseClass,
			message: `Expected import ${selected.baseClassQualifiedName}.`,
		};
	}
	for (const other of others) {
		if (source.includes(other)) {
			return {
				ok: false,
				declared: simple,
				expected: selected.baseClass,
				message: `Source for ${provider} also references ${other}.`,
			};
		}
	}
	return {
		ok: true,
		declared: simple,
		expected: selected.baseClass,
		message: `${provider} source extends ${selected.baseClass}.`,
	};
}
