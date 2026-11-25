'use strict';

const { mkdirSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { dirname, join } = require('node:path');
const metadata = require('../package.json');

const root = dirname(__dirname);
const manifest = require.resolve('@vscode/vsce/package.json');
const binary = join(dirname(manifest), require(manifest).bin.vsce);
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });
execFileSync(process.execPath, [
  binary, 'package', '--pre-release', '--no-dependencies', '--skip-license',
  '--out', join(dist, metadata.name + '-' + metadata.version + '.vsix'),
], { cwd: root, stdio: 'inherit' });
