import * as vscode from 'vscode';
import path, { format } from 'path';
import util from 'util';
import { ExecException } from 'child_process';
const execFile = util.promisify(require('child_process').execFile);

export function lintCommand(diagnosticCollection: vscode.DiagnosticCollection) {
    return async function (document?: vscode.TextDocument) {
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
}

export async function lintPackage(currentDocument: vscode.TextDocument, diagnosticCol: vscode.DiagnosticCollection) {
    // get the directory path of the current document
    const dir = path.dirname(currentDocument.uri.fsPath);

    const config = vscode.workspace.getConfiguration('cue');
    const flags = config.get("lintFlags") as string[];

    try {
        diagnosticCol.clear();
        const { stderr } = await execFile('cue', ['vet', ...flags], { cwd: dir })
        parseCueVetErrors(currentDocument, diagnosticCol, stderr);
        return;
    } catch (e) {
        parseCueVetErrors(currentDocument, diagnosticCol, (e as ExecException).message.split("\n").slice(1).join("\n"));
    }
}

function parseCueVetErrors(currentDocument: vscode.TextDocument, diagnosticCol: vscode.DiagnosticCollection, output: string) {
    if (!output) {
        return
    }
    // split lines
    const lines = output.split(/\r?\n/);
    // remove last line if it's empty
    if (lines[lines.length - 1] === "") {
        lines.pop();
    }
    if (lines.length === 0) {
        return;
    }

    // each error is written in two groups:
    // one or more lines for the error message
    // one or more lines for the location, starting with multiple spaces

    // error location:
    //     <file>:<line>:<col>
    const eLoc = /^\s+(.+):(\d+):(\d+)$/;
    // error location with no line/col:
    //     <file>: <message>
    const eNoLoc = /^\s+(.+):\s+(.+)$/;

    let diagnosticMap: Map<string, vscode.Diagnostic[]> = new Map();

    let i = 0;
    while (i < lines.length) {
        let errMsg = ""
        while (i < lines.length && !lines[i].startsWith("  ")) {
            if (errMsg.length > 0) {
                errMsg += "\n"
            }
            errMsg += lines[i];
            i++;
        }
        if (errMsg.startsWith("some instances are incomplete")) {
            continue
        }
        if (errMsg.endsWith(":")) {
            errMsg = errMsg.slice(0, -1);
        }

        if (i >= lines.length) {
            addToDiagnostics(currentDocument, diagnosticMap, currentDocument.fileName, 0, 0, errMsg);
            break;
        }

        while (i < lines.length && lines[i].startsWith("  ")) {
            let r = eLoc.exec(lines[i]);
            if (r) {
                const file = r[1];
                const line = parseInt(r[2]);
                const col = parseInt(r[3]);
                addToDiagnostics(currentDocument, diagnosticMap, file, line, col, errMsg);
            } else {
                // try with eNoLoc
                r = eNoLoc.exec(lines[i])
                if (!r) {
                    break;
                }
                const file = r[1];
                const msg = r[2];
                addToDiagnostics(currentDocument, diagnosticMap, file, 0, 0, errMsg + " " + msg);
            }
            i++
        }
    }

    diagnosticMap.forEach((diags, file) => {
        diagnosticCol.set(vscode.Uri.parse(file), diags);
    });
}

function addToDiagnostics(currentDocument: vscode.TextDocument, diagnosticMap: Map<string, vscode.Diagnostic[]>, file: string, line: number, col: number, errMsg: string) {
    // file path is relative to the current document directory.
    // we need to convert it to a path relative to the workspace root.
    const dir = path.dirname(currentDocument.uri.fsPath);
    let canonicalFile = vscode.Uri.file(path.resolve(dir, file)).toString();

    const range = new vscode.Range(
        new vscode.Position(line - 1, col - 1),
        new vscode.Position(line - 1, col - 1)
    );

    let diagnostics = diagnosticMap.get(canonicalFile)
    if (!diagnostics) { diagnostics = []; }
    diagnostics.push(new vscode.Diagnostic(
        range,
        errMsg,
        vscode.DiagnosticSeverity.Error
    ));
    diagnosticMap.set(canonicalFile, diagnostics);
}