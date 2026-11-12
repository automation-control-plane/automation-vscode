import { createHash } from "crypto";

/**
 * The upstream Inspector and log viewer remain compatibility engines. This
 * adapter owns their document shell, not their minified implementation. New
 * product styles and controls live in resources/runbook and are reviewable.
 */
export interface LegacySurfaceOptions {
    surface: "inspector" | "output";
    template: string;
    theme: string;
    styles: string;
    script: string;
    markup: string;
    context: Record<string, unknown>;
    cspSource: string;
}

function jsonForScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Replace a documented, empty JSON data slot, never executable bundle text. */
export function replaceJSONSlot(document: string, id: "controlJSON" | "locatorsJSON", value: unknown): string {
    const start = `<script id="${id}" type="application/json">`;
    const offset = document.indexOf(start);
    const end = document.indexOf("</script>", offset + start.length);
    if (offset < 0 || end < 0 || document.indexOf(start, offset + start.length) >= 0) {
        throw Error(`Invalid compatibility template JSON slot: ${id}`);
    }
    return document.slice(0, offset + start.length) + jsonForScript(value) + document.slice(end);
}

/** Construct a CSP-qualified document while retaining every engine byte. */
export function renderLegacySurface(options: LegacySurfaceOptions): string {
    const { template, surface, theme, styles, script, markup, context } = options;
    const tags = [...template.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>|<\/?(?:head|body)>/g)].filter(match => !match[0].startsWith("<script"));
    const positions = new Map<string, number>();
    for (const delimiter of ["<head>", "</head>", "<body>", "</body>"]) {
        const matches = tags.filter(match => match[0] === delimiter);
        if (matches.length !== 1) {
            throw Error(`Invalid compatibility template: expected one ${delimiter}`);
        }
        positions.set(delimiter, matches[0].index);
    }
    // Hash the scripts verbatim. React's runtime-generated styles still require
    // inline styles; script execution never uses unsafe-inline or unsafe-eval.
    const hashes: string[] = [];
    for (const match of template.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (!/type=["']application\/json["']/.test(match[1])) {
            hashes.push("'sha256-" + createHash("sha256").update(match[2]).digest("base64") + "'");
        }
    }
    if (script) hashes.push("'sha256-" + createHash("sha256").update(script).digest("base64") + "'");
    // VS Code supplies a source list, currently `'self' https://*.vscode-cdn.net`,
    // not a single URL. Accept only self and HTTP(S) resource origins/paths.
    const sources = options.cspSource.trim().split(/\s+/);
    if (!sources.length || sources.some(source => source !== "'self'" && !/^https?:\/\/(?:\*\.)?[A-Za-z0-9+.-]+(?::[0-9]+)?(?:\/[A-Za-z0-9+_./%-]*)?$/.test(source))) {
        throw Error("Invalid webview resource origin.");
    }
    const policy = ["default-src 'none'", `img-src ${options.cspSource} data: blob:`, `font-src ${options.cspSource} data:`, "style-src 'unsafe-inline'", "script-src " + (hashes.length ? hashes.join(" ") : "'none'"), "connect-src 'none'"].join("; ");
    const head = `<meta http-equiv="Content-Security-Policy" content="${policy}"><style id="automation-shared-theme">${theme}</style><style id="automation-legacy-surfaces">${styles}</style>`;
    const data = `<script id="automation-surface-context" type="application/json">${jsonForScript(context)}</script>`;
    const edits = [
        { tag: "<head>", content: "<head>" + head },
        { tag: "<body>", content: `<body data-automation-surface="${surface}">` + data + markup },
        { tag: "</body>", content: (script ? `<script>${script}</script>` : "") + "</body>" },
    ].sort((a, b) => positions.get(b.tag) - positions.get(a.tag));
    let result = template;
    for (const edit of edits) {
        const position = positions.get(edit.tag);
        result = result.slice(0, position) + edit.content + result.slice(position + edit.tag.length);
    }
    return result;
}
