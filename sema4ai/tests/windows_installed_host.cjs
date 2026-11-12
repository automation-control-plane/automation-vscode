// Runs inside real Windows Code. No VS Code, debug adapter, or SDK mocks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const http = require('node:http');
const vscode = require('vscode');

const root = process.env.AUTOMATION_WINDOWS_QA;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE',
    'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMFILES',
    'PROGRAMFILES(X86)', 'PROGRAMDATA', 'ACTIONS_HOME', 'ROBOTS_HOME', 'ROBOCORP_HOME',
    'RCC_HOLOTREE_MODE', 'PYTHONPATH', 'PYTHONHOME', 'CONDA_PREFIX', 'VIRTUAL_ENV',
    'PYTHONUTF8', 'PYTHONNOUSERSITE', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE']);
function environment(extra = {}) {
    return Object.fromEntries(Object.entries({...process.env, ...extra}).filter(([key]) => allowed.has(key.toUpperCase())));
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function execute(file, args, cwd, env, input) {
    const result = cp.spawnSync(file, args, {cwd, env, input, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024});
    // Child stdout/stderr can contain private diagnostics. Do not echo either.
    assert.equal(result.status, 0, 'Owned child failed; no output or environment dumped');
    return result.stdout;
}
async function waitFor(predicate, timeout = 120000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {if (await predicate()) return; await sleep(200);}
    throw Error('Native acceptance timed out; no replay attempted');
}
async function httpStatus(port) {
    return new Promise(resolve => {
        const request = http.get(`http://127.0.0.1:${port}/openapi.json`, response => {response.resume(); resolve(response.statusCode);});
        request.on('error', () => resolve(0)); request.setTimeout(1000, () => request.destroy());
    });
}

exports.run = async () => {
    const report = {platform: process.platform, scope: 'Actual installed Windows Code Extension Host, native registered debug adapters and SDK outputs; not a panel-button or Windows managed acceptance claim.', cases: [], checks: [], passed: false};
    const save = () => fs.writeFileSync(path.join(root, 'public/installed-host.json'), JSON.stringify(report, null, 2));
    let terminal;
    try {
        assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
        assert.ok(vscode.workspace.isTrusted, 'Synthetic test workspace must be trusted before execution');
        const extension = vscode.extensions.getExtension('automation-control-plane.automation-vscode');
        assert.ok(extension && extension.extensionPath.toLowerCase().startsWith(path.join(root, 'extensions').toLowerCase()));
        report.version = extension.packageJSON.version;
        await extension.activate(); assert.ok(extension.isActive);
        report.debugger = ['ms-python.python', 'ms-python.debugpy'].map(id => {
            const dependency = vscode.extensions.getExtension(id); assert.ok(dependency, 'Public Python debugger prerequisite missing');
            return {id, version: dependency.packageJSON.version};
        });
        const python = await vscode.commands.executeCommand('sema4ai.getLanguageServerPythonInfo');
        assert.ok(python?.pythonExe);
        // No configured Python override was written by the driver.
        assert.ok(python.pythonExe.toLowerCase().startsWith(path.join(root, 'actions').toLowerCase()), 'Cold bootstrap must use the isolated Action home');
        report.checks.push('Installed cold RCC Windows bootstrap and real language-server activation'); save();
        for (const [name, command] of [['rcc', 'sema4ai.rccDownload.internal'], ['action-server', 'sema4ai.actionServerDownload.internal']]) {
            const acquired = await vscode.commands.executeCommand(command); assert.ok(acquired?.success);
            const pin = JSON.parse(fs.readFileSync(path.join(extension.extensionPath, 'published-tools.json')))[name];
            assert.equal(hash(acquired.result), pin.assets['win32-x64'].sha256);
            const version = execute(acquired.result, name === 'rcc' ? ['version'] : ['version'], root, environment()).trim();
            assert.equal(version, pin.version);
            report.checks.push({tool: name, version, sha256: pin.assets['win32-x64'].sha256}); save();
        }
        const platformProbe = path.join(__dirname, 'windows_platform_probe.py');
        const probe = execute(python.pythonExe, [platformProbe], root, environment({
            PYTHONPATH: [path.join(extension.extensionPath, 'src'), path.join(extension.extensionPath, 'src/sema4ai_code/vendored')].join(path.delimiter)}));
        report.windowsIntegration = JSON.parse(probe); save();
        const packages = await vscode.commands.executeCommand('sema4ai.localListRobots.internal');
        assert.ok(packages?.success && packages.result.length >= 2);
        const bridgeFile = path.join(extension.extensionPath, 'src/sema4ai_code/work_items_native.py');
        const attachment = fs.readFileSync(path.join(root, 'workspace/attachment-proof.txt'));
        const seen = new Set();
        for (const kind of ['action', 'robot']) {
            const folder = path.join(root, 'workspace', kind), manifest = path.join(folder, kind === 'action' ? 'package.yaml' : 'robot.yaml');
            const resolved = await vscode.commands.executeCommand('sema4ai.resolveInterpreter', {target_robot: manifest});
            assert.ok(resolved?.success && resolved.result?.pythonExe);
            const info = resolved.result, env = environment(info.environ);
            const home = kind === 'action' ? 'actions' : 'robots';
            assert.ok(info.pythonExe.toLowerCase().startsWith(path.join(root, home).toLowerCase()));
            for (const mode of ['file', 'sqlite']) for (const debug of [false, true]) {
                const queue = `native-${kind}-${mode}-${debug ? 'debug' : 'run'}`;
                function bridge(op, values = {}) {
                    const value = JSON.parse(execute(info.pythonExe, [bridgeFile], folder, env,
                        JSON.stringify({manifest, mode, queue, op, ...values})));
                    assert.ok(value.success, 'Installed SDK bridge refused request'); return value.result;
                }
                const input = bridge('create', {payload: {value: 7}, name: queue}).id;
                assert.ok(!seen.has(input)); seen.add(input);
                bridge('attach', {id: input, files: {'attachment-proof.txt': attachment.toString('base64')}, name: 'attachment-proof.txt'});
                assert.deepEqual(Buffer.from(bridge('download', {id: input, name: 'attachment-proof.txt'}).content, 'base64'), attachment);
                const prepared = bridge('prepare', {id: input});
                const source = path.join(folder, kind === 'action' ? 'work_items_actions.py' : 'work_items_tasks.py');
                const lines = fs.readFileSync(source, 'utf8').split(/\r?\n/);
                const start = lines.findIndex(line => line.startsWith('def copy_attachment('));
                const stopLine = lines.findIndex((line, index) => index > start && line.includes('value = item.payload')) + 1;
                assert.ok(stopLine > 0);
                const name = 'Owned Windows ' + queue;
                const config = {type: 'sema4ai', request: 'launch', name, noDebug: !debug, automationWorkItems: prepared.env};
                if (kind === 'action') {
                    const actions = await vscode.commands.executeCommand('sema4ai.listActions.internal', {action_package: vscode.Uri.file(manifest).toString()});
                    assert.ok(actions?.success); const action = actions.result.find(item => item.name === 'copy_attachment'); assert.ok(action);
                    Object.assign(config, {package: manifest, actionName: action.name, uri: action.uri, jsonInput: prepared.parameters});
                } else Object.assign(config, {robot: manifest, task: 'Copy Work Item Attachment'});
                let exited, terminated = false, stopped = false, nativeError;
                const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(source), new vscode.Position(stopLine - 1, 0)));
                if (debug) vscode.debug.addBreakpoints([breakpoint]);
                const tracker = vscode.debug.registerDebugAdapterTrackerFactory('*', {createDebugAdapterTracker: session => {
                    if (session.name !== name) return;
                    return {onDidSendMessage(message) {
                        if (message.type !== 'event') return;
                        if (message.event === 'exited') exited = message.body?.exitCode;
                        if (message.event === 'stopped') {
                            if (!debug || message.body?.reason !== 'breakpoint') {nativeError = 'Unexpected native stop'; return;}
                            stopped = true; vscode.debug.removeBreakpoints([breakpoint]);
                            void session.customRequest('continue', {threadId: message.body.threadId}).catch(() => {nativeError = 'Native continue failed';});
                        }
                    }, onError() {nativeError = 'Native debug adapter error';}};
                }});
                const ended = vscode.debug.onDidTerminateDebugSession(session => {if (session.name === name) terminated = true;});
                try {
                    assert.ok(await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(vscode.Uri.file(manifest)), config));
                    await waitFor(() => {if (nativeError) throw Error(nativeError); return exited !== undefined && terminated;}, 180000);
                    assert.equal(exited, 0); assert.equal(stopped, debug);
                } finally {tracker.dispose(); ended.dispose(); vscode.debug.removeBreakpoints([breakpoint]);}
                const state = bridge('list'); let output;
                if (mode === 'file') {
                    const file = prepared.env.RC_WORKITEM_OUTPUT_PATH, data = JSON.parse(fs.readFileSync(file));
                    assert.deepEqual(data[0].payload, {observed: 7});
                    assert.deepEqual(fs.readFileSync(path.resolve(path.dirname(file), data[0].files['copied-proof.txt'])), attachment);
                    output = state.items.find(item => item.role === 'output' && item.id.startsWith(path.relative(folder, file)));
                } else {
                    const original = state.items.find(item => item.id === input);
                    assert.equal(original.state, 'COMPLETED'); output = state.items.find(item => item.parent_id === input);
                    assert.deepEqual(output.payload, {observed: 7});
                }
                assert.ok(output);
                assert.deepEqual(Buffer.from(bridge('download', {id: output.id, name: 'copied-proof.txt'}).content, 'base64'), attachment);
                const copy = bridge('replay', {id: output.id, payload: {value: 8}, source_payload: {observed: 7}, name: 'edited'}).id;
                assert.notEqual(copy, output.id);
                const after = bridge('list'); assert.deepEqual(after.items.find(item => item.id === copy).payload, {value: 8});
                assert.deepEqual(after.items.find(item => item.id === output.id).payload, {observed: 7});
                report.cases.push({kind, mode, operation: debug ? 'debug' : 'run', nativeExit: exited,
                    realBreakpoint: stopped, outputAndAttachmentVerified: true, editedReplayPreservesOriginal: true}); save();
            }
        }
        assert.equal(report.cases.length, 8); assert.equal(report.cases.filter(item => item.realBreakpoint).length, 4);
        const runtime = require(path.join(extension.extensionPath, 'vscode-client/out/actionServer.js'));
        const directory = vscode.Uri.file(path.join(root, 'workspace/action'));
        const sentinel = http.createServer((_, response) => response.end('{}'));
        await new Promise(resolve => sentinel.listen(18526, '127.0.0.1', resolve));
        try {const before = vscode.window.terminals.length; await runtime.startActionServer(directory); assert.equal(vscode.window.terminals.length, before); assert.ok(sentinel.listening);}
        finally {await new Promise(resolve => sentinel.close(resolve));}
        assert.equal(await httpStatus(18526), 0);
        await runtime.startActionServer(directory); terminal = runtime.getActionServerTerminal(); assert.ok(terminal);
        await waitFor(async () => await httpStatus(18526) === 200, 180000);
        terminal.dispose(); terminal = undefined; await waitFor(async () => await httpStatus(18526) === 0, 30000);
        report.checks.push('Windows Runtime live-terminal startup/stop; occupied listener refused untouched');
        report.runtimeRecovery = 'Windows recovery after host reload remains fail-closed: process identity backend is Linux-only. No ownership or cancellation authority inferred from HTTP.';
        report.passed = true; save();
    } catch (error) {
        report.blocker = String(error); save(); throw error;
    } finally {if (terminal) terminal.dispose();}
};
