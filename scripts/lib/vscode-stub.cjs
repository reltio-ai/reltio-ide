'use strict';

/** Minimal vscode API stub for CLI unit tests importing compiled `dist/` modules. */

class Uri {
	constructor(fsPath) {
		this.fsPath = fsPath;
		this.path = fsPath.startsWith('/') ? fsPath : `/${fsPath}`;
		this.scheme = 'file';
	}
	static file(fsPath) {
		return new Uri(fsPath);
	}
	static joinPath(base, ...pathSegments) {
		let p = base.fsPath.replace(/[/\\]+$/, '');
		for (const s of pathSegments) {
			const seg = String(s).replace(/^[/\\]+/, '');
			p = `${p}/${seg}`;
		}
		return new Uri(p);
	}
	static parse(value) {
		const fsPath = value.replace(/^file:\/\//, '');
		return new Uri(fsPath);
	}
	with(change) {
		const next = new Uri(typeof change?.path === 'string' ? change.path : this.fsPath);
		if (typeof change?.scheme === 'string') next.scheme = change.scheme;
		return next;
	}
	toString() {
		return `file://${this.fsPath}`;
	}
}

class EventEmitter {
	constructor() {
		this._listeners = [];
	}
	get event() {
		const self = this;
		return function (listener) {
			self._listeners.push(listener);
			return { dispose() {} };
		};
	}
	fire() {
		for (const l of this._listeners) {
			l();
		}
	}
	dispose() {}
}

class TreeItem {
	constructor(label, collapsibleState) {
		this.label = label;
		this.collapsibleState = collapsibleState;
	}
}

class ThemeIcon {
	constructor(id, color) {
		this.id = id;
		this.color = color;
	}
}

class ThemeColor {
	constructor(id) {
		this.id = id;
	}
}

/**
 * `isTrusted` defaults to false in the real API, and that default is a security
 * property worth being able to assert: a trusted MarkdownString renders
 * `command:` links, and tree tooltips are built from server-supplied strings.
 */
class MarkdownString {
	constructor(value = '') {
		this.value = value;
		this.isTrusted = false;
		this.supportThemeIcons = false;
	}
	appendMarkdown(value) {
		this.value += value;
		return this;
	}
	appendText(value) {
		this.value += value;
		return this;
	}
}

class Position {
	constructor(line, character) {
		this.line = line;
		this.character = character;
	}
}

class Range {
	constructor(start, end) {
		this.start = start;
		this.end = end;
	}
}

class Diagnostic {
	constructor(range, message, severity) {
		this.range = range;
		this.message = message;
		this.severity = severity;
	}
}

/**
 * Backed by a `Map` keyed on the URI string, so a test can read back what was
 * set — which is the only observable behaviour of a real collection.
 */
class DiagnosticCollection {
	constructor(name) {
		this.name = name;
		this.entries = new Map();
	}
	set(uri, diagnostics) {
		this.entries.set(uri.toString(), diagnostics);
	}
	get(uri) {
		return this.entries.get(uri.toString());
	}
	delete(uri) {
		this.entries.delete(uri.toString());
	}
	clear() {
		this.entries.clear();
	}
	dispose() {}
}

module.exports = {
	Uri,
	EventEmitter,
	TreeItem,
	Position,
	Range,
	Diagnostic,
	DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
	ThemeIcon,
	ThemeColor,
	MarkdownString,
	TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
	FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
	ProgressLocation: { Notification: 15 },
	ViewColumn: { One: 1, Beside: 2 },
	ExtensionMode: { Production: 1 },
	StatusBarAlignment: { Left: 1, Right: 2 },
	ConfigurationTarget: { Global: 1 },
	workspace: {
		fs: {
			readDirectory: async () => [],
			readFile: async () => new Uint8Array(),
			writeFile: async () => {},
			delete: async () => {},
			createDirectory: async () => {},
			stat: async () => ({ type: 1 }),
		},
		textDocuments: [],
		workspaceFolders: [],
		// `get(key, fallback)` returns the fallback for an unset key in the real
		// API. Returning `undefined` instead would make every setting read in
		// `dist/` behave as if it were explicitly set to nothing.
		getConfiguration: () => ({ get: (_key, fallback) => fallback, update: async () => {} }),
		onDidChangeTextDocument: () => ({ dispose() {} }),
		onDidChangeActiveTextEditor: () => ({ dispose() {} }),
		onDidChangeWindowState: () => ({ dispose() {} }),
		openTextDocument: async () => ({ getText: () => '{}', uri: Uri.file('/tmp/x.json') }),
	},
	window: {
		showErrorMessage: async () => undefined,
		showInformationMessage: async () => undefined,
		showWarningMessage: async () => undefined,
		showQuickPick: async () => undefined,
		showInputBox: async () => undefined,
		setStatusBarMessage: () => ({ dispose() {} }),
		withProgress: async (_opts, task) => task(),
		createTreeView: () => ({
			onDidChangeSelection: { dispose() {} },
			selection: [],
			reveal: async () => {},
		}),
		createStatusBarItem: () => ({
			text: '',
			tooltip: '',
			command: '',
			show() {},
			hide() {},
			dispose() {},
		}),
		createWebviewPanel: () => ({
			webview: { html: '', onDidReceiveMessage: () => ({ dispose() {} }), postMessage: async () => true },
			onDidDispose: () => ({ dispose() {} }),
			reveal: () => {},
			dispose: () => {},
		}),
		activeTextEditor: undefined,
	},
	commands: {
		executeCommand: async () => {},
		registerCommand: () => ({ dispose() {} }),
	},
	env: {
		clipboard: { writeText: async () => {} },
		openExternal: async () => true,
	},
	extensions: { getExtension: () => undefined },
	languages: {
		registerDocumentLinkProvider: () => ({ dispose() {} }),
		registerDefinitionProvider: () => ({ dispose() {} }),
		registerReferenceProvider: () => ({ dispose() {} }),
		registerCompletionItemProvider: () => ({ dispose() {} }),
		createDiagnosticCollection: name => new DiagnosticCollection(name),
	},
};
