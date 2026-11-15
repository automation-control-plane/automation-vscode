import * as fs from "fs";
import * as os from "os";
import * as path from "path";

let editorStorageRoot: string | undefined;

/** Resolve only; vendor data and legacy caches are never copied or removed. */
export function extensionStorage(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
    const paths = platform === "win32" ? path.win32 : path.posix;
    let root: string;
    if (env.AUTOMATION_EXTENSION_STORAGE) {
        root = env.AUTOMATION_EXTENSION_STORAGE;
    } else if (env.ROBOCORP_CODE_USER_HOME) {
        root = paths.join(env.ROBOCORP_CODE_USER_HOME, ".automation-vscode");
    } else if (platform === "win32") {
        if (!env.LOCALAPPDATA) {
            throw new Error("LOCALAPPDATA is required to resolve extension storage.");
        }
        root = paths.join(env.LOCALAPPDATA, "automation-vscode");
    } else {
        root = paths.join(env.XDG_STATE_HOME || paths.join(env.HOME || os.homedir(), ".local", "state"), "automation-vscode");
    }
    return paths.resolve(root);
}

export function runtimeMetadataDirectory(home: string, platform = process.platform): string {
    return (platform === "win32" ? path.win32 : path.posix).join(home, ".automation-vscode");
}

/** Bind this extension's storage without changing the shared Extension Host environment. */
export function initializeExtensionStorage(defaultRoot: string): string {
    editorStorageRoot = process.env.AUTOMATION_EXTENSION_STORAGE || process.env.ROBOCORP_CODE_USER_HOME
        ? extensionStorage()
        : path.resolve(defaultRoot);
    return editorStorageRoot;
}

export function getExtensionStorage(): string {
    return editorStorageRoot || extensionStorage();
}

/** Each launch gets a private input directory; concurrent same-name actions cannot share input bytes. */
export async function createActionInputDirectory(): Promise<string> {
    const root = path.join(getExtensionStorage(), "inputs");
    await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
    return fs.promises.mkdtemp(path.join(root, "launch-"));
}
