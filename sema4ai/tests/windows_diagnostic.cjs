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

function collectAdapterFailures(root) {
    const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
    const directory = path.join(root, 'debugpy-private');
    const names = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => /^debugpy\.[\w.-]+\.log$/.test(name)).slice(0, 20) : [];
    const files = names.map(name => {
        const file = path.join(directory, name), descriptor = fs.openSync(file, 'r');
        let data;
        try {
            const size = fs.fstatSync(descriptor).size, length = Math.min(size, 512 * 1024);
            data = Buffer.alloc(length); fs.readSync(descriptor, data, 0, length, size - length);
        } finally {fs.closeSync(descriptor);}
        const lines = data.toString('utf8').split(/\r?\n/).filter(line =>
            /[A-Za-z_.]+(?:Error|Exception)|Fatal Python error|Traceback|uncaught|Unhandled|failed|cannot|not found|Errno|WinError|^E\+\d/i.test(line));
        const fatalLines = lines.map(line => scrubDiagnostic(line, root)).filter(Boolean).slice(-30);
        return {file: name, inspectedTailSha256: crypto.createHash('sha256').update(data).digest('hex'), fatalLines};
    });
    return {scope: 'Scrubbed fatal lines only; raw debugpy logs remain private', privateLogFilesFound: names.length, files};
}

module.exports = {scrubDiagnostic, exceptionSummary, collectAdapterFailures};

if (require.main === module) {
    const fs = require('node:fs'), path = require('node:path');
    if (process.argv[2] !== '--collect' || !process.argv[3]) throw Error('Expected task-owned diagnostic directory');
    const root = path.resolve(process.argv[3]);
    fs.writeFileSync(path.join(root, 'public/adapter-log-diagnostics.json'), JSON.stringify(collectAdapterFailures(root), null, 2));
}
