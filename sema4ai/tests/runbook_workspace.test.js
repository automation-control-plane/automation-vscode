const {test} = require('node:test');
const assert = require('node:assert/strict');
const model = require('../vscode-client/out/runbookModel');
test('Runbook navigation contains every approved surface without a vendor destination', () => {
  assert.deepEqual(model.RUNBOOK_ROUTES.map(route => route.label), ['Packages', 'Environments', 'Work Items', 'Runs', 'Inspectors', 'Settings']);
});
test('Untrusted webview messages cannot execute arbitrary commands or pass prototype payloads', () => {
  for (const message of [null, [], {op:'execute', command:'workbench.action.terminal.new'}, {op:'action', action:'eval'}, {op:'navigate', route:'control-room'}, {op:'action', action:'run', target:5}]) assert.equal(model.parseRunbookRequest(message), undefined);
  assert.deepEqual(model.parseRunbookRequest({op:'navigate', route:'environments'}), {op:'navigate', route:'environments'});
  assert.deepEqual(model.parseRunbookRequest({op:'action', action:'run', target:'package.yaml::consume', ignored:'no'}), {op:'action', action:'run', target:'package.yaml::consume'});
});
test('Package identity disambiguates duplicate labels and preserves Action and Robot kinds', () => {
  const packages = [{name:'Same', directory:'/one/action', filePath:'/one/action/package.yaml',packageType:'action',yamlContents:{dependencies:{pypi:['actions-work-items=0.4.4']}}}, {name:'Same',directory:'/two/robot',filePath:'/two/robot/robot.yaml',packageType:'task',yamlContents:{}}];
  assert.equal(model.describePackage(packages[0]).kind, 'Action');
  assert.equal(model.describePackage(packages[1]).kind, 'Robot');
  assert.notEqual(model.describePackage(packages[0]).id, model.describePackage(packages[1]).id);
  assert.deepEqual(model.describePackage(packages[0]).dependencies, [{source:'pypi', value:'actions-work-items=0.4.4'}]);
});
test('Raw configuration summaries do not invent readiness, task results or dependency versions', () => {
  const result = model.describePackage({name:'',directory:'/robot',filePath:'/robot/robot.yaml',packageType:'task',yamlContents:{tasks:{Consume:{}}}});
  assert.equal(result.name,'robot'); assert.deepEqual(result.dependencies, []); assert.equal(result.runtimeStatus, 'Not checked');
});
