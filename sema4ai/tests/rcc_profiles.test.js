const {test} = require('node:test');
const assert = require('node:assert/strict');
const {LocalRccProfiles, parseLongPathStatus} = require('../vscode-client/out/rccProfiles');

function fixture() {
    const calls = [];
    const profiles = {actions: {current:'actions-approved', profiles:{'actions-approved':'Actions'}},
        robots:{current:'robots-approved',profiles:{'robots-approved':'Robots', imported:'Imported'}}};
    const client = new LocalRccProfiles({executable:'/tools/rcc', homes:{actions:'/isolated/actions',robots:'/isolated/robots'},
        env:{PATH:'/tools', ACTIONS_HOME:'/isolated/actions', ROBOTS_HOME:'/isolated/robots'}, run:async (exe,args,options) => {
            const target = options.env.ROBOCORP_HOME.endsWith('/robots') ? 'robots' : 'actions';
            calls.push({exe,args,options,target});
            if (args[0] === 'version') return 'rcc v18.19.8';
            if (args[1] === 'settings') return JSON.stringify({certificates:{'verify-ssl':true,'ssl-no-revoke':target==='robots',
                'legacy-renegotiation-allowed':false, contents:'PRIVATE CERTIFICATE'}, network:{'https-proxy':'https://user:password@private/'}});
            if (args[1] === 'diagnostics') return JSON.stringify({checks:[{status:'fail', category:4020,type:'network',
                message:'https://user:password@private/', url:'https://user:password@private/'}]});
            if (args[1] === 'switch' && args.includes('-p')) {profiles[target].current=args[args.indexOf('-p')+1]; return '';}
            return JSON.stringify(profiles[target]);
        }});
    return {client,calls,profiles};
}

test('target-specific status preserves home overrides and exports only allowed settings', async () => {
    const {client,calls} = fixture();
    for (const target of ['actions','robots']) {
        const status = await client.status(target);
        assert.equal(status.target,target);
        assert.equal(status.home,`/isolated/${target}`);
        assert.equal(status.profile,`${target}-approved`);
        assert.equal(status.certificates.verifySsl,true);
        assert.equal(status.certificates.sslNoRevoke,target==='robots');
        assert.equal(status.certificates.legacyRenegotiationAllowed,false);
        assert.ok(calls.filter(call=>call.target===target).every(call=>call.options.env.ROBOCORP_HOME===`/isolated/${target}`));
        assert.doesNotMatch(JSON.stringify(status),/password|PRIVATE CERTIFICATE|https-proxy/);
    }
});

test('import never switches; explicit switch mutates only the selected home', async () => {
    const {client,calls,profiles} = fixture();
    await client.importProfile('robots','/approved/company.yaml');
    assert.ok(calls.every(call=>!call.args.includes('--switch') && !call.args.includes('-s')));
    assert.equal(profiles.robots.current,'robots-approved');
    await client.switchProfile('robots','imported');
    assert.equal(profiles.robots.current,'imported');
    assert.equal(profiles.actions.current,'actions-approved');
    assert.ok(calls.every(call=>call.target==='robots'));
    await assert.rejects(client.switchProfile('robots','unknown'),/not available/);
    await assert.rejects(client.importProfile(undefined,'/approved/company.yaml'),/explicit Actions or Robots/);
});

test('full diagnostics are target-specific and do not export messages or secrets', async () => {
    const {client,calls} = fixture();
    const report = await client.diagnostics('robots');
    assert.deepEqual(report.checks,[{category:4020,status:'fail',type:'network'}]);
    assert.ok(calls.some(call=>call.args.includes('--bundled') && call.args.includes('--robocorp')));
    assert.ok(calls.every(call=>!call.args.includes('--quick')));
    assert.doesNotMatch(JSON.stringify(report),/password|private/);
});

test('cross-home configuration mutations and RCC errors are actionable and sanitized', async () => {
    const client = new LocalRccProfiles({executable:'/rcc', homes:{actions:'/actions',robots:'/robots'},
        configLocation:'/shared/rcc.yaml',env:{},run:async()=>{throw Error('PRIVATE proxy password');}});
    await assert.rejects(client.importProfile('robots','/profile.yaml'),/outside the selected/);
    await assert.rejects(client.status('robots'),error=>/Robots|robots/.test(error.message) && !/PRIVATE|password/.test(error.message));
});

test('long paths distinguish enabled, disabled, skipped and unavailable without changing policy', () => {
    assert.equal(parseLongPathStatus('    LongPathsEnabled    REG_DWORD    0x1',false).support,'enabled');
    assert.equal(parseLongPathStatus('    LongPathsEnabled    REG_DWORD    0x0',false).support,'disabled');
    assert.equal(parseLongPathStatus('',true).check,'explicitly-skipped');
    assert.equal(parseLongPathStatus('',false).support,'unavailable');
});
