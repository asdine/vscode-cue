import * as vscode from 'vscode';
import path from 'path';
import fs from "fs/promises";
import util from 'util';
const exec = util.promisify(require('child_process').exec);
import os from "os";

export class CueDocumentFormatter implements vscode.DocumentFormattingEditProvider {
    public provideDocumentFormattingEdits(document: vscode.TextDocument):
        Thenable<vscode.TextEdit[]> {
        return format(document)
    }
}

const format = async (document: vscode.TextDocument): Promise<vscode.TextEdit[]> => {
    // copy the document to a temporary file and format it
    // then compute the edits to apply to the original document
    return await withTempFile(async (file: string): Promise<vscode.TextEdit[]> => {
        const content = document.getText()
        await fs.writeFile(file, content);

        try {
            console.log(`cue fmt ${file}`)
            const { stderr } = await exec(`cue fmt ${file}`)
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
                    document.lineAt(document.lineCount - 1).range.end,
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

