const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(providers = {}) {
    const messages = [], activations = [], computed = [], homes = [];
    let factory;
    const exported = {};
    const api = {
        window: {showErrorMessage: async message => messages.push(message), showWarningMessage: assert.fail},
        extensions: {getExtension: id => providers[id]},
        debug: {registerDebugAdapterDescriptorFactory: (_, value) => factory = value, registerDebugConfigurationProvider() {}},
        DebugAdapterExecutable: class {constructor(python, args, options) {Object.assign(this, {python, args, options});}},
        commands: {executeCommand: async (command, args) => {
            if (command === 'compute') {
                computed.push(args);
                return {success: true, result: {name: 'Action', request: 'launch', type: 'python',
                    python: '/managed/python', module: 'sema4ai_code.robo.launch_actions',
                    args: ['--action', 'greet', '--json-input', '/private/input with spaces.json'],
                    cwd: '/fixture/src package', env: {...args.env, PYTHONPATH: '/fixture/src:/fixture/support'},
                    console: 'integratedTerminal'}};
            }
            return {success: true};
        }},
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../vscode-client/out/debugger.js'), 'utf8'), {
        exports: exported, process, __dirname, require: name => {
            if (name === 'vscode') return api;
            if (name === 'path') return path;
            if (name === 'fs') return {existsSync: () => true};
            if (name === './activities') return {
                resolveInterpreter: async () => ({success: true, result: {pythonExe: '/managed/python',
                    environ: {RETAIN: 'yes'}, additionalPythonpathEntries: ['/fixture/src', '/fixture/support']}}),
                updateLaunchEnvironmentCommonTasksAndActions: async env => env,
                updateWorkItemEnvironment: async env => env,
            };
            if (name === './robocorpCommands') return {SEMA4AI_COMPUTE_ROBOT_LAUNCH_FROM_ROBOCORP_CODE_LAUNCH: 'compute'};
            if (name === './robocorpSettings') return {getAutosetpythonextensiondisableactivateterminal: () => false, getHome: () => ''};
            if (name === './channel') return {OUTPUT_CHANNEL: {appendLine() {}}};
            if (name === './extensionStorage') return {getExtensionStorage: () => '/owned/extension-storage'};
            if (name === './runtimePaths') return {runtimeEnvironment: kind => {
                homes.push(kind);
                return {ROBOCORP_HOME: `/homes/${kind}`, ACTIONS_HOME: '/homes/actions', ROBOTS_HOME: '/homes/robots'};
            }};
            if (name === './rcc') return {getRccLocation: async () => '/owned/rcc'};
            if (name === './extension') return {globalCachedPythonInfo: {pythonExe: '/ls/python'}};
            if (name === './pythonExtIntegration') return {isPyDevDebuggerPythonExtensionInstalled: async () => !!providers['fabioz.vscode-pydev-python-debugger']};
            return {};
        },
    });
    const provider = (id, types, active = false) => providers[id] = {id, isActive: active,
        packageJSON: {contributes: {debuggers: types.map(type => ({type}))}},
        activate: async () => {activations.push(id); providers[id].isActive = true;}};
    return {exported, messages, activations, computed, provider, homes, factory: () => factory};
}

test('Action noDebug retains its resolved managed Python launch without any optional provider', async () => {
    const f = fixture();
    const result = await new f.exported.RobocorpCodeDebugConfigurationProvider().resolveDebugConfigurationWithSubstitutedVariables(
        undefined, {type: 'sema4ai', name: 'Action', request: 'launch', package: '/fixture/package.yaml', noDebug: true,
            actionName: 'greet', jsonInput: '/private/input with spaces.json'});
    assert.equal(f.messages.length, 0);
    assert.equal(result.type, 'sema4ai');
    assert.equal(result.noDebug, true);
    assert.equal(result.automationResolvedPython, true);
    assert.equal(result.python, '/managed/python');
    assert.equal(result.module, 'sema4ai_code.robo.launch_actions');
    assert.equal(result.env.PYTHONPATH, '/fixture/src:/fixture/support');
    assert.equal(result.env.RETAIN, 'yes');
    assert.equal(result.args.at(-1), '/private/input with spaces.json');
    assert.equal(result.terminal, 'integrated');
    assert.equal(result.automationRuntimeKind, 'actions');
    assert.equal(f.activations.length, 0);
    // Re-resolution of the owned configuration must not require robot.yaml.
    assert.equal(await new f.exported.RobocorpCodeDebugConfigurationProvider().resolveDebugConfigurationWithSubstitutedVariables(undefined, result), result);
});

test('owned Action adapter uses Actions homes and does not resolve a Robots environment', async () => {
    const f = fixture();
    f.exported.registerDebugger();
    const config = {automationRuntimeKind: 'actions', env: {PYTHONPATH: '/package/src'}};
    const adapter = await f.factory().createDebugAdapterDescriptor({configuration: config});
    assert.deepEqual(f.homes, ['actions']);
    assert.equal(adapter.options.env.ROBOCORP_HOME, '/homes/actions');
    assert.equal(adapter.options.env.PYTHONPATH, '/package/src');
});

test('cancellation declines before interpreter work', async () => {
    const f = fixture();
    assert.equal(await new f.exported.RobocorpCodeDebugConfigurationProvider().resolveDebugConfigurationWithSubstitutedVariables(
        undefined, {type: 'sema4ai', package: '/fixture/package.yaml', noDebug: true}, {isCancellationRequested: true}), undefined);
    assert.equal(f.computed.length, 0);
    assert.equal(f.messages.length, 0);
});

test('Robot noDebug retains the existing RCC-owned launch', async () => {
    const f = fixture();
    const result = await new f.exported.RobocorpCodeDebugConfigurationProvider().resolveDebugConfigurationWithSubstitutedVariables(
        undefined, {type: 'sema4ai', name: 'Robot', request: 'launch', robot: '/fixture/robot.yaml', noDebug: true});
    assert.equal(result.type, 'sema4ai');
    assert.equal(result.robot, '/fixture/robot.yaml');
    assert.equal(result.automationResolvedPython, undefined);
    assert.equal(f.messages.length, 0);
});

test('Debug refuses absent adapters and analysis-only Python extensions', async () => {
    for (const analysisOnly of [false, true]) {
        const f = fixture();
        if (analysisOnly) f.provider('ms-python.python', []);
        assert.equal(await f.exported.updateDebugConfigurationAndAutoActivatePythonExtension({type: 'python', python: '/managed/python'}), undefined);
        assert.match(f.messages[0], /ms-python.debugpy/);
        assert.equal(f.activations.length, 0);
    }
});

test('genuine Action Debug still declines when no optional debugger is registered', async () => {
    const f = fixture();
    assert.equal(await new f.exported.RobocorpCodeDebugConfigurationProvider().resolveDebugConfigurationWithSubstitutedVariables(
        undefined, {type: 'sema4ai', name: 'Action', request: 'launch', package: '/fixture/package.yaml', noDebug: false}), undefined);
    assert.match(f.messages[0], /Python Debug requires.*ms-python.debugpy/);
    assert.equal(f.activations.length, 0);
});

test('cancellation after launch resolution does not activate or return a launch', async () => {
    const f = fixture();
    let checks = 0;
    assert.equal(await new f.exported.RobocorpCodeDebugConfigurationProvider().resolveDebugConfigurationWithSubstitutedVariables(
        undefined, {type: 'sema4ai', name: 'Action', request: 'launch', package: '/fixture/package.yaml', noDebug: true},
        {get isCancellationRequested() {return ++checks > 1;}}), undefined);
    assert.equal(f.computed.length, 1);
    assert.equal(f.activations.length, 0);
    assert.equal(f.messages.length, 0);
});

test('Debug activates a supported contribution and uses the actual registered adapter type', async () => {
    for (const [id, type] of [['ms-python.debugpy', 'debugpy'], ['ms-python.python', 'python'], ['fabioz.vscode-pydev-python-debugger', 'pydevd']]) {
        for (const active of [false, true]) {
            const f = fixture();
            f.provider(id, [type], active);
            const result = await f.exported.updateDebugConfigurationAndAutoActivatePythonExtension({type: 'python', python: '/managed/python'});
            assert.equal(result.type, type);
            assert.equal(f.activations.length, active ? 0 : 1);
            if (type === 'pydevd') assert.equal(result.pythonExecutable, '/managed/python');
            assert.equal(f.messages.length, 0);
        }
    }
});

test('A provider activation failure declines launch with an actionable error', async () => {
    const f = fixture();
    f.provider('ms-python.debugpy', ['debugpy']).activate = async () => {throw Error('fixture activation failure');};
    assert.equal(await f.exported.updateDebugConfigurationAndAutoActivatePythonExtension({type: 'python', python: '/managed/python'}), undefined);
    assert.match(f.messages[0], /activate.*ms-python.debugpy/i);
});
