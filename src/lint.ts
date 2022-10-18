import * as vscode from "vscode";
import path, { format } from "path";
import util from "util";
import fs from "fs";
import { ExecException } from "child_process";
const execFile = util.promisify(require("child_process").execFile);

export function lintCommand(diagnosticCollection: vscode.DiagnosticCollection) {
    return async function (document?: vscode.TextDocument) {
        if (!document) {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage("No active editor");
                return;
            }

            document = editor.document;

            if (document.languageId !== "cue") {
                vscode.window.showErrorMessage("Document is not a CUE file");
                return;
            }
        } else {
            const config = vscode.workspace.getConfiguration("cue");
            if (config.get("lintOnSave") !== "package") {
                return;
            }
        }

        if (document.languageId === "cue") {
            await lintPackage(document, diagnosticCollection);
        }
    };
}

export async function lintPackage(
    currentDocument: vscode.TextDocument,
    diagnosticCol: vscode.DiagnosticCollection
) {
    // get the directory path of the current document
    const dir = path.dirname(currentDocument.uri.fsPath);

    const config = vscode.workspace.getConfiguration("cue");
    let flags = config.get("lintFlags") as string[];

    // if the user didn't specify any flags,
    // use -c but skip incomplete errors
    let skipIncomplete = !flags || flags.length === 0;
    if (skipIncomplete) {
        flags = ["-c"];
    }

    try {
        diagnosticCol.clear();
        const { stderr } = await execFile("cue", ["vet", ...flags], {
            cwd: dir,
        });
        parseCueVetErrors(
            currentDocument,
            diagnosticCol,
            stderr,
            skipIncomplete
        );
        return;
    } catch (e) {
        parseCueVetErrors(
            currentDocument,
            diagnosticCol,
            (e as ExecException).message.split("\n").slice(1).join("\n"),
            skipIncomplete
        );
    }
}

function parseCueVetErrors(
    currentDocument: vscode.TextDocument,
    diagnosticCol: vscode.DiagnosticCollection,
    output: string,
    skipIncomplete: boolean
) {
    if (!output) {
        return;
    }
    console.log("cue vet output: ", output);
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
        let errMsg = "";
        while (i < lines.length && !lines[i].startsWith("  ")) {
            if (errMsg.length > 0) {
                errMsg += "\n";
            }
            errMsg += lines[i];
            i++;
        }
        if (errMsg.endsWith(":")) {
            errMsg = errMsg.slice(0, -1);
        }

        if (i >= lines.length) {
            addToDiagnostics(
                currentDocument,
                diagnosticMap,
                currentDocument.fileName,
                0,
                0,
                errMsg,
                skipIncomplete
            );
            break;
        }

        while (i < lines.length && lines[i].startsWith("  ")) {
            let r = eLoc.exec(lines[i]);
            if (r) {
                const file = r[1];
                const line = parseInt(r[2]);
                const col = parseInt(r[3]);
                addToDiagnostics(
                    currentDocument,
                    diagnosticMap,
                    file,
                    line,
                    col,
                    errMsg,
                    skipIncomplete
                );
            } else {
                // try with eNoLoc
                r = eNoLoc.exec(lines[i]);
                if (!r) {
                    break;
                }
                const file = r[1];
                const msg = r[2];
                addToDiagnostics(
                    currentDocument,
                    diagnosticMap,
                    file,
                    0,
                    0,
                    errMsg + " " + msg,
                    skipIncomplete
                );
            }
            i++;
        }
    }

    diagnosticMap.forEach((diags, file) => {
        diagnosticCol.set(vscode.Uri.parse(file), diags);
    });
}

function addToDiagnostics(
    currentDocument: vscode.TextDocument,
    diagnosticMap: Map<string, vscode.Diagnostic[]>,
    file: string,
    line: number,
    col: number,
    errMsg: string,
    skipIncomplete: boolean
) {
    if (skipIncomplete) {
        if (errMsg.startsWith("some instances are incomplete")) {
            return;
        }
        if (errMsg.includes("incomplete value")) {
            return;
        }
        if (errMsg.includes("non-concrete value")) {
            return;
        }
    }
    // file is either a path relative to the root of the cue workspace (where the cue.mod is located)
    // or relative to the current document directory.
    // If it's the latter, we need to convert it to a path relative to the workspace root.
    let baseDir: string;
    if (file.startsWith(".")) {
        baseDir = path.dirname(currentDocument.uri.fsPath);
    } else {
        baseDir = getCueModulePath(path.dirname(currentDocument.uri.fsPath));
    }
    const canonicalFile = vscode.Uri.file(
        path.resolve(baseDir, file)
    ).toString();

    line--;
    col--;
    if (line < 0) {
        line = 0;
    }
    if (col < 0) {
        col = 0;
    }

    const range = new vscode.Range(
        new vscode.Position(line, col),
        new vscode.Position(line, col)
    );

    let diagnostics = diagnosticMap.get(canonicalFile);
    if (!diagnostics) {
        diagnostics = [];
    }
    diagnostics.push(
        new vscode.Diagnostic(range, errMsg, vscode.DiagnosticSeverity.Error)
    );
    diagnosticMap.set(canonicalFile, diagnostics);
}

// looks for a cue.mod directory in the current directory or any parent directory.
// it returns the parent directory of the cue.mod directory.
function getCueModulePath(dir: string): string {
    if (!dir) {
        return "";
    }
    while (dir !== path.dirname(dir)) {
        const mod = path.join(dir, "cue.mod");
        if (fs.existsSync(mod)) {
            return dir;
        }
        dir = path.dirname(dir);
    }
    return "";
}
