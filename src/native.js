'use strict';

const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { homedir, platform, arch } = require('node:os');

const exec = promisify(execFile);
const PROTOCOL_VERSION = '0.155.1';
const MAX_FRAME = 8_000_000;
const MAX_PENDING = 64;

function launchSpec(executable, cwd, env = process.env) {
  if (!['codex', 'codex.exe'].includes(executable) && !path.isAbsolute(executable)) {
    throw Error('Use Codex on PATH or select a trusted absolute executable path');
  }
  if (!path.isAbsolute(cwd)) throw Error('Workspace path must be absolute');
  return {
    executable, args: ['app-server'],
    options: { cwd, env: { ...env }, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  };
}

async function discover({ configured = 'codex', cwd, bundled, env = process.env, home = homedir() }) {
  launchSpec(configured, cwd, env);
  const local = platform() !== 'win32';
  const name = local ? 'codex' : 'codex.exe';
  const bundledPlatform = { darwin: 'macos', linux: 'linux', win32: 'windows' }[platform()];
  const bundledArch = { arm64: 'aarch64', x64: 'x86_64' }[arch()];
  const candidates = configured !== 'codex' ? [configured] : [
    name,
    ...(local ? [path.join(home, '.local/bin/codex'), '/opt/homebrew/bin/codex', '/usr/local/bin/codex'] : []),
    ...(bundled && bundledPlatform && bundledArch ? [path.join(bundled, 'bin', bundledPlatform + '-' + bundledArch, name)] : []),
  ];
  const found = [];
  for (const candidate of new Set(candidates)) {
    try {
      const { stdout } = await exec(candidate, ['--version'], { cwd, env, timeout: 5000, maxBuffer: 8192, windowsHide: true });
      const version = /^codex-cli ([0-9A-Za-z.+-]+)\s*$/.exec(stdout)?.[1];
      if (version === PROTOCOL_VERSION) return { version, spec: launchSpec(candidate, cwd, env) };
      if (version) found.push(version);
    } catch {
      // The version probe is discovery only. Raw stdout/stderr may contain private configuration.
    }
  }
  const versions = found.length ? ' Found ' + [...new Set(found)].join(', ') + '.' : '';
  throw Error('HP Codex requires official Codex ' + PROTOCOL_VERSION + '.' + versions);
}

class RpcError extends Error {
  constructor(message, uncertain = false, code = null) {
    super(message);
    this.uncertain = uncertain;
    this.code = code;
  }
}

class Rpc extends EventEmitter {
  constructor(spec) {
    super();
    this.pending = new Map();
    this.next = 0;
    this.buffer = '';
    this.closed = false;
    this.child = spawn(spec.executable, spec.args, spec.options);
    this.child.stdout.setEncoding('utf8').on('data', chunk => this.receive(chunk));
    this.child.stderr.resume();
    this.child.stdin.on('error', () => this.close('Codex input closed'));
    this.child.on('error', () => this.close('Unable to launch existing Codex'));
    this.child.on('close', () => this.close('Codex disconnected'));
  }

  receive(chunk) {
    if (this.closed) return;
    this.buffer += chunk;
    let newline;
    while (!this.closed && (newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > MAX_FRAME) return this.close('Oversize native response');
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { return this.close('Invalid native response'); }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return this.close('Invalid native response');
      if (typeof message.method === 'string') {
        if (!Object.hasOwn(message, 'id')) this.emit('notification', message);
        else if (typeof message.id === 'string' || Number.isSafeInteger(message.id)) {
          if (!this.emit('request', message)) {
            try { this.reject(message.id); } catch { this.close('Codex input buffer is unavailable'); }
          }
        } else return this.close('Invalid native request identifier');
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      if (Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error') || (Object.hasOwn(message, 'error') && !message.error)) return this.close('Invalid native response envelope');
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new RpcError('Codex rejected ' + pending.method, false, message.error.code));
      else pending.resolve(message.result);
    }
    if (this.buffer.length > MAX_FRAME) this.close('Oversize native response');
  }

  send(message) {
    if (this.closed) throw new RpcError('Codex is disconnected');
    const line = JSON.stringify(message) + '\n';
    if (line.length > MAX_FRAME) throw new RpcError('Native request is too large');
    if (this.child.stdin.writableLength + line.length > MAX_FRAME * 2) throw new RpcError('Codex input buffer is full');
    this.child.stdin.write(line);
  }

  request(method, params, timeout = 30_000) {
    if (this.closed || this.pending.size >= MAX_PENDING) return Promise.reject(new RpcError('Codex connection is unavailable or busy'));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError('Codex timed out during ' + method, true));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.send({ id, method, params }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method) { this.send({ method }); }
  respond(id, result) { if (!this.closed) this.send({ id, result }); }
  reject(id) {
    if (!this.closed) this.send({ id, error: { code: -32601, message: 'This client does not support this native request in the current context' } });
  }

  close(reason = 'Connection closed') {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new RpcError(reason, true));
    }
    this.pending.clear();
    this.buffer = '';
    this.child.stdin.destroy();
    this.child.kill();
    const kill = setTimeout(() => {
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
    }, 3000);
    kill.unref();
    this.child.once('close', () => clearTimeout(kill));
    this.emit('closed', reason);
  }
}

module.exports = { PROTOCOL_VERSION, launchSpec, discover, Rpc, RpcError, ...require('./state') };
