import { validateHook } from './hooks';
import type { TargetKind } from './l3Lookup';

export type LifecycleOp = 'inspect' | 'add' | 'append' | 'remove' | 'replace' | 'filter';

export interface LifecycleProposal {
	ok: boolean;
	message?: string;
	destructive: boolean;
	duplicate: boolean;
	current: Record<string, unknown>;
	proposed: Record<string, unknown>;
}

function clone(value: Record<string, unknown> | undefined): Record<string, unknown> {
	return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;
}

function actionList(entry: unknown): string[] {
	if (!Array.isArray(entry)) return [];
	const names: string[] = [];
	for (const item of entry) {
		if (typeof item === 'string') names.push(item);
		else if (item && typeof item === 'object' && Array.isArray((item as { actions?: unknown }).actions)) {
			for (const name of (item as { actions: unknown[] }).actions) {
				if (typeof name === 'string') names.push(name);
			}
		}
	}
	return names;
}

export function proposeLifecycleChange(input: {
	current: Record<string, unknown> | undefined;
	hook: string;
	kind?: TargetKind;
	op: LifecycleOp;
	action?: string;
	filter?: string;
	replacement?: unknown[];
}): LifecycleProposal {
	const current = clone(input.current);
	const proposed = clone(input.current);
	if (input.kind && input.op !== 'inspect') {
		const hookCheck = validateHook(input.kind, input.hook);
		if (!hookCheck.ok) {
			return {
				ok: false,
				destructive: false,
				duplicate: false,
				message: hookCheck.message,
				current,
				proposed: current,
			};
		}
	}
	const existing = actionList(proposed[input.hook]);

	if (input.op === 'inspect') {
		return { ok: true, destructive: false, duplicate: false, current, proposed };
	}

	if ((input.op === 'add' || input.op === 'append') && input.action) {
		if (existing.includes(input.action)) {
			return {
				ok: false,
				duplicate: true,
				destructive: false,
				message: `${input.action} is already registered on ${input.hook}.`,
				current,
				proposed: current,
			};
		}
		const list = Array.isArray(proposed[input.hook]) ? [...(proposed[input.hook] as unknown[])] : [];
		list.push(input.action);
		proposed[input.hook] = list;
		return { ok: true, destructive: false, duplicate: false, current, proposed };
	}

	if (input.op === 'filter' && input.action) {
		if (existing.includes(input.action)) {
			return {
				ok: false,
				duplicate: true,
				destructive: false,
				message: `${input.action} is already registered on ${input.hook}.`,
				current,
				proposed: current,
			};
		}
		const list = Array.isArray(proposed[input.hook]) ? [...(proposed[input.hook] as unknown[])] : [];
		list.push({ actions: [input.action], filter: input.filter ?? '' });
		proposed[input.hook] = list;
		return { ok: true, destructive: false, duplicate: false, current, proposed };
	}

	if (input.op === 'remove' && input.action) {
		if (!existing.includes(input.action)) {
			return {
				ok: false,
				duplicate: false,
				destructive: true,
				message: `${input.action} is not registered on ${input.hook}.`,
				current,
				proposed: current,
			};
		}
		const list = (Array.isArray(proposed[input.hook]) ? proposed[input.hook] as unknown[] : []).filter(item => {
			if (typeof item === 'string') return item !== input.action;
			if (item && typeof item === 'object' && Array.isArray((item as { actions?: unknown }).actions)) {
				const actions = ((item as { actions: unknown[] }).actions).filter(name => name !== input.action);
				return actions.length > 0;
			}
			return true;
		}).map(item => {
			if (item && typeof item === 'object' && Array.isArray((item as { actions?: unknown }).actions)) {
				return {
					...(item as object),
					actions: ((item as { actions: unknown[] }).actions).filter(name => name !== input.action),
				};
			}
			return item;
		});
		if (list.length === 0) delete proposed[input.hook];
		else proposed[input.hook] = list;
		return { ok: true, destructive: true, duplicate: false, current, proposed };
	}

	if (input.op === 'replace') {
		proposed[input.hook] = input.replacement ?? (input.action ? [input.action] : []);
		return { ok: true, destructive: true, duplicate: false, current, proposed };
	}

	return {
		ok: false,
		destructive: false,
		duplicate: false,
		message: 'Lifecycle change is incomplete.',
		current,
		proposed: current,
	};
}

/** Apply a previously confirmed proposal onto a type object. Copies unrelated fields. */
export function applyLifecycleProposal<T extends { lifecycleActions?: unknown }>(
	typeObject: T,
	proposed: Record<string, unknown>,
): T {
	return {
		...typeObject,
		lifecycleActions: JSON.parse(JSON.stringify(proposed)),
	};
}
