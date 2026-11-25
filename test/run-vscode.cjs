'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

const repo = path.resolve(__dirname, '..');
const executable = process.env.HP_VSCODE_EXECUTABLE || (process.platform === 'darwin'
  ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : '/usr/share/code/code');
const fixture = path.join(__dirname, 'fixtures/0.155.1/codex');
const evidence = process.env.HP_VSCODE_EVIDENCE && path.resolve(process.env.HP_VSCODE_EVIDENCE);
const fixtureText = 'Synthetic HP Codex test. No native account data.';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function ready(page, selector, value) {
  await page.locator(selector).filter({ hasText: value }).waitFor({ timeout: 15000 });
}

async function launch(theme, scenario, vsix) {
  const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'hp-vscode-fixture-')));
  const profile = path.join(scratch, 'profile');
  const extensions = path.join(scratch, 'extensions');
  const workspace = path.join(scratch, 'workspace');
  const trace = path.join(scratch, 'wire.ndjson');
  mkdirSync(path.join(profile, 'User'), { recursive: true });
  mkdirSync(extensions);
  mkdirSync(workspace);
  execFileSync('git', ['init', '-q', workspace]);
  writeFileSync(path.join(profile, 'User/settings.json'), JSON.stringify({
    'hpCodex.executable': fixture, 'workbench.colorTheme': theme,
    'workbench.startupEditor': 'none', 'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'window.dialogStyle': 'custom', 'window.restoreWindows': 'none', 'workbench.editor.enablePreview': false,
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none',
  }));
  const env = { ...process.env, CODEX_HOME: path.join(scratch, 'synthetic-native-home'), HP_FIXTURE_SCENARIO: scenario, HP_FIXTURE_TRACE: trace };
  delete env.ELECTRON_RUN_AS_NODE;
  const port = await freePort();
  if (vsix) {
    const cli = process.env.HP_VSCODE_CLI || (process.platform === 'darwin'
      ? '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' : 'code');
    execFileSync(cli, ['--user-data-dir', profile, '--extensions-dir', extensions, '--install-extension', vsix, '--force'], { env, stdio: 'ignore' });
  }
  const app = spawn(executable, [
    '--user-data-dir=' + profile, '--extensions-dir=' + extensions,
    ...(!vsix ? ['--extensionDevelopmentPath=' + repo] : []),
    '--remote-debugging-port=' + port, '--skip-welcome', '--skip-release-notes', '--new-window', workspace,
  ], { env, stdio: 'ignore' });
  let browser;
  const shutdown = async () => {
    await browser?.close().catch(() => {});
    if (app.exitCode === null && app.signalCode === null) {
      app.kill();
      await Promise.race([once(app, 'exit'), new Promise(resolve => setTimeout(resolve, 2500, undefined).unref())]);
    }
    if (app.exitCode === null && app.signalCode === null) app.kill('SIGKILL');
    rmSync(scratch, { recursive: true, force: true, maxRetries: 4 });
  };
  try {
    for (let attempt = 0; attempt < 60 && !browser; attempt++) {
      if (app.exitCode !== null) throw Error('VS Code process exited during launch');
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { timeout: 750 }); }
      catch { await new Promise(resolve => setTimeout(resolve, 150)); }
    }
    if (!browser) throw Error('VS Code debugging endpoint did not become available');
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.waitForEvent('page', { timeout: 15000 });
    await page.locator('.activitybar').waitFor({ timeout: 20000 });
    const restricted = page.getByRole('button', { name: 'Restricted Mode', exact: false }).first();
    if (await restricted.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
      await restricted.click();
      const manager = page.getByRole('button', { name: /^(Trust Workspace|Trust Folder|Trust Folder & Continue|Trust)$/ }).first();
      await manager.click({ timeout: 5000 }).catch(async error => {
        const status = (await page.getByRole('button').allTextContents()).map(text => text.trim()).filter(Boolean).slice(0, 30);
        throw Error('Could not open the trust confirmation. Buttons: ' + JSON.stringify(status), { cause: error });
      });
      const trust = page.getByRole('button', { name: /^(Trust Folder & Continue|Trust & Continue|Yes, I trust the authors)$/ }).first();
      if (await trust.waitFor({ timeout: 3000 }).then(() => true, () => false)) await trust.click();
      await restricted.waitFor({ state: 'hidden', timeout: 8000 });
    }
    if (await page.locator('.monaco-modal-editor-block').isVisible()) await page.keyboard.press('Escape');
    await page.locator('.activitybar [aria-label="HP Codex"]').first().click({ timeout: 8000 }).catch(async error => {
      const modal = (await page.locator('.monaco-modal-editor-block').allTextContents()).join(' ').slice(0, 500);
      throw Error('Could not open HP Codex. Modal: ' + modal, { cause: error });
    });
    const view = page.frameLocator('iframe.webview').frameLocator('iframe#active-frame');
    await ready(view, '#notice', 'Connected to existing Codex').catch(async error => {
      const notice = await view.locator('#notice').textContent({ timeout: 100 }).catch(() => null);
      throw Error('HP Codex did not connect: ' + (notice || 'view unavailable'), { cause: error });
    });
    return { page, view, trace, shutdown };
  } catch (error) {
    await shutdown();
    throw error;
  }
}

async function sidebar(page, width) {
  const frame = page.locator('.part.sidebar');
  const box = await frame.boundingBox();
  const edge = box.x + box.width;
  let result = box.width;
  for (const offset of [0, 2, -2]) {
    if (Math.abs(result - width) < 40) break;
    const next = await frame.boundingBox();
    const x = next.x + next.width + offset;
    const y = next.y + Math.min(185, next.height / 2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(edge + width - box.width, y, { steps: 12 });
    await page.mouse.up();
    result = (await frame.boundingBox()).width;
  }
  return result;
}

async function screenshot(view, name) {
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    await view.locator('body').screenshot({ path: path.join(evidence, name + '.png') });
  }
}

const button = (surface, name) => surface.getByRole('button', { name, exact: true });

async function conversationAndApproval() {
  const { page, view, trace, shutdown } = await launch('Default Dark Modern', 'normal');
  try {
    await button(view, 'Settings').click();
    await view.locator('#inventory summary').first().waitFor();
    assert.match(await view.locator('#inventory').innerText(), /MCP servers · 1/);
    assert.match(await view.locator('#inventory').innerText(), /Plugins · 1/);
    assert.doesNotMatch(await view.locator('body').innerText(), /fixture@example.invalid/);
    await screenshot(view, 'fake-dark-settings');
    await button(view, 'History').click();
    await ready(view, '#historyRows', 'Saved conversation');
    assert.doesNotMatch(await view.locator('#historyRows').innerText(), /Other provider/);
    await view.getByText('Saved conversation', { exact: true }).click();
    await button(view, 'Resume').click();
    await ready(view, '#threadTitle', 'Saved conversation');
    await button(view, 'Load earlier messages').click();
    await view.locator('.userMessage').filter({ hasText: 'Synthetic history turn 12' }).waitFor();
    const narrow = await sidebar(page, 250);
    const entry = view.getByRole('textbox', { name: 'Message to Codex' });
    await entry.fill('/rev');
    await button(view, '/review · Run native code review').waitFor();
    await entry.press('Escape');
    await entry.fill(fixtureText);
    await entry.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    const attention = button(view, 'Review request');
    await attention.waitFor({ timeout: 10000 });
    await button(view, 'Execution').click();
    await ready(view, '#progressText', '0/16');
    await screenshot(view, 'fake-dark-narrow-running');
    await attention.click();
    await page.getByText('Approve once', { exact: true }).click();
    await page.getByText(/wc -l fixture\.txt/).first().waitFor({ timeout: 8000 });
    await button(page, 'Approve once').click();
    await ready(view, '#taskStatus', 'Completed');
    await ready(view, '#progressText', /^16\/16/);
    await view.locator('#graph').waitFor();
    assert.equal(await view.locator('#metrics dd').first().innerText(), '420');
    assert.equal((await view.locator('#agents details').all()).length, 2);
    const wide = await sidebar(page, 570);
    assert.ok(narrow < 350 && wide > 420, 'Sidebar width changed from narrow to wide. Observed ' + narrow + ' and ' + wide);
    await screenshot(view, 'fake-dark-wide-completed');
    await view.locator('#activity details').filter({ hasText: 'Command ·' }).first().locator('summary').click();
    assert.match(await view.locator('#activity details[open] pre').innerText(), /fixture/);
    await button(view, 'Conversation').click();
    await view.locator('.agentMessage .hljs-keyword').waitFor();
    assert.equal(await view.locator('.agentMessage script').count(), 0);
    assert.match(await view.locator('.agentMessage').last().innerText(), /<script>/);
    assert.equal(await entry.inputValue(), '');
    const wire = readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(wire.filter(row => row.method === 'turn/start').length, 1);
    assert.ok(wire.some(row => row.result?.decision === 'accept' && row.id.startsWith('approval-')));
    assert.ok(wire.some(row => row.error?.code === -32601 && row.id.startsWith('unsupported-')));
    console.log('PASS — dark theme, narrow/wide sidebar, inventory, history, keyboard send, native approval UI, plans/agents/usage, Markdown and CSP');
  } finally { await shutdown(); }
}

async function interrupt() {
  const { view, trace, shutdown } = await launch('Default Light Modern', 'hold', process.env.HP_VSCODE_VSIX);
  try {
    assert.match(await view.locator('body').getAttribute('class'), /vscode-light/);
    const composerGap = await view.locator('#composer').evaluate(node => document.documentElement.clientHeight - node.getBoundingClientRect().bottom);
    assert.ok(Math.abs(composerGap) <= 2, 'Composer stays at the bottom with the prompt banner hidden');
    await screenshot(view, 'fake-light-empty');
    const entry = view.getByRole('textbox', { name: 'Message to Codex' });
    await entry.fill(fixtureText);
    await button(view, 'Send').click();
    await button(view, 'Stop').waitFor({ timeout: 10000 });
    await entry.fill('Synthetic steer');
    await button(view, 'Steer').click();
    await ready(view, '#notice', 'Sent to the active turn');
    await button(view, 'Stop').click();
    await ready(view, '#connection', 'Interrupted');
    await button(view, 'Execution').click();
    await screenshot(view, 'fake-light-interrupted');
    const wire = readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
    const steer = wire.find(row => row.method === 'turn/steer');
    const stop = wire.find(row => row.method === 'turn/interrupt');
    assert.ok(steer.params.expectedTurnId && steer.params.expectedTurnId === stop.params.turnId);
    console.log('PASS — light theme, empty state, native steering and interruption');
  } finally { await shutdown(); }
}

async function restartAfterFailure() {
  const { page, view, trace, shutdown } = await launch('Default Dark Modern', 'malformed');
  try {
    await view.getByRole('textbox', { name: 'Message to Codex' }).fill(fixtureText);
    await button(view, 'Send').click();
    await ready(view, '#notice', /Invalid native response/);
    await button(view, 'Reconcile').waitFor();
    await screenshot(view, 'fake-dark-error');
    await page.keyboard.press('F1');
    const command = page.locator('.quick-input-widget input');
    await command.fill('>Developer: Reload Window');
    await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'Reload Window' }).first().waitFor({ timeout: 8000 });
    await command.press('Enter');
    await ready(view, '#notice', 'A previous turn needs reconciliation');
    await button(view, 'Reconcile').waitFor();
    const wire = readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(wire.filter(row => row.method === 'turn/start').length, 1);
    console.log('PASS — malformed stream, native error state and restart checkpoint without resend');
  } finally { await shutdown(); }
}

async function independentKey() {
  const { page, view, trace, shutdown } = await launch('Default Dark Modern', 'normal', process.env.HP_VSCODE_VSIX);
  try {
    await button(view, 'Settings').click();
    const field = page.locator('.quick-input-widget input:visible');
    for (const synthetic of ['hp-codex-fixture-synthetic-first', 'hp-codex-fixture-synthetic-replacement']) {
      await button(view, 'Save or replace key').click();
      await field.waitFor({ timeout: 8000 });
      assert.equal(await field.getAttribute('type'), 'password');
      await field.fill(synthetic);
      await field.press('Enter');
      await ready(view, '#notice', 'Independent key saved');
      assert.doesNotMatch(await view.locator('body').innerText(), /hp-codex-fixture-synthetic/);
    }
    await button(view, 'Connect API mode').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Connect API mode', exact: true }).click();
    await ready(view, '#notice', 'Independent API mode · key format checked');
    assert.equal(await view.locator('#account').textContent(), 'OpenAI API · billable');
    await screenshot(view, 'fake-dark-disarmed-api-mode');
    await button(view, 'Connect existing Codex').click();
    await ready(view, '#notice', 'Connected to existing Codex');
    assert.match(await view.locator('#account').textContent(), /ChatGPT/);
    await button(view, 'Remove key').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
    await ready(view, '#notice', 'Independent key removed');
    assert.match(await view.locator('#keyStatus').textContent(), /No independent API key saved/);
    const wire = readFileSync(trace, 'utf8');
    assert.doesNotMatch(wire, /hp-codex-fixture-synthetic|turn\/start|account\/(login|logout)/);
    console.log('PASS — masked key save, replacement and removal, disarmed API connection and native switch-back');
  } finally { await shutdown(); }
}

(async () => {
  await conversationAndApproval();
  await interrupt();
  await restartAfterFailure();
  await independentKey();
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
