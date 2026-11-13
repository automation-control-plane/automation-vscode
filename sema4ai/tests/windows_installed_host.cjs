// Runs inside real Windows Code. No VS Code, debug adapter, or SDK mocks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const http = require('node:http');
const vscode = require('vscode');
const {scrubDiagnostic, exceptionSummary, fatalDiagnosticLines, isCompletedReadClosure} = require('./windows_diagnostic.cjs');

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
        const folders = vscode.workspace.workspaceFolders || [];
        assert.equal(folders.length, 1, 'Only the synthetic workspace may be opened');
        const canonicalWorkspace = fs.realpathSync(folders[0].uri.fsPath).replace(/\//g, '\\').toLowerCase();
        const expectedWorkspace = fs.realpathSync(path.join(root, 'workspace')).replace(/\//g, '\\').toLowerCase();
        assert.equal(canonicalWorkspace, expectedWorkspace, 'Native workspace must match the exact owned fixture');
        const trustEnabled = vscode.workspace.getConfiguration('security.workspace.trust').get('enabled', true);
        assert.equal(trustEnabled, true, 'Workspace trust enforcement must remain enabled');
        report.workspaceTrust = {enabled: trustEnabled, initiallyTrusted: vscode.workspace.isTrusted,
            folderCount: folders.length, exactSyntheticWorkspace: true,
            canonicalWorkspaceSha256: crypto.createHash('sha256').update(canonicalWorkspace).digest('hex')}; save();
        report.phase = process.env.AUTOMATION_WINDOWS_QA_PHASE;
        assert.ok(['trust', 'acceptance'].includes(report.phase), 'Explicit qualification phase required');
        if (report.phase === 'acceptance') assert.ok(vscode.workspace.isTrusted, 'Fresh acceptance test host must start with exact workspace trusted');
        if (!vscode.workspace.isTrusted) {
            // The external UI driver may trust only this owned synthetic workspace.
            // No private trust-store edits or trust-disable flags are permitted.
            await vscode.commands.executeCommand('workbench.trust.manage');
            await waitFor(() => vscode.workspace.isTrusted, 120000);
        }
        assert.ok(vscode.workspace.isTrusted, 'Synthetic test workspace must be trusted before execution');
        report.workspaceTrust.currentWorkspaceGranted = true; save();
        if (report.phase === 'trust') {report.passed = true; save(); return;}
        const installedIdentity = JSON.parse(fs.readFileSync(path.join(root, 'public/installed-identity.json')));
        assert.equal(installedIdentity.id, 'automation-control-plane.automation-vscode');
        const inventory = () => vscode.extensions.all.filter(item =>
            item.id.startsWith('automation-control-plane.') || item.id.startsWith('ms-python.') || item.id === 'task-local.windows-qualification')
            .map(item => ({id: item.id, version: item.packageJSON.version, directory: path.basename(item.extensionPath)}));
        let extension = vscode.extensions.getExtension(installedIdentity.id);
        report.extensionDiscovery = {initiallyAvailable: !!extension, initialRegistry: inventory(),
            expectedDirectory: installedIdentity.directory, expectedVersion: installedIdentity.version}; save();
        if (!extension) {
            try {
                await waitFor(() => {extension = vscode.extensions.getExtension(installedIdentity.id); return !!extension;}, 60000);
            } catch {
                report.extensionDiscovery.finalRegistry = inventory(); save();
                throw Error('Installed extension absent from native registry after workspace trust grant');
            }
        }
        const expectedInstall = fs.realpathSync(path.join(root, 'extensions', installedIdentity.directory)).toLowerCase();
        const actualInstall = fs.realpathSync(extension.extensionPath).toLowerCase();
        report.extensionDiscovery.actualDirectory = path.basename(actualInstall);
        report.extensionDiscovery.exactCanonicalDirectoryMatch = actualInstall === expectedInstall;
        report.extensionDiscovery.exactManifestMatch = hash(path.join(extension.extensionPath, 'package.json')) === installedIdentity.manifest_sha256;
        save();
        assert.equal(actualInstall, expectedInstall, 'Native registry must load the exact verified VSIX directory');
        assert.ok(report.extensionDiscovery.exactManifestMatch, 'Native registry manifest must match the verified installed artifact');
        assert.equal(extension.packageJSON.version, installedIdentity.version);
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
        const ownedDebugTerminals = new Set();
        for (const kind of ['action', 'robot']) {
            const folder = path.join(root, 'workspace', kind), manifest = path.join(folder, kind === 'action' ? 'package.yaml' : 'robot.yaml');
            const resolved = await vscode.commands.executeCommand('sema4ai.resolveInterpreter', {target_robot: manifest});
            assert.ok(resolved?.success && resolved.result?.pythonExe);
            const info = resolved.result, env = environment(info.environ);
            const home = kind === 'action' ? 'actions' : 'robots';
            assert.ok(info.pythonExe.toLowerCase().startsWith(path.join(root, home).toLowerCase()));
            if (kind === 'action') {
                // Only new disposable fixtures under this driver's exact synthetic workspace.
                const {createActionInputs} = require(path.join(extension.extensionPath, 'vscode-client/out/robo/actionInputs'));
                for (const layout of ['flat', 'src']) {
                    const fixture = fs.mkdtempSync(path.join(root, 'workspace', `pythonpath-${layout}-`));
                    const source = layout === 'src' ? path.join(fixture, 'src') : fixture;
                    const support = path.join(fixture, 'support');
                    fs.mkdirSync(source, {recursive: true}); fs.mkdirSync(support);
                    const fixtureManifest = path.join(fixture, 'package.yaml');
                    fs.writeFileSync(fixtureManifest, fs.readFileSync(manifest, 'utf8') + `\npythonpath:\n  - ${layout === 'src' ? 'src' : '.'}\n  - support\n`);
                    fs.writeFileSync(path.join(support, 'fixture_support.py'), "VALUE = 'discovery only'\n");
                    const actionFile = path.join(source, 'example_actions.py');
                    fs.writeFileSync(actionFile, "from actions import action\nfrom fixture_support import VALUE\n@action\ndef example(name: str = 'world') -> str:\n    \"\"\"Return a fixture greeting.\n\n    Args:\n        name: Who to greet.\n    \"\"\"\n    return VALUE + name\n");
                    const target = path.join(fixture, 'input.json');
                    assert.equal(await createActionInputs(vscode.Uri.file(actionFile), 'example', target, fixture, false), true);
                    const created = JSON.parse(fs.readFileSync(target));
                    assert.equal(created.metadata.actionName, 'example');
                    assert.equal(created.metadata.inputFileVersion, 'v3');
                    assert.equal(created.inputs.length, 1);
                    const metadata = await vscode.commands.executeCommand('sema4ai.getActionsMetadata', vscode.Uri.file(fixture).toString());
                    assert.ok(metadata.actions.some(action => action.name === 'example'));
                    report.checks.push({operation: 'installed Action input creation and metadata', layout, runtimePythonpath: true}); save();
                }
            }
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
                report.currentCase = {kind, mode, operation: debug ? 'debug' : 'run', stage: 'prepared', adapterTypes: [], commands: []}; save();
                const config = {type: 'sema4ai', request: 'launch', name, noDebug: !debug, automationWorkItems: prepared.env};
                if (kind === 'action') {
                    const actions = await vscode.commands.executeCommand('sema4ai.listActions.internal', {action_package: vscode.Uri.file(manifest).toString()});
                    assert.ok(actions?.success); const action = actions.result.find(item => item.name === 'copy_attachment'); assert.ok(action);
                    Object.assign(config, {package: manifest, actionName: action.name, uri: action.uri, jsonInput: prepared.parameters});
                } else Object.assign(config, {robot: manifest, task: 'Copy Work Item Attachment'});
                let exited, terminated = false, dapTerminated = false, stopped = false, nativeError;
                const priorTerminals = new Set(vscode.window.terminals);
                let captureTerminal = true;
                const retainTerminalLines = text => {
                    const lines = fatalDiagnosticLines(text, root);
                    if (lines.length) {report.nativeTerminalFatal = [...(report.nativeTerminalFatal || []), ...lines].slice(-30); save();}
                };
                report.currentCase.nativeTerminalStreamSupported = typeof vscode.window.onDidStartTerminalShellExecution === 'function';
                const shellObserver = report.currentCase.nativeTerminalStreamSupported ? vscode.window.onDidStartTerminalShellExecution(event => {
                    if (priorTerminals.has(event.terminal) && !ownedDebugTerminals.has(event.terminal)) return;
                    ownedDebugTerminals.add(event.terminal);
                    void (async () => {
                        let buffer = '';
                        for await (const chunk of event.execution.read()) {
                            if (!captureTerminal) break;
                            buffer = (buffer + chunk).slice(-16384);
                            const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
                            retainTerminalLines(lines.join('\n'));
                        }
                        if (captureTerminal && buffer) retainTerminalLines(buffer);
                    })().catch(error => {report.nativeTerminalDiagnosticError = exceptionSummary(error, root); save();});
                }) : undefined;
                const terminalObserver = vscode.window.onDidCloseTerminal(closed => {
                    if (!priorTerminals.has(closed) || ownedDebugTerminals.has(closed)) {
                        report.nativeTerminalExit = {code: closed.exitStatus?.code}; save();
                    }
                });
                const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(source), new vscode.Position(stopLine - 1, 0)));
                if (debug) vscode.debug.addBreakpoints([breakpoint]);
                const tracker = vscode.debug.registerDebugAdapterTrackerFactory('*', {createDebugAdapterTracker: session => {
                    if (session.name !== name) return;
                    report.currentCase.adapterTypes.push(session.type); save();
                    const selectedPython = Array.isArray(session.configuration.python) ? session.configuration.python[0] : session.configuration.python;
                    report.currentCase.resolvedLaunch = {console: session.configuration.console,
                        program: typeof session.configuration.program === 'string' ? path.basename(session.configuration.program) : undefined,
                        targetPythonMatchesPackage: typeof selectedPython === 'string' && path.resolve(selectedPython).toLowerCase() === path.resolve(info.pythonExe).toLowerCase(),
                        privateDebugLogDirectoryRetained: session.configuration.env?.DEBUGPY_LOG_DIR === process.env.DEBUGPY_LOG_DIR}; save();
                    return {onWillReceiveMessage(message) {
                        if (message.type === 'request' && /^[A-Za-z]{1,40}$/.test(message.command || '') && report.currentCase.commands.length < 30) {
                            report.currentCase.commands.push(message.command); save();
                        }
                    }, onDidSendMessage(message) {
                        if (message.type === 'response' && message.success === false) {
                            report.nativeProtocolFailure = {adapterType: session.type, command: message.command,
                                message: scrubDiagnostic(message.message || message.body?.error?.format, root)}; save();
                        }
                        if (message.type === 'event' && message.event === 'output' && message.body?.category === 'stderr') {
                            const text = scrubDiagnostic(message.body.output, root);
                            if (text) {report.nativeStderr = [...(report.nativeStderr || []), text].slice(-8); save();}
                        }
                        if (message.type !== 'event') return;
                        if (message.event === 'exited') {
                            exited = message.body?.exitCode; report.currentCase.nativeTargetExitCode = exited; save();
                        }
                        if (message.event === 'terminated') {
                            dapTerminated = true; report.currentCase.nativeDapTerminated = true; save();
                        }
                        if (message.event === 'stopped') {
                            if (!debug || message.body?.reason !== 'breakpoint') {nativeError = 'Unexpected native stop'; return;}
                            stopped = true; vscode.debug.removeBreakpoints([breakpoint]);
                            void session.customRequest('continue', {threadId: message.body.threadId}).catch(() => {nativeError = 'Native continue failed';});
                        }
                    }, onError(error) {
                        const observed = {adapterType: session.type, error: exceptionSummary(error, root),
                            targetExitCodeAlreadyObserved: exited, dapTerminationAlreadyObserved: dapTerminated};
                        if (isCompletedReadClosure(error, exited, dapTerminated)) {
                            report.postCompletionTransportClosures = [...(report.postCompletionTransportClosures || []),
                                {kind, mode, operation: debug ? 'debug' : 'run', ...observed}]; save();
                        } else {
                            report.nativeAdapterFailure = observed; save(); nativeError = 'Native debug adapter error';
                        }
                    }, onExit(code, signal) {
                        report.nativeAdapterExit = {adapterType: session.type, code, signal}; save();
                    }};
                }});
                const ended = vscode.debug.onDidTerminateDebugSession(session => {
                    if (session.name === name) {terminated = true; report.currentCase.nativeSessionTerminated = true; save();}
                });
                try {
                    assert.ok(await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(vscode.Uri.file(manifest)), config));
                    report.currentCase.stage = 'native-debugging-started'; save();
                    await waitFor(() => {if (nativeError) throw Error(nativeError); return exited !== undefined && terminated;}, 180000);
                    assert.equal(exited, 0); assert.equal(stopped, debug);
                } finally {
                    if (nativeError) await sleep(300); // Allow already-emitted terminal diagnostics to drain; never retry.
                    captureTerminal = false; shellObserver?.dispose(); terminalObserver.dispose();
                    tracker.dispose(); ended.dispose(); vscode.debug.removeBreakpoints([breakpoint]);
                }
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
