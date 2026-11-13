// Copied into the controller; the driver binds originalHarness to the exact source.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vscode = require('vscode');

exports.run = async () => {
    const root = process.env.AUTOMATION_WINDOWS_QA;
    const folders = vscode.workspace.workspaceFolders || [];
    assert.equal(folders.length, 1, 'Only the synthetic workspace may be opened');
    const canonical = value => fs.realpathSync(value).replace(/\//g, '\\').toLowerCase();
    const workspace = canonical(path.join(root, 'workspace'));
    assert.equal(canonical(folders[0].uri.fsPath), workspace, 'Exact owned workspace required');
    assert.equal(vscode.workspace.getConfiguration('security.workspace.trust').get('enabled', true), true);
    const destination = path.join(root, 'public/trust-entry.json');
    const report = {passed: false, workspaceTrust: {enabled: true, folderCount: 1,
        exactSyntheticWorkspace: true,
        canonicalWorkspaceSha256: crypto.createHash('sha256').update(workspace).digest('hex')},
        scope: 'Controller-local native UI trust before importing unchanged installed acceptance harness'};
    const save = () => fs.writeFileSync(destination, JSON.stringify(report, null, 2));
    save();
    if (!vscode.workspace.isTrusted) {
        await vscode.commands.executeCommand('workbench.trust.manage');
        const deadline = Date.now() + 120000;
        while (!vscode.workspace.isTrusted && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
    assert.ok(vscode.workspace.isTrusted, 'Exact workspace trust must be granted through native UI');
    report.workspaceTrust.currentWorkspaceGranted = true;
    save();
    const identity = JSON.parse(fs.readFileSync(path.join(root, 'public/installed-identity.json')));
    const deadline = Date.now() + 60000;
    while (!vscode.extensions.getExtension(identity.id) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(vscode.extensions.getExtension(identity.id), 'Installed extension must be registered before acceptance import');
    report.passed = true;
    save();
    // No replay, assertion changes, or trust-store mutation. The exact original
    // harness still verifies installed identity, trust, payloads and all workloads.
    await require(originalHarness).run();
};
