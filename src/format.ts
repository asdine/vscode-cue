import * as vscode from 'vscode';
import os from "os";
import path from 'path';
import fs from "fs/promises";
import util from 'util';
const execFile = util.promisify(require('child_process').execFile);
import { spawn } from 'child_process';

export class CueDocumentFormatter implements vscode.DocumentFormattingEditProvider {
    public provideDocumentFormattingEdits(document: vscode.TextDocument):
        Thenable<vscode.TextEdit[]> {
        const config = vscode.workspace.getConfiguration('cue');
        const tool = config.get("formatTool")

        if (tool === "cue fmt") {
            return formatWithCueFmt(document)
        }

        return formatWithCueImports(document)
    }
}

const formatWithCueImports = async (document: vscode.TextDocument): Promise<vscode.TextEdit[]> => {
    const content = document.getText()

    return new Promise<vscode.TextEdit[]>((resolve, reject) => {
        try {
            const command = spawn("cueimports")
            command.stdin.write(content);
            command.stdin.end();

            command.on("error", (err) => {
                vscode.window.showErrorMessage("cueimports not found")
                reject(err);
            });

            let buf = "";

            command.stdout.on('data', output => {
                buf += output.toString();
            })

            command.on('close', (code: Number) => {
                if (code === 0) {
                    resolve([
                        new vscode.TextEdit(
                            new vscode.Range(
                                new vscode.Position(0, 0),
                                new vscode.Position(Number.MAX_VALUE, Number.MAX_VALUE),
                            ),
                            buf,
                        )
                    ])
                }
            })
        } catch (e) {
            reject(e)
        }
    })
};

const formatWithCueFmt = async (document: vscode.TextDocument): Promise<vscode.TextEdit[]> => {
    // copy the document to a temporary file and format it
    // then compute the edits to apply to the original document
    return await withTempFile(async (file: string): Promise<vscode.TextEdit[]> => {
        const content = document.getText()
        await fs.writeFile(file, content);

        try {
            const { stderr } = await execFile("cue", ["fmt", file])
            if (stderr) {
                vscode.window.showErrorMessage(stderr)
                return []
            }
        } catch (e) {
            console.log(e);
            return [];
        }

        const formatted = await fs.readFile(file, "utf8");

        return [
            new vscode.TextEdit(
                new vscode.Range(
                    new vscode.Position(0, 0),
                    new vscode.Position(Number.MAX_VALUE, Number.MAX_VALUE),
                ),
                formatted,
            )
        ];
    });
}

const withTempDir = async (fn: Function) => {
    const dir = await fs.mkdtemp(await fs.realpath(os.tmpdir()) + path.sep);
    try {
        return await fn(dir);
    } finally {
        fs.rm(dir, { recursive: true });
    }
};

const withTempFile = (fn: Function) => withTempDir((dir: string) => fn(path.join(dir, "file.cue")));