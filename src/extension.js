'use strict';

const vscode = require('vscode');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const path = require('node:path');
const { realpath, stat } = require('node:fs/promises');
const { discover, Rpc, newState, event, begin, hydrate, applyTurn, active, terminal, clean, list } = require('./native');
const { createRelay, validKey, providerSpec, verifyRoute, verifyRequirements, verifyDirectRouting, verifyCredentialIsolation } = require('./apiRelay');
const { effective, models, rateLimits, readInventory } = require('./inventory');
const { approval, externalUrl, isInside } = require('./approvals');
const { checkThread, brief, historyPage, readThread, itemPage, findTurn, isIdle, isTerminal } = require('./sessions');
const { renderHtml } = require('./webview');

const KEY_ID = 'hpCodex.independentOpenAiApiKey';
const PENDING = 'hpCodex.pendingTurn';
const checkpointKey = cwd => PENDING + ':' + createHash('sha256').update(cwd).digest('hex');
const APPROVALS = new Set([
  'item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval',
  'item/tool/requestUserInput', 'mcpServer/elicitation/request',
]);
const ACTIONS = new Set([
  'connect', 'api', 'setKey', 'removeKey', 'changeFolder', 'inventory', 'new', 'send', 'steer', 'stop',
  'history', 'historyMore', 'findFile', 'skillToggle', 'appMention', 'resume', 'viewThread', 'fork', 'archive', 'restore', 'rename', 'older',
  'attach', 'attachEditor', 'pickSkill', 'pickPlugin', 'removeAttachment', 'review', 'diff', 'login',
  'cancelLogin', 'logout', 'enablePlan', 'compact', 'revertHistory', 'reconcile', 'cloud', 'worktree',
  'mcpLogin', 'mcpReload', 'scm', 'official', 'approve',
]);

class Monitor {
  constructor(context) {
    this.context = context;
    this.state = newState();
    this.view = null;
    this.rpc = null;
    this.mode = 'native';
    this.notice = 'Use your existing Codex setup';
    this.keySaved = false;
    this.busy = false;
    this.attachments = [];
    this.approvals = new Map();
    this.patches = new Map();
    this.agentLookups = new Set();
    this.inventory = [];
    this.models = [];
    this.quota = [];
    this.history = [];
    this.workspaceEpoch = 0;
    this.experimental = false;
    this.startMarker = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    const root = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const webview = view.webview;
    const nonce = randomBytes(16).toString('base64');
    const uri = file => webview.asWebviewUri(vscode.Uri.joinPath(root, file)).toString();
    webview.options = { enableScripts: true, localResourceRoots: [root] };
    webview.html = renderHtml(webview.cspSource, nonce, uri('monitor.css'), uri('monitor.bundle.js'));
    const listener = webview.onDidReceiveMessage(message => void this.handle(message));
    view.onDidDispose(() => {
      listener.dispose();
      if (this.view === view) this.view = null;
    });
    this.publish();
    void this.readKeyStatus();
    if (!this.attempted && vscode.workspace.isTrusted && vscode.workspace.workspaceFolders?.length === 1) {
      this.attempted = true;
      void this.handle({ type: 'connect' });
    }
  }

  publish() {
    if (!this.view || this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      void this.view?.webview.postMessage({
        state: this.state, notice: this.notice, account: this.account, mode: this.mode, keySaved: this.keySaved,
        connected: Boolean(this.ready), connecting: this.busy && !this.ready, busy: this.busy, version: this.version,
        apiBilling: this.relay?.billing, workspace: this.workspace?.name, provider: this.provider, selected: this.selected,
        quota: this.mode === 'native' ? this.quota : [], settings: this.settings,
        defaultModel: this.defaults?.model, defaultEffort: this.defaults?.effort, models: this.models, modes: this.modes, experimental: this.experimental, inventory: this.inventory,
        attachments: this.attachments.map(({ id, label }) => ({ id, label })),
        history: this.history, archived: this.archived, historyMore: Boolean(this.historyCursor), older: Boolean(this.itemCursor),
        approval: [...this.approvals.values()].find(entry => !entry.shown)?.key, login: Boolean(this.loginId),
        readOnly: Boolean(this.readOnly), canRun: Boolean(this.ready && (this.mode === 'api' || this.account || !this.requiresAuth)),
        recovery: Boolean(this.startMarker),
      });
    }, 40);
  }

  async workspaceRoot(select) {
    const folders = vscode.workspace.workspaceFolders || [];
    if (!vscode.workspace.isTrusted || !folders.length) throw Error('Open a trusted workspace folder first');
    const editor = vscode.window.activeTextEditor;
    const fromEditor = editor && vscode.workspace.getWorkspaceFolder(editor.document.uri);
    let selected = !select && (this.workspace?.folder || fromEditor || (folders.length === 1 && folders[0]));
    if (!selected) selected = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose a Codex workspace folder or worktree' });
    if (!selected) return null;
    if (selected.uri.scheme !== 'file' && !(vscode.env.remoteName && selected.uri.scheme === 'vscode-remote')) {
      throw Error('The native engine requires a workspace on the VS Code extension host filesystem');
    }
    return { folder: selected, name: selected.name, cwd: await realpath(selected.uri.fsPath) };
  }

  assertCurrent(rpc) {
    if (rpc !== this.rpc || !vscode.workspace.isTrusted) throw Error('The Codex connection changed');
  }

  idle() {
    if (active.has(this.state.status) || this.startMarker || this.loginId) throw Error('Finish the active operation or reconcile the previous turn first');
  }

  clearApprovals() {
    for (const entry of this.approvals.values()) {
      entry.source.cancel();
      entry.source.dispose();
    }
    this.approvals.clear();
  }

  closeConnection() {
    const rpc = this.rpc;
    this.rpc = null;
    this.ready = false;
    this.account = null;
    this.loginId = null;
    this.clearApprovals();
    this.relay?.close();
    this.relay = null;
    this.route = null;
    rpc?.close();
  }

  resetThread() {
    this.clearApprovals();
    this.patches.clear();
    this.agentLookups.clear();
    this.state = newState();
    this.selected = null;
    this.readOnly = false;
    this.itemCursor = null;
  }

  async releaseThread() {
    if (this.state.threadId && !this.readOnly) {
      await this.rpc?.request('thread/unsubscribe', { threadId: this.state.threadId }).catch(() => {});
    }
    this.resetThread();
  }

  async initialize(rpc, experimental) {
    await rpc.request('initialize', {
      clientInfo: { name: 'hp_codex', title: 'HP Codex', version: this.context.extension.packageJSON.version },
      capabilities: {
        experimentalApi: experimental, requestAttestation: false,
        optOutNotificationMethods: ['item/reasoning/textDelta', 'rawResponseItem/completed', 'rawResponse/completed'],
      },
    });
    rpc.notify('initialized');
  }

  async connect(mode, { root, experimental = this.experimental, recover = false } = {}) {
    if (this.ready && this.mode === mode && !root && experimental === this.experimental && !recover) return;
    if (!recover) this.idle();
    const epoch = this.workspaceEpoch;
    const workspace = root || await this.workspaceRoot(false);
    if (!workspace) return;
    if (mode === 'api' && vscode.env.remoteName) throw Error('Independent API mode is unavailable on remote extension hosts');
    if (this.startMarker && this.startMarker.cwd !== workspace.cwd) throw Error('Reconcile the pending turn in its original workspace');
    const configured = vscode.workspace.getConfiguration('hpCodex').get('executable', 'codex');
    const installed = vscode.extensions.getExtension('openai.chatgpt');
    const { version, spec } = await discover({ configured, cwd: workspace.cwd, bundled: installed?.extensionPath });
    let apiSpec = null;
    let relay = null;
    let route = null;
    if (mode === 'api') {
      const key = await this.context.secrets.get(KEY_ID);
      if (!key) throw Error('Save an independent HP API key first');
      verifyCredentialIsolation(key, spec.options.env);
      if (await vscode.window.showWarningMessage('Connect using the independent OpenAI Platform key?', {
        modal: true, detail: 'Requests go to api.openai.com. Each paid turn requires its own confirmation. Use this preview only where direct OpenAI API routing is permitted.',
      }, 'Connect API mode') !== 'Connect API mode') return;
      const preflight = new Rpc(spec);
      try {
        await this.initialize(preflight, false);
        verifyRequirements(await preflight.request('configRequirements/read'));
        const { config } = await preflight.request('config/read', { cwd: workspace.cwd, includeLayers: false });
        verifyDirectRouting(config, spec.options.env);
      } finally { preflight.close(); }
      relay = await createRelay(key);
      route = providerSpec(spec, relay);
      apiSpec = route.spec;
    }
    if (epoch !== this.workspaceEpoch) {
      relay?.close();
      throw Error('The workspace changed during connection');
    }
    this.closeConnection();
    if (!recover) this.resetThread();
    this.workspace = workspace;
    this.mode = mode;
    this.experimental = experimental;
    this.version = version;
    this.provider = null;
    this.settings = [];
    this.models = [];
    this.modes = [];
    this.inventory = [];
    this.history = [];
    this.historyCursor = null;
    this.quota = [];
    if (!recover) this.attachments = [];
    this.notice = 'Connecting to native Codex';
    this.relay = relay;
    this.route = route;
    const rpc = new Rpc(apiSpec || spec);
    this.rpc = rpc;
    rpc.on('notification', ({ method, params }) => this.onNotification(rpc, method, params));
    rpc.on('request', request => this.onNativeRequest(rpc, request));
    rpc.on('closed', reason => {
      if (this.rpc !== rpc) return;
      this.closeConnection();
      if (active.has(this.state.status) || this.startMarker) this.state.status = 'unknown';
      this.notice = reason;
      this.publish();
    });
    try {
      await this.initialize(rpc, experimental);
      if (mode === 'api') await this.verifyApi(rpc);
      await this.refreshConnection(rpc);
      this.assertCurrent(rpc);
      this.ready = true;
      this.launch = spec;
      this.notice = mode === 'api' ? 'Independent API mode · key format checked' : 'Connected to existing Codex';
      const saved = this.context.workspaceState.get(checkpointKey(workspace.cwd)) || this.context.workspaceState.get(PENDING);
      if (!this.startMarker && saved?.cwd === workspace.cwd && typeof saved.threadId === 'string') {
        this.startMarker = saved;
        this.state.status = 'unknown';
        this.notice = 'A previous turn needs reconciliation';
      }
      void this.refreshCatalog(rpc);
    } catch (error) {
      if (this.rpc === rpc) this.closeConnection();
      throw error;
    }
  }

  async refreshConnection(rpc) {
    const [account, config] = await Promise.all([
      rpc.request('account/read', { refreshToken: false }),
      rpc.request('config/read', { cwd: this.workspace.cwd, includeLayers: false }),
    ]);
    this.assertCurrent(rpc);
    this.requiresAuth = account.requiresOpenaiAuth !== false;
    this.account = this.mode === 'api' ? { type: 'HP API key' } : account.account?.type === 'chatgpt' ? {
      type: 'ChatGPT', plan: clean(account.account.planType, 80),
    } : account.account?.type === 'apiKey' ? { type: 'Native API key' } : account.account?.type === 'amazonBedrock'
      ? { type: 'Amazon Bedrock' } : null;
    this.provider = typeof config.config?.model_provider === 'string' ? config.config.model_provider : 'openai';
    this.directRouteOverride = Boolean(config.config?.openai_base_url || config.config?.model_providers?.openai?.base_url
      || process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL);
    this.settings = effective(config);
    this.defaults = { model: config.config?.model, effort: config.config?.model_reasoning_effort };
  }

  async refreshCatalog(rpc) {
    const read = async (method, params, apply) => {
      try {
        const value = await rpc.request(method, params);
        if (this.rpc === rpc) { apply(value); this.publish(); }
      } catch { /* One unavailable catalog must not invalidate the connection. */ }
    };
    await Promise.all([
      read('model/list', { limit: 100, includeHidden: false }, value => { this.models = models(value); }),
      this.experimental && read('collaborationMode/list', undefined, value => {
        this.modes = list(value?.data).filter(mode => ['plan', 'default'].includes(mode.mode));
      }),
      this.mode === 'native' && this.account?.type === 'ChatGPT' && read('account/rateLimits/read', undefined, value => {
        this.quota = rateLimits(value, this.quota);
      }),
    ]);
  }

  async verifyApi(rpc) {
    const [config, requirements] = await Promise.all([
      rpc.request('config/read', { cwd: this.workspace.cwd, includeLayers: false }),
      rpc.request('configRequirements/read'),
    ]);
    this.assertCurrent(rpc);
    verifyRequirements(requirements);
    verifyRoute(config.config, this.route.provider, this.relay.baseUrl, this.route.envKey);
  }

  async readKeyStatus() {
    try { this.keySaved = Boolean(await this.context.secrets.get(KEY_ID)); }
    catch { this.notice = 'VS Code could not read the independent key store'; }
    this.publish();
  }

  async saveKey(remove) {
    this.idle();
    if (remove) {
      if (await vscode.window.showWarningMessage('Remove the independent HP Codex key?', { modal: true }, 'Remove') !== 'Remove') return;
      await this.context.secrets.delete(KEY_ID);
    } else {
      const key = await vscode.window.showInputBox({
        title: 'Independent OpenAI Platform key', prompt: 'Saved in VS Code SecretStorage for HP Codex only',
        password: true, ignoreFocusOut: true, validateInput: value => validKey(value) ? null : 'Enter a valid key without spaces or control characters',
      });
      if (!key || !validKey(key)) return;
      await this.context.secrets.store(KEY_ID, key);
    }
    if (this.mode === 'api') { this.closeConnection(); this.resetThread(); }
    await this.readKeyStatus();
    this.notice = remove ? 'Independent key removed' : 'Independent key saved';
  }

  async storeMarker(marker) {
    const cwd = marker?.cwd || this.startMarker?.cwd || this.workspace?.cwd;
    this.startMarker = marker;
    if (!cwd) return;
    const write = async () => {
      await this.context.workspaceState.update(checkpointKey(cwd), marker || undefined);
      if (!marker && this.context.workspaceState.get(PENDING)?.cwd === cwd) await this.context.workspaceState.update(PENDING, undefined);
    };
    this.markerWrite = (this.markerWrite || Promise.resolve()).catch(() => {}).then(write);
    await this.markerWrite;
  }

  onNotification(rpc, method, params) {
    if (rpc !== this.rpc || !params) return;
    if (method === 'account/updated' || method === 'account/login/completed') {
      if (method === 'account/login/completed' && this.loginId && params.loginId !== this.loginId) return;
      if (method === 'account/login/completed') this.loginId = null;
      this.account = null;
      this.quota = [];
      this.attachments = [];
      if (this.startMarker || active.has(this.state.status)) {
        this.relay?.disarm();
        this.state.status = 'unknown';
        this.notice = 'Native account changed during execution. Reconcile the turn.';
      } else {
        this.resetThread();
        this.history = [];
        this.historyCursor = null;
        this.notice = method === 'account/login/completed' && !params.success ? 'Native sign-in did not complete' : 'Native account state refreshed';
      }
      void this.refreshConnection(rpc).then(() => this.refreshCatalog(rpc)).catch(() => {
        if (this.rpc === rpc) this.notice = 'Native account status unavailable';
      }).finally(() => this.publish());
      this.publish();
      return;
    }
    if (method === 'account/rateLimits/updated' && this.mode === 'native') {
      this.quota = rateLimits(params, this.quota);
      this.publish();
      return;
    }
    if (method === 'skills/changed' || method === 'app/list/updated') {
      this.inventory = [];
      this.publish();
      return;
    }
    if (['warning', 'configWarning', 'deprecationNotice'].includes(method) && (!params.threadId || params.threadId === this.state.threadId)) {
      const warning = clean(params.message || params.summary, 1000);
      if (warning) { this.notice = warning; this.publish(); }
      return;
    }
    if (method === 'mcpServer/oauthLogin/completed') {
      this.notice = params.success ? 'MCP sign-in completed' : 'MCP sign-in failed or was cancelled';
      this.publish();
      return;
    }
    if (params.threadId !== this.state.threadId || !this.state.threadId || this.readOnly) return;
    if (method === 'serverRequest/resolved') {
      const entry = this.approvals.get(params.requestId);
      if (entry) this.dropApproval(entry);
    } else if (method === 'thread/settings/updated' && this.selected) {
      this.selected = { ...this.selected, model: clean(params.threadSettings?.model, 180), effort: clean(params.threadSettings?.effort, 80) };
    } else if (method === 'model/rerouted' && params.turnId === this.state.turnId && this.selected) {
      const model = clean(params.toModel, 180);
      if (model) { this.selected.model = model; this.notice = 'Codex rerouted this turn to ' + model; }
    } else if (method === 'thread/name/updated' && this.selected && params.threadName) {
      this.selected.name = clean(params.threadName, 180);
    } else if (method === 'thread/closed' || method === 'thread/archived' || method === 'thread/deleted') {
      this.readOnly = true;
      if (this.startMarker) this.state.status = 'unknown';
    } else {
      if ((method === 'turn/started' || method === 'turn/completed') && !this.startMarker && !this.state.turnId) return;
      if (method === 'turn/started' && this.state.turnId && this.state.turnId !== params.turn?.id) return;
      const patch = method === 'item/started' && params.item?.type === 'fileChange' ? params.item.changes
        : method === 'item/fileChange/patchUpdated' ? params.changes : null;
      const patchId = params.item?.id || params.itemId;
      if (patch && params.turnId === this.state.turnId && typeof patchId === 'string') {
        const size = JSON.stringify(patch).length;
        if (size <= 32_000 && (this.patches.has(patchId) || this.patches.size < 100)) this.patches.set(patchId, patch);
      }
      event(this.state, method, params);
      if (terminal.has(this.state.status) && method === 'turn/completed' && params.turn?.id === this.state.turnId) {
        this.finishTurn();
        void this.syncThreadSettings(rpc, this.state.threadId);
      }
      if (method === 'item/completed' && params.turnId === this.state.turnId) this.lookupAgents(rpc);
    }
    this.publish();
  }

  lookupAgents(rpc) {
    for (const agent of this.state.agents) {
      if (this.agentLookups.has(agent.id) || this.agentLookups.size >= 60) continue;
      this.agentLookups.add(agent.id);
      void rpc.request('thread/read', { threadId: agent.id, includeTurns: false }).then(({ thread }) => {
        if (this.rpc !== rpc || ![this.state.threadId, ...this.state.agents.map(row => row.id)].includes(thread?.parentThreadId)) return;
        const current = this.state.agents.find(row => row.id === agent.id && row.turnId === agent.turnId);
        if (!current || thread.id !== current.id) return;
        current.name = clean(thread.agentNickname, 100) || current.name;
        current.role = clean(thread.agentRole, 100);
        current.parentId = thread.parentThreadId;
        this.publish();
      }).catch(() => {});
    }
  }

  finishTurn() {
    this.relay?.disarm();
    this.clearApprovals();
    this.patches.clear();
    if (this.startMarker) void this.storeMarker(null).catch(() => { this.notice = 'Could not clear the persisted turn checkpoint'; this.publish(); });
    const error = this.relay?.billing.lastError;
    if (error === 401 || error === 403) this.notice = 'OpenAI API did not authorize this request';
    else if (error === 429) this.notice = 'OpenAI API rate or quota limit reached';
    else if (this.relay?.verified) this.notice = 'OpenAI API key accepted by the upstream API';
  }

  onNativeRequest(rpc, request) {
    const params = request.params;
    const current = rpc === this.rpc && vscode.workspace.isTrusted && !this.readOnly
      && this.state.threadId && params?.threadId === this.state.threadId;
    if (this.approvals.has(request.id)) return;
    if (!current || !APPROVALS.has(request.method) || !['starting', 'running'].includes(this.state.status)
        || !params.turnId || params.turnId !== this.state.turnId || this.approvals.size >= 8) {
      try { rpc.reject(request.id); } catch { rpc.close(); }
      return;
    }
    const entry = { key: randomUUID(), request, source: new vscode.CancellationTokenSource(), shown: false, rpc };
    this.approvals.set(request.id, entry);
    this.publish();
  }

  dropApproval(entry) {
    this.approvals.delete(entry.request.id);
    entry.source.cancel();
    entry.source.dispose();
  }

  async promptApproval(key) {
    const entry = [...this.approvals.values()].find(row => row.key === key);
    if (!entry || entry.shown) return;
    entry.shown = true;
    const stillPending = () => this.approvals.get(entry.request.id) === entry && this.rpc === entry.rpc && vscode.workspace.isTrusted;
    try {
      const result = await approval(vscode, entry.request, {
        token: entry.source.token, stillPending, patch: () => this.patches.get(entry.request.params.itemId),
      });
      if (stillPending()) {
        if (result) entry.rpc.respond(entry.request.id, result);
        else entry.rpc.reject(entry.request.id);
      }
    } catch {
      if (stillPending()) {
        try { entry.rpc.reject(entry.request.id); } catch { entry.rpc.close(); }
      }
      this.notice = 'Native request could not be displayed safely';
    } finally {
      if (stillPending()) this.dropApproval(entry);
      this.publish();
    }
  }

  async refreshHistory(archived = this.archived === true, more = false) {
    const rpc = this.rpc;
    const page = await historyPage(rpc, this.workspace.cwd, this.provider, archived, more ? this.historyCursor : null);
    this.assertCurrent(rpc);
    this.archived = archived;
    const combined = more ? [...this.history, ...page.rows] : page.rows;
    this.history = [...new Map(combined.map(row => [row.id, row])).values()].slice(0, 300);
    this.historyCursor = this.history.length < 300 ? page.cursor : null;
  }

  async selectThread(id, operation) {
    this.idle();
    const rpc = this.rpc;
    const target = this.history.find(row => row.id === id);
    if (!target) throw Error('Choose a conversation from the current workspace history');
    const original = await readThread(rpc, id, this.workspace.cwd, this.provider);
    this.assertCurrent(rpc);
    if (operation !== 'viewThread' && (!isIdle(original) || this.archived)) throw Error('Open an idle, unarchived conversation before editing');
    if (this.state.threadId !== id || operation === 'fork') await this.releaseThread();
    let thread = original;
    let result;
    if (operation !== 'viewThread') {
      result = await rpc.request(operation === 'fork' ? 'thread/fork' : 'thread/resume', { threadId: id, excludeTurns: true });
      this.assertCurrent(rpc);
      thread = checkThread(result.thread, this.workspace.cwd, this.provider);
      if ((operation === 'resume' && thread.id !== id) || !isIdle(thread)) throw Error('The native conversation is no longer idle');
    }
    this.resetThread();
    this.state.threadId = thread.id;
    this.selected = { ...brief(thread), model: result?.model ?? thread.model, effort: result?.reasoningEffort ?? thread.reasoningEffort };
    this.readOnly = operation === 'viewThread';
    this.attachments = [];
    await this.loadItems(false);
    if (operation === 'fork') await this.refreshHistory();
    void this.view?.webview.postMessage({ openConversation: true });
  }

  async loadItems(older) {
    const rpc = this.rpc;
    const threadId = this.state.threadId;
    if (!threadId || (older && !this.itemCursor)) return;
    const page = await itemPage(rpc, threadId, older ? this.itemCursor : null);
    this.assertCurrent(rpc);
    if (this.state.threadId !== threadId) return;
    const prior = older ? this.state.items : [];
    this.state.items = [];
    hydrate(this.state, page.turns);
    const joined = [...new Map([...this.state.items, ...prior].map(row => [row.id, row])).values()];
    this.state.items = joined.slice(older ? 0 : Math.max(0, joined.length - 240), older ? 240 : undefined);
    this.itemCursor = page.cursor;
  }

  async threadAction(type, id = this.state.threadId) {
    this.idle();
    if (typeof id !== 'string' || (id !== this.state.threadId && !this.history.some(row => row.id === id))) return;
    const rpc = this.rpc;
    const thread = await readThread(rpc, id, this.workspace.cwd, this.provider);
    if (!isIdle(thread)) throw Error('The native conversation is active');
    const name = clean(thread.name || thread.preview, 120) || 'this conversation';
    if (type === 'rename') {
      const next = await vscode.window.showInputBox({ title: 'Rename native conversation', value: name, validateInput: value => value.trim().length <= 160 && value.trim() ? null : 'Enter a name up to 160 characters' });
      if (!next?.trim()) return;
      this.assertCurrent(rpc);
      await rpc.request('thread/name/set', { threadId: id, name: next.trim() });
      if (this.state.threadId === id && this.selected) this.selected.name = next.trim();
    } else {
      const archived = type === 'archive';
      const action = archived ? 'Archive' : 'Restore';
      if (await vscode.window.showWarningMessage(action + ' the conversation shared with native Codex?', { modal: true, detail: name }, action) !== action) return;
      this.assertCurrent(rpc);
      await rpc.request(archived ? 'thread/archive' : 'thread/unarchive', { threadId: id });
      if (this.state.threadId === id) await this.releaseThread();
    }
    await this.refreshHistory();
  }

  async ensureThread(rpc) {
    if (this.readOnly) throw Error('Resume the conversation or start a new one before sending');
    if (this.state.threadId) {
      return readThread(rpc, this.state.threadId, this.workspace.cwd, this.provider);
    }
    const result = await rpc.request('thread/start', { cwd: this.workspace.cwd });
    this.assertCurrent(rpc);
    const thread = checkThread(result.thread, this.workspace.cwd, this.provider);
    if (result.modelProvider !== this.provider) throw Error('Codex returned an unexpected effective provider');
    this.state.threadId = thread.id;
    this.selected = { ...brief(thread), model: result.model, effort: result.reasoningEffort };
    return thread;
  }

  async syncThreadSettings(rpc, threadId) {
    try {
      const thread = await readThread(rpc, threadId, this.workspace.cwd, this.provider);
      if (this.rpc === rpc && this.state.threadId === thread.id && this.selected) {
        if (thread.model) this.selected.model = thread.model;
        this.selected.effort = thread.reasoningEffort;
        this.publish();
      }
    } catch { /* Thread settings can arrive as native notifications instead. */ }
  }

  async consent() {
    if (this.mode === 'native' && this.account?.type === 'ChatGPT' && this.provider === 'openai' && !this.directRouteOverride) return true;
    const detail = this.mode === 'api'
      ? 'This turn uses the HP Codex key from VS Code SecretStorage and may incur OpenAI Platform charges.'
      : 'The inherited provider ' + clean(this.provider, 100) + ' may incur API charges under your existing settings.';
    return await vscode.window.showWarningMessage('Run a potentially billable Codex turn?', { modal: true, detail }, 'Run this turn') === 'Run this turn';
  }

  checkedInput(text) {
    const refs = this.attachments.map(row => row.input).filter(Boolean);
    const context = this.attachments.map(row => row.text).filter(Boolean);
    const additions = context.length ? '\n\nEditor context provided with this message:\n' + context.join('\n\n') : '';
    return [{ type: 'text', text: text + additions, text_elements: [] }, ...refs];
  }

  preferences(message) {
    const selected = this.models.find(model => model.id === message.model);
    if (message.model && !selected) throw Error('Choose a model from the native catalog');
    const current = selected || this.models.find(model => model.id === (this.selected?.model || this.defaults?.model));
    if (message.effort && !current?.efforts.includes(message.effort)) throw Error('Choose an effort supported by the active model');
    const settings = {
      ...(selected ? { model: selected.id } : {}),
      ...(message.effort ? { effort: message.effort } : {}),
    };
    if (message.plan) {
      const preset = this.modes.find(mode => mode.mode === message.plan);
      const model = settings.model || this.selected?.model || this.defaults?.model;
      if (!preset || !model || !this.experimental) throw Error('The native Plan mode preset is unavailable');
      settings.collaborationMode = {
        mode: preset.mode,
        settings: { model, reasoning_effort: settings.effort || this.selected?.effort || this.defaults?.effort || null, developer_instructions: null },
      };
    }
    return settings;
  }

  async send(message) {
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    if ((!text && !this.attachments.length) || text.length > 50_000) throw Error('Enter a message up to 50,000 characters or attach context');
    const input = this.checkedInput(text);
    const rpc = this.rpc;
    if (message.type === 'steer') {
      if (this.state.status !== 'running' || !this.state.turnId) throw Error('There is no active turn to steer');
      await rpc.request('turn/steer', { threadId: this.state.threadId, expectedTurnId: this.state.turnId, clientUserMessageId: randomUUID(), input });
      this.attachments = [];
      void this.view?.webview.postMessage({ sent: true });
      this.notice = 'Sent to the active turn';
      return;
    }
    this.idle();
    await this.runTurn(rpc, 'turn/start', { input, ...this.preferences(message) });
  }

  async runTurn(rpc, method, params) {
    if (!this.ready || (this.mode === 'native' && this.requiresAuth && !this.account)) throw Error('Connect with native Codex authentication first');
    if (this.mode === 'api') await this.verifyApi(rpc);
    const thread = await this.ensureThread(rpc);
    if (!isIdle(thread)) throw Error('The native conversation already has an active turn');
    const identity = this.account;
    if (!await this.consent()) return;
    this.assertCurrent(rpc);
    if (this.account !== identity) throw Error('The native account changed during confirmation');
    const clientId = method === 'turn/start' ? randomUUID() : null;
    const marker = { cwd: this.workspace.cwd, threadId: thread.id, provider: this.provider, clientId, mode: this.mode, at: Date.now(), method };
    try { await this.storeMarker(marker); }
    catch (error) { this.startMarker = null; throw error; }
    try {
      this.assertCurrent(rpc);
      if (this.account !== identity) throw Error('The native account changed before execution');
      if (this.mode === 'api') await this.verifyApi(rpc);
    } catch (error) {
      await this.storeMarker(null);
      throw error;
    }
    begin(this.state);
    this.patches.clear();
    this.agentLookups.clear();
    this.notice = 'Waiting for native Codex';
    this.publish();
    try {
      this.relay?.arm();
      const result = await rpc.request(method, {
        threadId: thread.id, ...(clientId ? { clientUserMessageId: clientId } : {}), ...params,
      });
      this.assertCurrent(rpc);
      if (method === 'thread/compact/start') {
        this.notice = 'Native compaction requested';
        return;
      }
      if (typeof result?.turn?.id !== 'string' || (this.state.turnId && this.state.turnId !== result.turn.id)) {
        throw Object.assign(Error('Could not confirm which turn Codex started'), { uncertain: true });
      }
      applyTurn(this.state, result.turn);
      void this.syncThreadSettings(rpc, thread.id);
      if (this.startMarker && this.state.turnId) await this.storeMarker({ ...marker, turnId: this.state.turnId });
      if (terminal.has(this.state.status)) this.finishTurn();
      this.attachments = [];
      if (this.view) void this.view.webview.postMessage({ sent: method === 'turn/start' });
      if (!terminal.has(this.state.status)) this.notice = 'Native Codex accepted the turn';
    } catch (error) {
      if (terminal.has(this.state.status)) throw error;
      this.relay?.disarm();
      if (error.uncertain || this.state.turnId) {
        this.state.status = 'unknown';
        this.notice = 'Turn outcome unknown. Reconcile before sending again.';
      } else {
        this.state.status = 'failed';
        await this.storeMarker(null);
      }
      throw error;
    }
  }

  async interrupt() {
    if (this.state.status !== 'running' || !this.state.turnId) return;
    const rpc = this.rpc;
    this.state.status = 'stopping';
    this.clearApprovals();
    this.publish();
    try {
      await rpc.request('turn/interrupt', { threadId: this.state.threadId, turnId: this.state.turnId });
      this.relay?.disarm();
    } catch (error) {
      this.relay?.disarm();
      if (!terminal.has(this.state.status)) this.state.status = 'unknown';
      throw error;
    }
  }

  async reconcile() {
    const marker = this.startMarker;
    if (!marker) throw Error('No turn awaits reconciliation');
    if (!this.ready) await this.connect('native', { recover: true });
    const rpc = this.rpc;
    const thread = await readThread(rpc, marker.threadId, marker.cwd, marker.provider);
    const turnId = marker.turnId || this.state.turnId;
    let turn = await findTurn(rpc, thread.id, turnId, marker.clientId);
    if (!turn && !turnId && !marker.clientId && isIdle(thread)) {
      const recent = await rpc.request('thread/turns/list', { threadId: thread.id, limit: 3, itemsView: 'summary', sortDirection: 'desc' });
      turn = list(recent.data).find(candidate => candidate.startedAt * 1000 >= marker.at - 1000 && isTerminal(candidate));
    }
    this.assertCurrent(rpc);
    if (!isTerminal(turn) || !isIdle(thread)) throw Error('Codex has not confirmed a terminal outcome. Check this conversation in the official client.');
    this.resetThread();
    this.state.threadId = thread.id;
    this.selected = { ...brief(thread), model: thread.model, effort: thread.reasoningEffort };
    this.readOnly = true;
    await this.loadItems(false);
    this.state.doneTurns = this.state.doneTurns.filter(id => id !== turn.id);
    applyTurn(this.state, turn);
    await this.storeMarker(null);
    this.relay?.disarm();
    this.notice = 'Previous turn reconciled. Resume it from history to continue.';
  }

  async addAttachment(type) {
    if (this.attachments.length >= 12) throw Error('A message can include up to 12 attachments');
    const root = this.workspace.cwd;
    if (type === 'attachEditor') {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.isUntitled || (editor.document.uri.scheme !== this.workspace.folder.uri.scheme)) throw Error('Open a workspace file first');
      const file = await realpath(editor.document.uri.fsPath);
      if (!isInside(root, file)) throw Error('The editor file is outside the selected workspace');
      const name = path.relative(root, file);
      if (editor.selection.isEmpty) this.attachments.push({ id: randomUUID(), label: name, text: 'File ' + JSON.stringify(name) });
      else {
        const selection = editor.document.getText(editor.selection);
        if (selection.length > 16_000) throw Error('Choose an editor selection up to 16,000 characters');
        const line = editor.selection.start.line + 1;
        this.attachments.push({ id: randomUUID(), label: name + ':' + line, text: name + ':' + line + '\n' + selection });
      }
      return;
    }
    const files = await vscode.window.showOpenDialog({
      defaultUri: this.workspace.folder.uri, canSelectMany: true, canSelectFolders: false, openLabel: 'Attach selected files',
    });
    for (const uri of list(files).slice(0, 12 - this.attachments.length)) {
      if (uri.scheme !== this.workspace.folder.uri.scheme) continue;
      const file = await realpath(uri.fsPath);
      const info = await stat(file);
      if (!info.isFile()) continue;
      const image = /\.(png|jpe?g|gif|webp)$/i.test(file);
      if (image) {
        if (info.size > 10 * 1024 * 1024) throw Error('Image attachments are limited to 10 MiB each');
        this.attachments.push({ id: randomUUID(), label: path.basename(file), input: { type: 'localImage', path: file } });
      } else {
        if (!isInside(root, file)) throw Error('Attach a non-image file from the selected workspace');
        const name = path.relative(root, file);
        this.attachments.push({ id: randomUUID(), label: name, text: 'File ' + JSON.stringify(name) });
      }
    }
  }

  async findFile() {
    if (this.attachments.length >= 12) throw Error('A message can include up to 12 attachments');
    const rpc = this.rpc;
    const root = this.workspace.cwd;
    const query = await vscode.window.showInputBox({
      title: 'Find a workspace file to mention',
      validateInput: value => value.trim() && value.length <= 250 ? null : 'Enter a file name or path up to 250 characters',
    });
    if (!query?.trim()) return;
    this.assertCurrent(rpc);
    const result = await rpc.request('fuzzyFileSearch', { query: query.trim(), roots: [root], cancellationToken: null });
    const candidates = list(result.files).slice(0, 100).filter(hit =>
      hit.match_type === 'file' && typeof hit.path === 'string' && typeof hit.root === 'string' && !path.relative(root, hit.root));
    const picked = await vscode.window.showQuickPick(candidates.map(hit => ({ label: clean(hit.path, 1000), entry: hit })), { title: 'Mention a workspace file' });
    if (!picked) return;
    const file = await realpath(path.resolve(root, picked.entry.path));
    if (!isInside(root, file) || !(await stat(file)).isFile()) throw Error('The selected file is outside the active workspace');
    this.assertCurrent(rpc);
    const name = path.relative(root, file);
    this.attachments.push({ id: randomUUID(), label: name, text: 'File ' + JSON.stringify(name) });
  }

  async changeSkill() {
    this.idle();
    const rpc = this.rpc;
    if (!this.inventory.length) await this.refreshInventory();
    const rows = this.inventory.find(group => group.name === 'Skills')?.rows || [];
    const pick = await vscode.window.showQuickPick(rows.map(row => ({ label: row.name, description: row.detail, row })), { title: 'Change native skill enablement' });
    if (!pick) return;
    const action = pick.row.enabled ? 'Disable' : 'Enable';
    const choice = await vscode.window.showWarningMessage(action + ' the native skill ' + pick.label + '?', {
      modal: true, detail: 'This updates the shared Codex skill setting.',
    }, action);
    if (choice !== action) return;
    this.assertCurrent(rpc);
    await rpc.request('skills/config/write', { path: pick.row.path, enabled: !pick.row.enabled });
    this.attachments = this.attachments.filter(row => row.input?.path !== pick.row.path);
    await this.refreshInventory();
  }

  async refreshInventory() {
    const rpc = this.rpc;
    const groups = await readInventory(rpc, this.workspace.cwd, this.readOnly ? null : this.state.threadId);
    this.assertCurrent(rpc);
    this.inventory = groups;
  }

  async pickCapability(type) {
    if (this.attachments.length >= 12) throw Error('A message can include up to 12 attachments');
    if (!this.inventory.length) await this.refreshInventory();
    const groupName = { pickSkill: 'Skills', pickPlugin: 'Plugins', appMention: 'Connected apps' }[type];
    const group = this.inventory.find(row => row.name === groupName);
    if (!group?.rows) throw Error('Native inventory unavailable');
    const rows = group.rows.filter(row => row.enabled);
    if (!rows.length) throw Error('No enabled entries are available');
    const pick = await vscode.window.showQuickPick(rows.map(row => ({ label: row.name, description: row.detail, row })), {
      title: 'Select from ' + groupName.toLowerCase(),
    });
    if (!pick) return;
    if (type === 'pickSkill') {
      this.attachments.push({ id: randomUUID(), label: pick.label, input: { type: 'skill', name: pick.row.name, path: pick.row.path } });
    } else if (type === 'appMention') {
      if (!/^[a-zA-Z0-9_.-]+$/.test(pick.row.id)) throw Error('Native app mention unavailable');
      this.attachments.push({
        id: randomUUID(), label: pick.label, text: '$' + pick.row.id,
        input: { type: 'mention', name: pick.row.name, path: 'app://' + pick.row.id },
      });
    } else {
      const skills = this.inventory.find(row => row.name === 'Skills')?.rows?.filter(row => row.enabled && row.pluginId === pick.row.id);
      const skill = await vscode.window.showQuickPick(list(skills).map(row => ({ label: row.name, row })), { title: 'Choose an enabled skill from ' + pick.label });
      if (skill) this.attachments.push({ id: randomUUID(), label: skill.label, input: { type: 'skill', name: skill.row.name, path: skill.row.path } });
      else if (!skills?.length) this.notice = 'The plugin exposes no enabled skill in this workspace. Its configured tools remain available to Codex.';
    }
  }

  async accountAction(type) {
    if (this.mode !== 'native') throw Error('Shared account actions are available only in native mode');
    const rpc = this.rpc;
    if (type === 'cancelLogin') {
      if (this.loginId) await rpc.request('account/login/cancel', { loginId: this.loginId });
      this.loginId = null;
      return;
    }
    this.idle();
    const action = type === 'logout' ? 'Sign out' : 'Continue';
    if (await vscode.window.showWarningMessage(type === 'logout' ? 'Sign out of shared native Codex?' : 'Sign in to shared native Codex?', {
      modal: true, detail: 'This changes the account used by other Codex clients that share the same native home.',
    }, action) !== action) return;
    this.assertCurrent(rpc);
    if (type === 'logout') {
      await rpc.request('account/logout');
      this.resetThread();
      this.history = [];
      this.historyCursor = null;
      this.quota = [];
      await this.refreshConnection(rpc);
      return;
    }
    const method = await vscode.window.showQuickPick([
      { label: 'Browser sign-in', value: 'chatgpt' }, { label: 'Device-code sign-in', value: 'chatgptDeviceCode' },
    ], { title: 'Native ChatGPT sign-in' });
    if (!method) return;
    const result = await rpc.request('account/login/start', { type: method.value });
    this.assertCurrent(rpc);
    this.loginId = result.loginId;
    const url = externalUrl(result.authUrl || result.verificationUrl, true);
    if (!url) {
      if (this.loginId) await rpc.request('account/login/cancel', { loginId: this.loginId });
      this.loginId = null;
      throw Error('Native Codex returned an unsupported sign-in URL');
    }
    if (result.type === 'chatgptDeviceCode') {
      const choice = await vscode.window.showInformationMessage('Native Codex device code', {
        modal: true, detail: 'Code ' + clean(result.userCode, 80) + '\n\n' + url.href,
      }, 'Open verification page');
      if (choice !== 'Open verification page') return;
    }
    if (!await vscode.env.openExternal(vscode.Uri.parse(url.href))) this.notice = 'Could not open the native sign-in page';
  }

  async mcp(type) {
    this.idle();
    const rpc = this.rpc;
    if (type === 'mcpReload') {
      await rpc.request('config/mcpServer/reload');
      return this.refreshInventory();
    }
    if (!this.inventory.length) await this.refreshInventory();
    const entries = this.inventory.find(group => group.name === 'MCP servers')?.rows || [];
    const pick = await vscode.window.showQuickPick(entries.map(row => ({ label: row.name, detail: row.detail })), { title: 'Choose an existing MCP server' });
    if (!pick) return;
    const confirmed = await vscode.window.showWarningMessage('Start native MCP authorization?', { modal: true, detail: pick.label + ' uses the shared Codex grants.' }, 'Authorize');
    if (confirmed !== 'Authorize') return;
    this.assertCurrent(rpc);
    const result = await rpc.request('mcpServer/oauth/login', { name: pick.label });
    const url = externalUrl(result.authorizationUrl, true);
    if (!url) throw Error('The native MCP authorization URL is unavailable');
    await vscode.env.openExternal(vscode.Uri.parse(url.href));
  }

  async revertHistory() {
    this.idle();
    if (this.readOnly || !this.state.threadId) return;
    const rpc = this.rpc;
    const turns = await rpc.request('thread/turns/list', { threadId: this.state.threadId, limit: 15, itemsView: 'summary', sortDirection: 'desc' });
    const chosen = await vscode.window.showQuickPick(list(turns.data).filter(isTerminal).map(turn => ({
      label: Number.isFinite(turn.startedAt) ? new Date(turn.startedAt * 1000).toLocaleString() : turn.id,
      description: turn.status, detail: turn.id, id: turn.id,
    })), { title: 'Remove this turn and following turns from conversation history' });
    if (!chosen) return;
    const confirmed = await vscode.window.showWarningMessage('Revert native conversation history?', {
      modal: true, detail: 'This removes the chosen turn and later turns from the shared conversation. Use Source Control separately to review file changes.',
    }, 'Revert history');
    if (confirmed !== 'Revert history') return;
    this.assertCurrent(rpc);
    const result = await rpc.request('thread/revert', { threadId: this.state.threadId, beforeTurnId: chosen.id });
    const thread = checkThread(result.thread, this.workspace.cwd, this.provider);
    this.resetThread();
    this.state.threadId = thread.id;
    this.selected = { ...brief(thread), model: thread.model, effort: thread.reasoningEffort };
    await this.loadItems(false);
  }

  async dispatch(message) {
    const type = message.type;
    switch (type) {
      case 'connect': return this.connect('native');
      case 'api': return this.connect('api');
      case 'setKey': return this.saveKey(false);
      case 'removeKey': return this.saveKey(true);
      case 'reconcile': return this.reconcile();
      case 'official': return vscode.commands.executeCommand('workbench.extensions.search', '@id:openai.chatgpt');
      case 'cloud': return vscode.env.openExternal(vscode.Uri.parse('https://chatgpt.com/codex'));
    }
    if (!this.ready) throw Error('Connect to the native runtime first');
    switch (type) {
      case 'changeFolder': {
        this.idle();
        const root = await this.workspaceRoot(true);
        if (root) return this.connect(this.mode, { root });
        return;
      }
      case 'enablePlan': {
        this.idle();
        if (await vscode.window.showWarningMessage('Enable experimental native Plan mode for this connection?', { modal: true }, 'Enable') !== 'Enable') return;
        return this.connect(this.mode, { experimental: true });
      }
      case 'new': this.idle(); return this.releaseThread();
      case 'send':
      case 'steer': return this.send(message);
      case 'stop': return this.interrupt();
      case 'inventory': return this.refreshInventory();
      case 'history': return this.refreshHistory(message.archived === true);
      case 'historyMore': return this.refreshHistory(this.archived, true);
      case 'older': return this.loadItems(true);
      case 'resume':
      case 'viewThread':
      case 'fork': return this.selectThread(message.id, type);
      case 'rename':
      case 'archive':
      case 'restore': return this.threadAction(type, message.id);
      case 'login':
      case 'cancelLogin':
      case 'logout': return this.accountAction(type);
      case 'attach':
      case 'attachEditor': return this.addAttachment(type);
      case 'pickSkill':
      case 'pickPlugin':
      case 'appMention': return this.pickCapability(type);
      case 'findFile': return this.findFile();
      case 'skillToggle': return this.changeSkill();
      case 'removeAttachment': this.attachments = this.attachments.filter(row => row.id !== message.id); return;
      case 'review': {
        this.idle();
        const target = await vscode.window.showQuickPick([
          { label: 'Uncommitted changes', type: 'uncommittedChanges' },
          { label: 'Changes against a branch', type: 'baseBranch' },
          { label: 'A specific commit', type: 'commit' },
          { label: 'Custom review scope', type: 'custom' },
        ], { title: 'Run a native Code Review' });
        if (!target) return;
        const property = { baseBranch: 'branch', commit: 'sha', custom: 'instructions' }[target.type];
        const value = property && await vscode.window.showInputBox({ title: target.label, validateInput: input => input.trim() && input.length <= 4000 ? null : 'Enter a review target' });
        if (property && !value) return;
        return this.runTurn(this.rpc, 'review/start', { delivery: 'inline', target: { type: target.type, ...(property ? { [property]: value.trim() } : {}), ...(target.type === 'commit' ? { title: null } : {}) } });
      }
      case 'compact':
        this.idle();
        if (this.mode === 'api') throw Error('Independent API mode requires a normal user turn for paid compaction');
        if (!this.state.threadId) throw Error('Open a conversation first');
        return this.runTurn(this.rpc, 'thread/compact/start', {});
      case 'diff': {
        if (!this.state.diff) throw Error('Codex has not supplied a turn diff');
        const document = await vscode.workspace.openTextDocument({ language: 'diff', content: this.state.diff });
        return vscode.window.showTextDocument(document, { preview: true });
      }
      case 'revertHistory': return this.revertHistory();
      case 'scm': return vscode.commands.executeCommand('workbench.view.scm');
      case 'mcpLogin':
      case 'mcpReload': return this.mcp(type);
      case 'worktree': {
        this.idle();
        if (this.mode === 'api') throw Error('Official worktree handoff uses the shared native account');
        const terminal = vscode.window.createTerminal({ name: 'Codex Worktree', shellPath: this.launch.executable, shellArgs: ['--worktree'], cwd: this.workspace.cwd });
        terminal.show();
        return;
      }
    }
  }

  async handle(message) {
    if (!message || typeof message !== 'object' || !ACTIONS.has(message.type) || !vscode.workspace.isTrusted) return;
    if (message.type === 'approve') return this.promptApproval(message.id);
    if (this.busy) return;
    this.busy = true;
    this.publish();
    try { await this.dispatch(message); }
    catch (error) {
      const reason = clean(error?.message, 2000);
      this.notice = this.state.status === 'unknown' && this.startMarker
        ? (reason || 'Codex operation failed') + ' · reconcile the previous turn' : reason || 'Codex operation failed';
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  foldersChanged() {
    this.workspaceEpoch++;
    if (!this.workspace || vscode.workspace.workspaceFolders?.some(folder => folder.uri.toString() === this.workspace.folder.uri.toString())) return;
    this.closeConnection();
    this.workspace = null;
    this.attachments = [];
    if (this.startMarker) this.state.status = 'unknown';
    else this.resetThread();
    this.notice = 'The active Codex workspace folder was removed';
    this.publish();
  }

  dispose() {
    clearTimeout(this.publishTimer);
    this.closeConnection();
  }
}

function activate(context) {
  const monitor = new Monitor(context);
  context.subscriptions.push(
    monitor,
    vscode.window.registerWebviewViewProvider('hpCodex.monitor', monitor, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => monitor.foldersChanged()),
    vscode.commands.registerCommand('hpCodex.attachEditor', () => monitor.handle({ type: 'attachEditor' })),
    vscode.commands.registerCommand('hpCodex.connect', () => monitor.handle({ type: 'connect' })),
  );
}

module.exports = { activate, Monitor };
