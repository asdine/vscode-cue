import os from "os";
import path from "path";
import fs from "fs/promises";

export const withTempDir = async (fn: Function) => {
    const dir = await fs.mkdtemp((await fs.realpath(os.tmpdir())) + path.sep);
    try {
        return await fn(dir);
    } finally {
        fs.rm(dir, { recursive: true });
    }
};

export const withTempFile = (fn: Function) =>
    withTempDir((dir: string) => fn(path.join(dir, "file.cue")));
