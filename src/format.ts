import * as vscode from 'vscode';
import path from 'path';
import fs from "fs/promises";
import util from 'util';
import { spawn } from 'child_process';
import { withTempFile } from './helpers';
import { ensureTools } from './tools';
const execFile = util.promisify(require('child_process').execFile);

export class CueDocumentFormatter implements vscode.DocumentFormattingEditProvider {
    log: vscode.OutputChannel;
    constructor(log: vscode.OutputChannel) {
        this.log = log;
    }

    public provideDocumentFormattingEdits(document: vscode.TextDocument):
        Thenable<vscode.TextEdit[]> {
        const config = vscode.workspace.getConfiguration('cue');
        const tool = config.get("formatTool")

        if (tool === "cue fmt") {
            return formatWithCueFmt(document)
        }

        return formatWithCueImports(this.log, document)
    }
}

const formatWithCueImports = async (log: vscode.OutputChannel, document: vscode.TextDocument): Promise<vscode.TextEdit[]> => {
    // get the directory path of the current document
    const dir = path.dirname(document.uri.fsPath);

    const content = document.getText()

    return new Promise<vscode.TextEdit[]>((resolve, reject) => {
        try {
            const command = spawn("cueimports", [], { cwd: dir });
            command.stdin.write(content);
            command.stdin.end();

            command.on("error", (err) => {
                log.appendLine("Error running cueimports: " + err);
                ensureTools(log).catch(reject)
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

