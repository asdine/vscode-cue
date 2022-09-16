import * as vscode from 'vscode';
import commandExists from 'command-exists';
import { Octokit } from "octokit";
import os from "os";
import fsp from "fs/promises";
import path from "path";
import tar from "tar-fs";
import zlib from "zlib";
import { https } from 'follow-redirects';

import { withTempDir } from './helpers';

export async function ensureTools(log: vscode.OutputChannel) {
    // Install the cueimports tool if missing
    try {
        await commandExists("cueimports")
    }
    catch (err) {
        // check if the tool is already installed
        // but not in the path
        const toolsPath = getToolsPath()
        const cueimportsPath = path.join(toolsPath, "cueimports");
        try {
            await fsp.access(cueimportsPath);
            // If we get here, the tool is installed but not in the path
            log.show(true);
            log.appendLine(`cueimports is installed but not in the path. Please add ${toolsPath} to your PATH.`);
            log.appendLine("You can also change the install location by updating the cue.toolsPath setting.");
            return
        } catch (err) {
            log.show(true);
            log.appendLine("cueimports not found.")
            return installLatestToolsVersion(log, toolsPath)
        }
    }
}

function getToolsPath(): string {
    const config = vscode.workspace.getConfiguration('cue');
    let toolsPath = config.get("toolsPath") as string
    if (!toolsPath) {
        toolsPath = path.join(os.homedir(), ".bin")
    } else {
        // resolve env vars that may be in the path
        // @ts-ignore
        toolsPath = toolsPath.replace(/\$([A-Z_]+[A-Z0-9_]*)|\${([A-Z0-9_]*)}/ig, (_, a, b) => process.env[a || b])
        // toolsPath = toolsPath.replace(/%([^%]+)%/g, (_, n) => process.env[n])
    }
    return toolsPath
}

export function updateToolsCommand(log: vscode.OutputChannel) {
    log.show(true);
    return async function (document?: vscode.TextDocument) {
        const toolsPath = getToolsPath()
        return await installLatestToolsVersion(log, toolsPath)
    }
}

async function installLatestToolsVersion(log: vscode.OutputChannel, toolsPath: string) {
    log.appendLine("Installing cueimports...")
    const octokit = new Octokit();

    try {
        const { data } = await octokit.rest.repos.getLatestRelease({ owner: "asdine", repo: "cueimports" });
        const { assets } = data;

        // download the asset for the current platform
        const platform = process.platform;
        const arch = process.arch;
        const asset = assets.find(a => a.name.toLowerCase().includes(platform) && a.name.toLowerCase().includes(arch));
        if (!asset) {
            log.appendLine(`No cueimports build found for platform ${platform} and arch ${arch}`);
            log.appendLine(`You can build cueimports from source at https://github.com/asdine/cueimports`);
            return
        }
        const { browser_download_url } = asset;
        log.appendLine(`Downloading cueimports from ${browser_download_url}`);

        // download and untar the asset
        const q = https.get(browser_download_url, async (res) => {
            if (res.statusCode !== 200) {
                log.appendLine(`Failed to download cueimports: ${res.statusMessage} ${res.statusCode}`);
                return
            }

            await withTempDir(async (dir: string) => {
                await new Promise<void>(resolve => {
                    const finish = async () => {
                        await fsp.mkdir(toolsPath, { recursive: true });
                        const dest = path.join(toolsPath, "cueimports");
                        await fsp.copyFile(path.join(dir, 'cueimports'), dest);
                        log.appendLine(`cueimports downloaded successfully to ${dest}`);
                        log.appendLine(`Please make sure ${dest} is in your PATH.`);
                        log.appendLine("You can also change the install location by setting the cue.toolsPath setting.");
                        log.appendLine("");
                        log.appendLine("Enjoy! :)")
                        resolve()
                    }

                    // @ts-ignore
                    res.pipe(zlib.createGunzip()).pipe(tar.extract(dir, { finish }));
                })
            })
        });

        q.on("error", (err) => {
            console.error(err);
        });
    } catch (e) {
        log.appendLine(`Couldn't download cueimports: ${e}`)
        return
    }
}