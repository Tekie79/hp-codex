'use strict';

const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { PROTOCOL_VERSION } = require('../src/native');

const binary = process.argv[2] || 'codex';
const version = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim();
if (version !== 'codex-cli ' + PROTOCOL_VERSION) throw Error('Expected Codex ' + PROTOCOL_VERSION);
const scratch = mkdtempSync(join(tmpdir(), 'hp-protocol-'));
const output = join(__dirname, '..', 'protocol', PROTOCOL_VERSION);

try {
  const stable = join(scratch, 'stable');
  const full = join(scratch, 'full');
  for (const [directory, flags] of [[stable, []], [full, ['--experimental']]]) {
    mkdirSync(directory);
    execFileSync(binary, ['app-server', 'generate-ts', '--out', directory, ...flags], { stdio: 'inherit' });
  }
  const methods = input => Object.fromEntries(['ClientRequest', 'ServerRequest', 'ServerNotification'].map(type => [
    type, [...readFileSync(join(input, type + '.ts'), 'utf8').matchAll(/"method": "([^"]+)"/g)].map(match => match[1]),
  ]));
  const capability = { version: PROTOCOL_VERSION, stable: methods(stable), withExperimental: methods(full) };
  writeFileSync(join(full, 'methods.json'), JSON.stringify(capability, null, 2) + '\n');
  rmSync(output, { recursive: true, force: true });
  cpSync(full, output, { recursive: true });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
