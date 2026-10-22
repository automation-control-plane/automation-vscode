import * as fs from "fs";
import * as path from "path";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function publishedTool(name: "rcc" | "action-server", platform = process.platform, arch = process.arch) {
    const manifest: unknown = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, "../../published-tools.json"), "utf8")
    );
    const tool = isRecord(manifest) ? manifest[name] : undefined;
    if (!isRecord(tool) || !isRecord(tool.assets)) {
        throw new Error("Invalid published tool manifest.");
    }
    const asset = tool.assets[`${platform}-${arch}`];
    if (
        !isRecord(asset) ||
        typeof asset.name !== "string" ||
        typeof asset.sha256 !== "string" ||
        typeof tool.repository !== "string" ||
        typeof tool.tag !== "string" ||
        typeof tool.version !== "string"
    ) {
        throw new Error(`No published ${name} artifact for ${platform}-${arch}.`);
    }
    return {
        name: asset.name,
        sha256: asset.sha256,
        version: tool.version,
        url: `https://github.com/${tool.repository}/releases/download/${tool.tag}/${asset.name}`,
    };
}

export function extensionIdentity() {
    const manifest: unknown = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));
    if (
        !isRecord(manifest) ||
        typeof manifest.name !== "string" ||
        typeof manifest.publisher !== "string" ||
        typeof manifest.version !== "string"
    ) {
        throw new Error("Invalid extension manifest identity.");
    }
    return { id: `${manifest.publisher}.${manifest.name}`, version: manifest.version };
}
