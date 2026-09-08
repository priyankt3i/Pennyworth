const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateTitle, cleanTitle } = require('../core/conversation-title');

for (const provider of ['gemini', 'openai', 'ollama']) {
  test(`${provider} generates a bounded title request without tools`, async () => {
    let captured;
    const post = async (...args) => {
      captured = args;
      return { data: {
        candidates: [{ content: { parts: [{ thought: true, text: 'reasoning' }, { text: 'Running CS2 on Zorin OS' }] } }],
        choices: [{ message: { content: 'Running CS2 on Zorin OS' } }],
        message: { content: 'Running CS2 on Zorin OS' },
      } };
    };
    const title = await generateTitle(provider, { model: 'test-model', apiKey: 'test-key' }, 'x'.repeat(5000), null, post);
    assert.equal(title, 'Running CS2 on Zorin OS');
    const [url, body, options] = captured;
    assert.equal(body.tools, undefined);
    assert.equal(options.timeout, 20000);
    assert.ok(!url.includes('test-key'));
    const content = provider === 'gemini' ? body.contents[0].parts[0].text : body.messages[1].content;
    assert.equal(JSON.parse(content).length, 2000);
  });
}

test('empty title responses and provider errors reject without inventing a title', async () => {
  await assert.rejects(generateTitle('ollama', {}, 'query', null, async () => ({ data: {} })), /No useful title/);
  await assert.rejects(generateTitle('ollama', {}, 'query', null, async () => { throw new Error('offline'); }), /offline/);
  assert.equal(cleanTitle('"Running CS2\non Zorin OS"'), 'Running CS2 on Zorin OS');
  assert.equal(cleanTitle('a'.repeat(200)).length, 80);
});
