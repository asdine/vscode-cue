import * as vscode from 'vscode';
import commandExists from 'command-exists';
import { Octokit } from "octokit";
import os from "os";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import tar from "tar-fs";
import zlib from "zlib";
import { https } from 'follow-redirects';
import util from 'util';
const execFile = util.promisify(require('child_process').execFile);
import { withTempDir } from './helpers';

export async function ensureTools(log: vscode.OutputChannel): Promise<boolean> {
    // Install the cueimports tool if missing
    try {
        await commandExists("cueimports")
        return true;
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
            return false
        } catch (err) {
            log.show(true);
            log.appendLine("cueimports not found.")
            log.appendLine("Installing cueimports...")
            await installLatestToolsVersion(log, toolsPath, true)
            return false
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
    }
    return toolsPath
}

export function updateToolsCommand(log: vscode.OutputChannel) {
    return async function (document?: vscode.TextDocument) {
        log.show(true);
        log.appendLine("Installing cueimports...")
        const toolsPath = getToolsPath()
        return await installLatestToolsVersion(log, toolsPath, true)
    }
}

export async function ensureLastVersion(log: vscode.OutputChannel) {
    log.appendLine("Ensuring latest version of cueimports is installed...")
    const toolsPath = getToolsPath()
    return await installLatestToolsVersion(log, toolsPath)
}

let installPromise: Promise<void> | undefined = undefined

async function installLatestToolsVersion(log: vscode.OutputChannel, toolsPath: string, force: boolean = false) {
    if (installPromise) {
        log.appendLine("cueimports is already being installed. Skipping.")
        return installPromise
    }

    try {
        installPromise = downloadAndInstall(log, toolsPath, force)
        await installPromise;
    } finally {
        installPromise = undefined
    }
}

async function downloadAndInstall(log: vscode.OutputChannel, toolsPath: string, force: boolean = false) {
    const octokit = new Octokit();

    try {
        const { data } = await octokit.rest.repos.getLatestRelease({ owner: "asdine", repo: "cueimports" });
        const { assets } = data;

        if (!force) {
            const yes = await shouldUpdate(log, data.tag_name);
            if (!yes) {
                return
            }
        }
        // download the asset for the current platform
        const platform = process.platform;
        const arch = process.arch;
        let asset;
        if (platform === "darwin") {
            asset = assets.find(a => a.name.toLowerCase().includes("macos_universal"));
        } else {
            asset = assets.find(a => a.name.toLowerCase().includes(platform) && a.name.toLowerCase().includes(arch));
        }
        if (!asset) {
            log.appendLine(`No cueimports build found for platform ${platform} and arch ${arch}`);
            log.appendLine(`You can build cueimports from source at https://github.com/asdine/cueimports`);
            return
        }
        const { browser_download_url } = asset;
        log.appendLine(`Downloading cueimports from ${browser_download_url} ...`);

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

                    if (platform === "darwin") {
                        // on mac, we need to store the zip on disk and unzip it
                        const file = fs.createWriteStream(path.join(dir, 'cueimports.zip'));
                        res.pipe(file);
                        file.on('finish', async () => {
                            await execFile("unzip", [path.join(dir, "cueimports.zip")], { cwd: dir })
                            await finish()
                        });
                    } else {
                        // @ts-ignore
                        res.pipe(zlib.createGunzip()).pipe(tar.extract(dir, { finish }));
                    }
                })
            })
        });

        q.on("error", (err) => {
            throw err
        });
    } catch (e) {
        log.appendLine(`Couldn't download cueimports: ${e}`)
        return
    }
}

async function shouldUpdate(log: vscode.OutputChannel, tag: string): Promise<boolean> {
    try {
        const { stdout } = await execFile("cueimports", ["-version"])
        const current = stdout.trim();
        if (current === "development") {
            log.appendLine("cueimports is installed from source. Skipping update.")
            return false
        }

        if ("v" + current !== tag) {
            log.appendLine(`cueimports is out of date. Current version is ${current}, latest is ${tag}.`)
            return true
        }
        log.appendLine("cueimports is already up to date.")
        return false
    } catch (e) {
        const err = e as Error
        if (err.message.includes("flag provided but not defined: -version")) {
            log.appendLine(`cueimports is out of date. Current version is v0.1.0, latest is ${tag}.`)
            return true
        }

        log.appendLine(`Couldn't check cueimports version: ${e}. Skipping error and updating cueimports.`)
        return true
    }
}
