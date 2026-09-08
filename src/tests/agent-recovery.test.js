const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { toolOutcome, formatProviderError } = require('../core/agent-recovery');

function fixture(provider, respond, execute) {
  const requests = [], executions = [];
  const filename = path.resolve(__dirname, '../core/providers.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const result = { requests, executions };
  const tools = {
    getOpenAIToolDefinitions: () => [], getGeminiFunctionDeclarations: () => [],
    runAgentTooling: async () => ({ handled: false }),
    executeToolFunction: async (name, args) => {
      executions.push({ name, args });
      return execute ? execute(result) : '{"success":true,"stdout":"verified output"}';
    },
  };
  const overrides = {
    './tools': tools, electron: {}, dotenv: { config() {} },
    axios: { post: async (url, body, options) => {
      const actual = url.includes('generativelanguage') ? 'gemini' : url.includes('openai.com') ? 'openai' : 'ollama';
      requests.push({ provider: actual, body: structuredClone(body), options });
      return respond(result, actual);
    } },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, require: name => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name),
    process, console, AbortController,
  }, { filename });
  Object.assign(result, module.exports);
  result.run = (maxToolSteps = 1, extraProviders = {}) => result.askWithFailover({
    defaultProvider: provider, providers: { [provider]: { enabled: true, apiKey: 'test' }, ...extraProviders },
  }, { sessionId: 'test-run', userPrompt: 'How do I do this work?', agentContext: { maxToolSteps } });
  return result;
}
function response(provider, tool = false, text = 'Summary of collected evidence.') {
  const call = { id: 'call', type: 'function', function: { name: 'test_tool', arguments: provider === 'openai' ? '{}' : {} } };
  if (provider === 'gemini') return { data: { candidates: [{ content: { role: 'model', parts: tool ? [{ functionCall: { name: 'test_tool', args: {} } }] : [{ text }] } }] } };
  const message = { content: text, ...(tool ? { tool_calls: [call] } : {}) };
  return provider === 'openai' ? { data: { choices: [{ message }] } } : { data: { message } };
}
for (const provider of ['openai', 'ollama', 'gemini']) {
  for (const rounds of [1, 10, 50]) {
    test(`${provider} preserves ${rounds} tool rounds then requests a summary with tools disabled`, async () => {
      const f = fixture(provider, state => response(provider, state.requests.length <= rounds));
      const result = await f.run(rounds);
      assert.equal(f.executions.length, rounds);
      assert.equal(f.requests.length, rounds + 1);
      assert.equal(result.outcome, 'incomplete');
      assert.match(result.reply, /Summary of collected evidence/);
      assert.match(result.reply, new RegExp(`limit \\(${rounds} rounds\\)`));
      const last = f.requests.at(-1);
      if (provider === 'openai') assert.equal(last.body.tool_choice, 'none');
      if (provider === 'ollama') assert.equal(last.body.tools, undefined);
      if (provider === 'gemini') assert.equal(last.body.toolConfig.functionCallingConfig.mode, 'NONE');
      assert.ok(last.options.timeout > 0);
      assert.ok(last.options.signal);
    });
  }
  test(`${provider} ignores final-turn tool requests, including uncertain text`, async () => {
    const f = fixture(provider, () => response(provider, true, "I don't know; run another tool."));
    const result = await f.run();
    assert.equal(f.executions.length, 1);
    assert.equal(f.requests.length, 2);
    assert.match(result.reply, /final summary was not returned/);
    assert.match(result.reply, /reported success/);
  });
  test(`${provider} handles an empty summary without discarding tool evidence`, async () => {
    const f = fixture(provider, state => response(provider, state.requests.length === 1, ''));
    const result = await f.run();
    assert.match(result.reply, /verified output/);
    assert.match(result.reply, /Some work may remain/);
  });
  test(`${provider} returns an ordinary answer without a second request`, async () => {
    const f = fixture(provider, () => response(provider));
    assert.equal((await f.run()).outcome, 'complete');
    assert.equal(f.requests.length, 1);
    assert.equal(f.executions.length, 0);
  });
  test(`${provider} summary timeout preserves results and never fails over to replay tools`, async () => {
    const f = fixture(provider, state => {
      if (state.requests.length === 1) return response(provider, true);
      throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    });
    const extra = provider === 'openai' ? 'gemini' : 'openai';
    const result = await f.run(1, { [extra]: { enabled: true, apiKey: 'test' } });
    assert.equal(result.outcome, 'incomplete');
    assert.equal(f.executions.length, 1);
    assert.equal(f.requests.length, 2);
    assert.match(result.reply, /timed out/);
    assert.match(result.reply, /No tool attempts were replayed/);
  });
  test(`${provider} cancellation during summary cannot return success or start failover`, async () => {
    const f = fixture(provider, state => {
      if (state.requests.length === 1) return response(provider, true);
      state.cancelCurrentSession('test-run');
      // Even a client that resolves after abort must not turn cancellation into success.
      return response(provider);
    });
    await assert.rejects(f.run(), error => {
      assert.equal(error.code, 'AGENT_STOPPED');
      assert.match(error.recoveryReport, /Run cancelled/);
      assert.match(error.recoveryReport, /reported success/);
      return true;
    });
    assert.equal(f.executions.length, 1);
    assert.equal(f.requests.length, 2);
  });
}

test('provider failure before any tools may fail over safely', async () => {
  const f = fixture('openai', (_state, provider) => {
    if (provider === 'openai') throw { response: { status: 401 } };
    return response(provider);
  });
  const result = await f.run(1, { gemini: { enabled: true, apiKey: 'test' } });
  assert.equal(result.provider, 'gemini');
  assert.equal(result.outcome, 'complete');
  assert.deepEqual(f.requests.map(request => request.provider), ['openai', 'gemini']);
  assert.equal(f.executions.length, 0);
});

test('failed tool attempts are not described as successful when the provider then fails', async () => {
  const f = fixture('openai', state => {
    if (state.requests.length === 1) return response('openai', true);
    throw { response: { status: 503 } };
  }, () => { throw new Error('tool failed'); });
  const result = await f.run();
  assert.match(result.reply, /test_tool: failed/);
  assert.match(result.reply, /HTTP 503/);
});

test('tool outcomes and connection errors distinguish denial, failure and unknown success', () => {
  assert.equal(toolOutcome('FILE_WRITE_DENIED: no'), 'denied');
  assert.equal(toolOutcome('SECURITY_BLOCKED: no'), 'blocked');
  assert.equal(toolOutcome('{"success":false}'), 'reported failure');
  assert.equal(toolOutcome('plain output'), 'returned output; success unverified');
  assert.match(formatProviderError({ response: { status: 429 } }), /rate or quota/);
  assert.match(formatProviderError({ code: 'ECONNREFUSED' }), /Ollama/);
});
