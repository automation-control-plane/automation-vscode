// Keep diagnostic exceptions useful without emitting environment/config dumps.
function scrubDiagnostic(value, root) {
    let text = String(value || '').slice(0, 16384).replace(/\u001b\[[0-9;]*m/g, '');
    for (const spelling of [root, root.replace(/\\/g, '/'), root.replace(/\\/g, '\\\\')]) {
        if (spelling) text = text.split(spelling).join('<qa-root>');
    }
    return text.split(/\r?\n/).filter(line =>
        !/bearer|token|secret|password|authorization|credential|api[_ -]?key|\benv(?:ironment)?\s*[:=]/i.test(line) &&
        !/^\s*[\[{"']/.test(line))
        .map(line => line.replace(/[A-Za-z0-9_+\/=\-]{20,}/g, '<redacted>'))
        .join('\n').slice(0, 2000);
}

function exceptionSummary(error, root) {
    const name = typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(error.name) ? error.name : 'Error';
    const code = typeof error?.code === 'string' && /^E[A-Z0-9_]{1,39}$/.test(error.code) ? error.code : undefined;
    return {name, code, message: scrubDiagnostic(error?.message || error, root)};
}

function isCompletedReadClosure(error, exitCode, dapTerminated) {
    return error?.message === 'read error' && exitCode === 0 && dapTerminated === true;
}

function collectAdapterFailures(root) {
    const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
    const directory = path.join(root, 'debugpy-private');
    const names = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => /^debugpy\.[\w.-]+\.log$/.test(name)).slice(0, 20) : [];
    const inputs = names.map(name => ({name, file: path.join(directory, name), source: 'debugpy'}));
    const codeLogs = path.join(root, 'profile/logs');
    if (fs.existsSync(codeLogs)) {
        for (const entry of fs.readdirSync(codeLogs, {withFileTypes: true}).filter(entry => entry.isDirectory()).slice(0, 10)) {
            const session = path.join(codeLogs, entry.name);
            const candidates = ['ptyhost.log', 'main.log', 'sharedprocess.log'];
            for (const window of fs.readdirSync(session, {withFileTypes: true}).filter(item => item.isDirectory() && /^window\d+$/.test(item.name)).slice(0, 4)) {
                candidates.push(`${window.name}/renderer.log`, `${window.name}/exthost/exthost.log`);
            }
            for (const name of candidates) {
                const file = path.join(session, name);
                if (fs.existsSync(file) && fs.lstatSync(file).isFile()) inputs.push({name, file, source: name === 'ptyhost.log' ? 'code-pty' : 'code-discovery'});
            }
        }
    }
    const files = inputs.map(({name, file, source}) => {
        const descriptor = fs.openSync(file, 'r');
        let data;
        try {
            const size = fs.fstatSync(descriptor).size, length = Math.min(size, 512 * 1024);
            data = Buffer.alloc(length); fs.readSync(descriptor, data, 0, length, size - length);
        } finally {fs.closeSync(descriptor);}
        const lines = data.toString('utf8').split(/\r?\n/), decoded = [], protocol = [];
        for (const line of lines) {
            const scalar = line.match(/^\s*"(output|message|format|exitCode|success|command|event)"\s*:\s*(.*?),?\s*$/);
            if (!scalar) continue;
            try {
                const value = JSON.parse(scalar[2].replace(/,$/, ''));
                if (['output', 'message', 'format'].includes(scalar[1]) && typeof value === 'string') decoded.push(...value.split(/\r?\n/));
                else if ((scalar[1] === 'exitCode' && Number.isSafeInteger(value)) ||
                    (scalar[1] === 'success' && typeof value === 'boolean') ||
                    (['command', 'event'].includes(scalar[1]) && typeof value === 'string' && /^[A-Za-z]{1,40}$/.test(value))) protocol.push({field: scalar[1], value});
            } catch { /* Only complete, allowlisted scalar fields are admitted. */ }
        }
        const fatalLines = fatalDiagnosticLines([...lines, ...decoded].join('\n'), root).slice(-30);
        return {file: name, source, inspectedTailSha256: crypto.createHash('sha256').update(data).digest('hex'), fatalLines, protocol: protocol.slice(-60)};
    });
    return {scope: 'Scrubbed fatal lines only; raw debugpy logs remain private', privateLogFilesFound: names.length, files};
}

function fatalDiagnosticLines(text, root) {
    return String(text).split(/\r?\n/).filter(line =>
        /[A-Za-z_.]+(?:Error|Exception)|Fatal Python error|Traceback|uncaught|Unhandled|failed|cannot|not found|Errno|WinError|^E\+\d|extension.*(?:incompat|invalid|disabled|ignor|skip|scan)/i.test(line))
        .map(line => scrubDiagnostic(line, root)).filter(Boolean);
}

module.exports = {scrubDiagnostic, exceptionSummary, collectAdapterFailures, fatalDiagnosticLines, isCompletedReadClosure};

if (require.main === module) {
    const fs = require('node:fs'), path = require('node:path');
    if (process.argv[2] !== '--collect' || !process.argv[3]) throw Error('Expected task-owned diagnostic directory');
    const root = path.resolve(process.argv[3]);
    fs.writeFileSync(path.join(root, 'public/adapter-log-diagnostics.json'), JSON.stringify(collectAdapterFailures(root), null, 2));
}
