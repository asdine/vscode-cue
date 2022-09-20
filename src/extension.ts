// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { CueDocumentFormatter } from './format';
import { lintCommand } from './lint';
import { updateToolsCommand, ensureLastVersion, ensureTools } from './tools';

let diagnosticCollection: vscode.DiagnosticCollection;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Set up diagnostics for the linter
	diagnosticCollection = vscode.languages.createDiagnosticCollection('Cue');
	context.subscriptions.push(diagnosticCollection);

	// Set up the output channel
	const outputChannel = vscode.window.createOutputChannel('Cue');
	context.subscriptions.push(outputChannel);

	// Create commands
	const lintCmd = lintCommand(diagnosticCollection)

	// Register commands
	let disposable = vscode.commands.registerCommand('cue.lint', lintCmd);
	context.subscriptions.push(disposable);
	disposable = vscode.commands.registerCommand('cue.updateTools', updateToolsCommand(outputChannel));
	context.subscriptions.push(disposable);

	// Run the linter on save
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(lintCmd),
		vscode.workspace.onDidSaveTextDocument(lintCmd),
	);

	// Register the formatter
	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(
			"cue", new CueDocumentFormatter(outputChannel)));

	ensureTools(outputChannel).then((alreadyInstalled) => {
		if (alreadyInstalled) {
			ensureLastVersion(outputChannel)
		}
	})
}

// this method is called when your extension is deactivated
export function deactivate() { }

