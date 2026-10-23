import {readFileSync} from "fs";
import * as path from "path";
/** Owned plain HTML templates share the same tokens without changing their protocol. */
export function decorateRunbookForm(template: string, theme: string, styles: string): string {
    const end = template.indexOf("</head>");
    if (end < 0) throw Error("Form template is missing its document head.");
    return template.slice(0, end) + `<style id="automation-form-theme">${theme}\n${styles}</style>` + template.slice(end);
}
export function renderRunbookForm(template: string): string {
    const resources = path.resolve(__dirname, "../../resources/runbook");
    return decorateRunbookForm(template, readFileSync(path.join(resources,"theme.css"), "utf8"), readFileSync(path.join(resources,"forms.css"), "utf8"));
}
