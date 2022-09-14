// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { CueDocumentFormatter } from './format';
import { lintPackage } from './lint';
import commandExists from 'command-exists';

let diagnosticCollection: vscode.DiagnosticCollection;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Set up diagnostics for the linter
	diagnosticCollection = vscode.languages.createDiagnosticCollection('cue');
	context.subscriptions.push(diagnosticCollection);

	// Register the cue.lint command
	let disposable = vscode.commands.registerCommand('cue.lint', lintCommand);

	context.subscriptions.push(disposable);

	// Run the linter on save
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(lintCommand),
		vscode.workspace.onDidSaveTextDocument(lintCommand)
	);

	// Register the formatter
	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(
			"cue", new CueDocumentFormatter()));

	commandExists("cueimports").catch((err) => {
		console.log("cueimports not found. Installing ...")
	})
}

// this method is called when your extension is deactivated
export function deactivate() { }

async function lintCommand(document?: vscode.TextDocument) {
	if (!document) {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			vscode.window.showErrorMessage('No active editor')
			return
		}

		document = editor.document;

		if (document.languageId !== "cue") {
			vscode.window.showErrorMessage('Document is not a CUE file')
			return
		}
	} else {
		const config = vscode.workspace.getConfiguration('cue');
		if (config.get("lintOnSave") !== "package") {
			return
		}
	}

	if (document.languageId === "cue") {
		await lintPackage(document, diagnosticCollection)
	}
}