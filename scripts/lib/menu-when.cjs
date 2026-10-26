'use strict';
/**
 * Resolves which `view/item/context` menu entries apply to a tree item, the way VS Code does.
 *
 * `when` clauses select a row by `viewItem == value` or `viewItem =~ /regex/`. Tests that only
 * did a substring check on the clause broke whenever a clause moved from `==` to a regex, and
 * worse, passed when the regex no longer matched the contextValue it was written for.
 */

/** The clause's `viewItem` conditions, as predicates over a contextValue. */
function viewItemMatchers(when) {
	const matchers = [];
	const text = String(when ?? '');
	for (const m of text.matchAll(/viewItem\s*==\s*([\w.]+)/g)) {
		matchers.push(value => value === m[1]);
	}
	for (const m of text.matchAll(/viewItem\s*=~\s*\/((?:\\\/|[^/])+)\//g)) {
		const re = new RegExp(m[1]);
		matchers.push(value => re.test(value));
	}
	return matchers;
}

/** True when a menu entry's `when` selects a row whose contextValue is `contextValue`. */
function menuEntryAppliesTo(entry, contextValue) {
	return viewItemMatchers(entry.when).some(match => match(contextValue));
}

/** Entries for `contextValue`, optionally narrowed to one command. */
function menuEntriesFor(menu, contextValue, command) {
	return menu.filter(
		entry => menuEntryAppliesTo(entry, contextValue) && (command === undefined || entry.command === command),
	);
}

/** True when the command is offered on right-click (not only as an inline icon) for this row. */
function onContextMenu(menu, contextValue, command) {
	return menuEntriesFor(menu, contextValue, command).some(
		entry => !String(entry.group ?? '').startsWith('inline'),
	);
}

module.exports = { viewItemMatchers, menuEntryAppliesTo, menuEntriesFor, onContextMenu };
