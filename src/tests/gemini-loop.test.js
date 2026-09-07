const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const requests = [];
const executions = [];
let respond;
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'axios') return { post: async (url, body) => {
    requests.push(structuredClone(body));
    return { data: { candidates: [{ content: { role: 'model', parts: respond(body) } }] } };
  } };
  if (id === './tools') return {
    getGeminiFunctionDeclarations: () => [],
    executeToolFunction: async (name, args) => { executions.push({ name, args }); return 'result'; },
  };
  if (id === 'electron') return {};
  return originalRequire.apply(this, arguments);
};
const { askWithFailover } = require('../core/providers');
Module.prototype.require = originalRequire;

const state = { defaultProvider: 'gemini', providers: { gemini: { enabled: true, apiKey: 'test' } } };
const call = (id) => ({ functionCall: { name: 'test_tool', args: { id }, id }, thoughtSignature: 'signature' });
const run = (maxToolSteps) => askWithFailover(state, { userPrompt: 'Do work', agentContext: { maxToolSteps } });
function reset(handler) { requests.length = 0; executions.length = 0; respond = handler; }

test('Gemini loop', async (t) => {
  await t.test('answers after all ten default tool rounds', async () => {
    reset(() => requests.length <= 10 ? [call(String(requests.length))] : [{ text: 'Collected results.' }]);
    const result = await run(undefined);
    assert.equal(executions.length, 10);
    assert.equal(requests.length, 11);
    assert.equal(requests[10].toolConfig.functionCallingConfig.mode, 'NONE');
    assert.equal(requests[10].contents.at(-1).parts[0].functionResponse.id, '10');
    assert.match(result.reply, /Collected results/);
    assert.match(result.reply, /limit \(10 rounds\)/);
    assert.ok(result.toolTrace.some(event => event.stage === 'tool_limit_reached'));
  });
  await t.test('responds to every call and preserves model parts and IDs', async () => {
    const parts = [{ text: 'Checking' }, call('a'), call('b')];
    reset(() => requests.length === 1 ? parts : [{ text: 'Done' }]);
    const result = await run(3);
    assert.equal(result.reply, 'Done');
    assert.equal(executions.length, 2);
    assert.deepEqual(requests[1].contents.at(-2).parts, parts);
    assert.deepEqual(requests[1].contents.at(-1).parts.map(p => p.functionResponse.id), ['a', 'b']);
    assert.equal(requests[1].toolConfig, undefined);
  });
  await t.test('never executes calls returned on the final turn', async () => {
    reset(() => [call('repeat')]);
    const result = await run(1);
    assert.equal(executions.length, 1);
    assert.equal(requests.length, 2);
    assert.match(result.reply, /Some work may remain/);
  });
  await t.test('handles an empty final response without losing limit notice', async () => {
    reset(() => requests.length === 1 ? [call('a')] : []);
    assert.match((await run(1)).reply, /Tool execution limit/);
  });
  await t.test('returns ordinary replies without an extra request', async () => {
    reset(() => [{ text: 'Hello' }]);
    assert.equal((await run(2)).reply, 'Hello');
    assert.equal(requests.length, 1);
    assert.equal(executions.length, 0);
  });
});
