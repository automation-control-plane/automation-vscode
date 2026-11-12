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

module.exports = {scrubDiagnostic, exceptionSummary};
