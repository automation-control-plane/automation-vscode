// Real pinned RCC operations in fresh synthetic homes; never loads operator settings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {LocalRccProfiles} = require('../vscode-client/out/rccProfiles');
const pins = require('../published-tools.json');

async function main() {
    const [executable, destination] = process.argv.slice(2);
    assert.ok(executable && destination, 'Expected exact RCC executable and a new owned output directory');
    const platform = process.platform === 'win32' ? 'win32-x64' : 'linux-x64';
    const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(digest(executable), pins.rcc.assets[platform].sha256, 'Exact published RCC required');
    fs.mkdirSync(destination, {recursive:false, mode:0o700});
    const homes = {actions:path.join(destination,'actions'), robots:path.join(destination,'robots')};
    const env = {};
    for (const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','LANG']) {
        if (process.env[key]) env[key] = process.env[key];
    }
    env.HOME=path.join(destination,'home');
    const client = new LocalRccProfiles({executable,homes,env});
    const profile = (name, noRevoke) => ({name,description:'Synthetic setup acceptance',settings:{
        meta:{name,description:'Synthetic setup acceptance',source:'isolated acceptance',version:'1'},
        certificates:{'verify-ssl':true,'ssl-no-revoke':noRevoke,'legacy-renegotiation-allowed':false},
        options:{'no-build':false}}});
    const report = {passed:false,platform,executableSha256:digest(executable),checks:[]};
    try {
        for (const target of ['actions','robots']) {
            const filename=path.join(destination,`${target}.json`);
            fs.writeFileSync(filename,JSON.stringify(profile(`${target}-approved`,target==='robots')));
            const before=await client.status(target);
            await client.importProfile(target,filename);
            assert.equal((await client.status(target)).profile,before.profile,'Import must not switch');
            await client.switchProfile(target,`${target}-approved`);
        }
        const actionsBefore=await client.status('actions');
        const robotsBefore=await client.status('robots');
        assert.equal(actionsBefore.profile,'actions-approved');
        assert.equal(robotsBefore.profile,'robots-approved');
        assert.equal(actionsBefore.certificates.verifySsl,true);
        assert.equal(robotsBefore.certificates.verifySsl,true);
        assert.equal(actionsBefore.certificates.sslNoRevoke,false);
        assert.equal(robotsBefore.certificates.sslNoRevoke,true);
        const files = [];
        function snapshot(directory) {
            if (!fs.existsSync(directory)) return;
            for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
                const file=path.join(directory,entry.name);
                if (entry.isDirectory()) snapshot(file);
                else if (/rcc\.yaml$|profiles/.test(file)) files.push([file,digest(file)]);
            }
        }
        snapshot(homes.actions);
        const imported=path.join(destination,'second.json');
        fs.writeFileSync(imported,JSON.stringify(profile('second-approved',true)));
        await client.importProfile('robots',imported);
        assert.equal((await client.status('robots')).profile,'robots-approved');
        await client.switchProfile('robots','second-approved');
        assert.deepEqual(await client.status('actions'),actionsBefore);
        for (const [file,hash] of files) assert.equal(digest(file),hash,'Actions profile/config bytes preserved');
        await assert.rejects(client.switchProfile('robots','missing-approved-profile'));
        const malformed=path.join(destination,'malformed.yaml');
        fs.writeFileSync(malformed,'[unterminated');
        await assert.rejects(client.importProfile('robots',malformed));
        assert.equal((await client.status('robots')).profile,'second-approved');
        report.checks=['distinct-homes-and-active-profiles','import-does-not-switch','explicit-selected-home-switch',
            'unrelated-home-profile-bytes-preserved','TLS-verification-preserved','unknown-profile-and-malformed-file-fail'];
        report.passed=true;
    } finally {
        fs.writeFileSync(path.join(destination,'receipt.json'),JSON.stringify(report,null,2)+'\n');
    }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
