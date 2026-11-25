'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const { externalUrl, formFields, approval } = require('../src/approvals');
const { observeUsage, estimate } = require('../src/pricing');
const { renderHtml } = require('../src/webview');
const markdown = require('../media/render-markdown');
const { verifyDirectRouting, verifyCredentialIsolation } = require('../src/apiRelay');

test('webview CSP and rendered hostile Markdown do not allow scripts, active links, or remote images', () => {
  const html = renderHtml('vscode-resource:', 'nonce', 'monitor.css', 'monitor.bundle.js');
  assert.match(html, /default-src 'none'; style-src vscode-resource:; script-src 'nonce-nonce'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
  const result = markdown('<script>test</script>\n\n![image](https://example.invalid/test.png) [link](https://example.invalid)\n\n```js\nconst test = "<tag>";\n```');
  assert.doesNotMatch(result, /<script|<img|<a |https:\/\//);
  assert.match(result, /&lt;script&gt;test&lt;\/script&gt;/);
  assert.match(result, /hljs-keyword/);
});

test('unknown or concealed policy routing blocks the direct relay preview', () => {
  assert.doesNotThrow(() => verifyDirectRouting({}, {}));
  for (const config of [{ model_provider: 'company' }, { network: {} }, { forced_chatgpt_workspace_id: 'managed' }, { openai_base_url: 'https://proxy.invalid' }]) {
    assert.throws(() => verifyDirectRouting(config, {}));
  }
  assert.throws(() => verifyCredentialIsolation('synthetic-hp-key', { OPENAI_API_KEY: 'synthetic-hp-key' }));
  assert.doesNotThrow(() => verifyCredentialIsolation('synthetic-hp-key', { OPENAI_API_KEY: 'other-native-key' }));
  assert.throws(() => verifyDirectRouting({}, { HTTPS_PROXY: 'http://proxy.invalid' }));
});

test('external prompts only open explicit safe schemes and form schemas fail closed', () => {
  for (const url of ['command:test', 'javascript:alert(1)', 'https://user:pass@example.invalid', 'http://example.invalid']) {
    assert.equal(externalUrl(url), null);
  }
  assert.equal(externalUrl('http://127.0.0.1:8000/callback', true).hostname, '127.0.0.1');
  assert.equal(formFields({ type: 'object', properties: { item: { type: 'object' } } }), null);
  assert.equal(formFields({ type: 'object', properties: { item: { type: 'string', pattern: '.' } } }), null);
  assert.equal(formFields({ type: 'object', properties: { item: { type: 'number', minimum: 1 } }, required: ['item'] })[0].required, true);
});

test('native command approval requires the offered choice and a second confirmation within the same request lifetime', async () => {
  const request = { method: 'item/commandExecution/requestApproval', params: {
    command: 'wc -l fixture.txt', cwd: '/workspace', availableDecisions: ['accept', 'decline'],
  } };
  let modal;
  let pending = true;
  const vscode = { window: {
    showQuickPick: async items => { assert.deepEqual(items.map(row => row.value), ['accept', 'decline']); return items[0]; },
    showWarningMessage: async (message, options, choice) => { modal = { message, options }; pending = false; return choice; },
  } };
  const result = await approval(vscode, request, { token: {}, stillPending: () => pending });
  assert.equal(result.decision, 'cancel');
  assert.equal(modal.options.modal, true);
  assert.match(modal.options.detail, /wc -l fixture.txt/);
});

test('pricing uses response model, service tier, and actual cached usage and preserves SSE bytes', async () => {
  const response = { model: 'gpt-6.2-sol', service_tier: 'default', usage: {
    input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 100 },
  } };
  assert.equal(estimate(response, true), 0.00381);
  assert.equal(estimate({ ...response, service_tier: 'priority' }, true), null);
  assert.equal(estimate({ ...response, model: 'unknown' }, true), null);
  const sse = 'data: ' + JSON.stringify({ type: 'response.completed', response }) + '\r\n\r\n';
  let price;
  const observation = observeUsage({}, true, value => { price = value; });
  const chunks = [];
  observation.on('data', chunk => chunks.push(chunk));
  Readable.from([sse.slice(0, 50), sse.slice(50)]).pipe(observation);
  await once(observation, 'end');
  assert.equal(Buffer.concat(chunks).toString(), sse);
  assert.equal(price, 0.00381);
});
