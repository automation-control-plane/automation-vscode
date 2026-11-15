const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const contents = Buffer.from('verified RCC fixture');
const digest = crypto.createHash('sha256').update(contents).digest('hex');
let location;
let download;
let execFile;
let xhr;
const loggedErrors = [];
const output = [];
const progressMessages = [];
const isOutputModule = (parent, name) => parent?.filename.replace(/\\/g, '/').endsWith(`/vscode-client/out/${name}.js`);

const vscode = {
    ProgressLocation: {Notification: 15},
    commands: {executeCommand: async () => ({})},
    extensions: {},
    window: {
        withProgress: async (_options, task) => task({report: item => progressMessages.push(item.message)}, {isCancellationRequested: false}),
    },
    workspace: {getConfiguration: () => ({get: () => undefined})},
};

const mocks = {
    './runtimePaths': {runtimeHomes: () => ({actions: '/tmp/actions'}), runtimeEnvironment: () => ({})},
    './extensionStorage': {runtimeMetadataDirectory: () => '/tmp/actions/metadata'},
    './legacyIntegrations': {legacyVendorIntegrationsEnabled: () => false},
    './publishedTools': {
        publishedTool: () => ({url: 'https://example.invalid/rcc', name: 'rcc', sha256: digest}),
        extensionIdentity: () => ({version: 'test'}),
    },
    './requestLight': {configure() {}},
    './files': {
        fileExists: async filename => fs.existsSync(filename),
        getExtensionRelativeFile: () => location,
    },
    vscode,
    './channel': {
        logError: (...args) => loggedErrors.push(args),
        OUTPUT_CHANNEL: {appendLine: line => output.push(line)},
    },
    './time': {Timing: class {getTotalElapsedAsStr() {return '0s';} elapsedFromLastMeasurement() {return false;}}, sleep: async () => {}},
    './subprocess': {execFilePromise: (...args) => execFile(...args), mergeEnviron: value => value},
    './robocorpSettings': {
        getRccLocation: () => undefined,
        getHome: () => '',
        getProceedwithlongpathsdisabled: () => false,
    },
    './extensionCreateEnv': {runAsAdminWin32: async () => undefined},
    './extension': {GLOBAL_STATE: {}, langServer: {}},
    './http': {downloadWithProgress: (...args) => download(...args)},
    './robocorpCommands': {},
};

const httpMocks = {
    './time': mocks['./time'],
    './channel': mocks['./channel'],
    './requestLight': {xhr: (...args) => xhr(...args)},
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (isOutputModule(parent, 'rcc') && Object.hasOwn(mocks, request)) {
        return mocks[request];
    }
    if (isOutputModule(parent, 'http') && Object.hasOwn(httpMocks, request)) {
        return httpMocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
};
const {getRccLocation, runConfigDiagnostics} = require('../vscode-client/out/rcc');
Module._load = originalLoad;

test('failed or cancelled RCC downloads report failure and a later setup can retry', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-rcc-setup-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    location = path.join(directory, 'rcc');
    delete process.env.AUTOMATION_RCC_LOCATION;
    download = async () => undefined;

    await assert.rejects(getRccLocation(), /RCC download did not produce a verified executable/);
    assert.equal(fs.existsSync(location), false);

    download = async (_url, _progress, _token, target) => {
        fs.writeFileSync(target, contents, {mode: 0o744, flag: 'wx'});
        return target;
    };
    assert.equal(await getRccLocation(), location);
});

test('aborted and incomplete transfers leave no cached executable and can retry', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-rcc-transfer-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    location = path.join(directory, 'rcc');
    delete process.env.AUTOMATION_RCC_LOCATION;
    let attempts = 0;
    progressMessages.length = 0;
    xhr = async () => {
        attempts += 1;
        assert.equal(progressMessages.at(-1), `Connecting to download source (attempt ${attempts} of 3)...`);
        throw Error('request cancelled');
    };
    const previousLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (isOutputModule(parent, 'http') && Object.hasOwn(httpMocks, request)) {
            return httpMocks[request];
        }
        return previousLoad.call(this, request, parent, isMain);
    };
    try {
        download = require('../vscode-client/out/http').downloadWithProgress;
    } finally {
        Module._load = previousLoad;
    }

    await assert.rejects(getRccLocation(), /RCC download did not produce a verified executable/);
    assert.equal(attempts, 3);
    assert.equal(fs.existsSync(location), false);

    xhr = async () => {
        attempts += 1;
        return {status: 200, responseData: [Buffer.from('partial')], responseText: ''};
    };
    attempts = 0;
    await assert.rejects(getRccLocation(), /RCC download did not produce a verified executable/);
    assert.equal(attempts, 3);
    assert.equal(fs.existsSync(location), false);
});

test('an incomplete pre-existing RCC artifact is preserved and never accepted', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-rcc-incomplete-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    location = path.join(directory, 'rcc');
    fs.writeFileSync(location, 'partial download');
    delete process.env.AUTOMATION_RCC_LOCATION;
    download = assert.fail;

    await assert.rejects(getRccLocation(), /does not match the pinned release and was preserved/);
    assert.equal(fs.readFileSync(location, 'utf8'), 'partial download');
});

test('concurrent setup callers accept only the verified winner artifact', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-rcc-concurrent-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    location = path.join(directory, 'rcc');
    delete process.env.AUTOMATION_RCC_LOCATION;
    xhr = async () => ({status: 200, responseData: [contents], responseText: ''});
    const previousLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (isOutputModule(parent, 'http') && Object.hasOwn(httpMocks, request)) {
            return httpMocks[request];
        }
        return previousLoad.call(this, request, parent, isMain);
    };
    try {
        download = require('../vscode-client/out/http').downloadWithProgress;
    } finally {
        Module._load = previousLoad;
    }

    assert.deepEqual(await Promise.all([getRccLocation(), getRccLocation()]), [location, location]);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(location)).digest('hex'), digest);
});

test('RCC setup diagnostics retain a rejected command as a handled failure', async () => {
    execFile = async () => {throw Error('setup cancelled while RCC was starting');};
    loggedErrors.length = 0;
    output.length = 0;

    assert.equal(await runConfigDiagnostics('/tools/rcc', '/actions'), undefined);
    assert.equal(loggedErrors.length, 1);
    assert.match(output.join('\n'), /Stdout:\n\nStderr:\n/);
});
