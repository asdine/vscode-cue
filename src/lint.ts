import * as vscode from 'vscode';
import path, { format } from 'path';
import util from 'util';
import { ExecException } from 'child_process';
const exec = util.promisify(require('child_process').exec);

export async function lintPackage(currentDocument: vscode.TextDocument, diagnosticCol: vscode.DiagnosticCollection) {
    // get the directory path of the current document
    const dir = path.dirname(currentDocument.uri.fsPath);

    try {
        const { stderr } = await exec('cue vet', { cwd: dir })
        diagnosticCol.clear();
        parseCueVetErrors(currentDocument, diagnosticCol, stderr);
        return;
    } catch (e) {
        parseCueVetErrors(currentDocument, diagnosticCol, (e as ExecException).message.split("\n").slice(1).join("\n"));
    }
}

function parseCueVetErrors(currentDocument: vscode.TextDocument, diagnosticCol: vscode.DiagnosticCollection, output: string) {
    // split lines
    const lines = output.split(/\r?\n/);
    if (lines.length === 0) {
        return;
    }

    // each error is written in two lines:
    // one line for the error message
    // one line for the error location

    // error location:
    //     <file>:<line>:<col>
    const eLoc = /^\s+(.+):(\d+):(\d+)$/;

    let diagnosticMap: Map<string, vscode.Diagnostic[]> = new Map();

    let i = 0;
    while (i < lines.length) {
        const errMsg = lines[i];
        i++;
        if (errMsg === "") {
            continue
        }

        if (i >= lines.length) {
            break;
        }

        const r = eLoc.exec(lines[i]);
        i++;
        if (!r) {
            continue
        }

        const file = r[1];
        const line = parseInt(r[2]) - 1;
        const col = parseInt(r[3]);

        // file path is relative to the current document directory.
        // we need to convert it to a path relative to the workspace root.
        const dir = path.dirname(currentDocument.uri.fsPath);
        let canonicalFile = vscode.Uri.file(path.resolve(dir, file)).toString();

        const range = new vscode.Range(
            new vscode.Position(line, col),
            new vscode.Position(line, col)
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

    diagnosticMap.forEach((diags, file) => {
        diagnosticCol.set(vscode.Uri.parse(file), diags);
    });
}