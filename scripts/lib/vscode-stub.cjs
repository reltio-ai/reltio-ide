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
	constructor(id) {
		this.id = id;
	}
}

module.exports = {
	Uri,
	EventEmitter,
	TreeItem,
	ThemeIcon,
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
		getConfiguration: () => ({ get: () => undefined, update: async () => {} }),
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
	},
};
