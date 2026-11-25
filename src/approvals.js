'use strict';

const path = require('node:path');
const { clean } = require('./state');

const cancel = Object.freeze({ action: 'cancel', content: null, _meta: null });
const decline = Object.freeze({ action: 'decline', content: null, _meta: null });
const permissionDenial = Object.freeze({ permissions: {}, scope: 'turn' });
const labels = {
  accept: 'Approve once', acceptForSession: 'Approve for this session', decline: 'Deny', cancel: 'Cancel request',
  acceptWithExecpolicyAmendment: 'Approve and save command rule',
  applyNetworkPolicyAmendment: 'Apply network policy change',
};

function exactJson(value) {
  const result = JSON.stringify(value, null, 2);
  if (result?.length > 16_000) throw Error('Native approval is too large to display in full');
  return result;
}

function choices(params) {
  if (!Array.isArray(params.availableDecisions)) {
    return ['accept', 'decline', 'cancel'].map(value => ({ label: labels[value], value }));
  }
  return params.availableDecisions.slice(0, 16).map(value => {
    const key = typeof value === 'string' ? value : Object.keys(value || {})[0];
    if (!Object.hasOwn(labels, key)) return null;
    const amendment = typeof value === 'object' ? exactJson(value) : undefined;
    return { label: labels[key], detail: amendment, value };
  }).filter(Boolean);
}

async function approval(vscode, request, context) {
  const params = request.params;
  const { token, stillPending, patch } = context;
  const check = () => stillPending() && !token.isCancellationRequested;
  const pick = (items, title) => vscode.window.showQuickPick(items, { title, ignoreFocusOut: true, matchOnDetail: true }, token);
  switch (request.method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval': {
      const file = request.method === 'item/fileChange/requestApproval';
      if (!file && !params.command && !params.networkApprovalContext) return { decision: 'cancel' };
      const action = file ? patch() : {
        kind: params.kind, command: params.command, cwd: params.cwd, network: params.networkApprovalContext,
        additionalPermissions: params.additionalPermissions, environment: params.environmentId,
      };
      if (file && !action) return { decision: 'cancel' };
      const title = file ? 'Review native file changes' : params.networkApprovalContext ? 'Review native network request' : 'Review native command';
      // Full native details are visible in the active modal at the point of confirmation.
      const detail = exactJson({ request: action, reason: params.reason, grantRoot: params.grantRoot });
      const options = file ? ['accept', 'acceptForSession', 'decline', 'cancel'].map(value => ({ label: labels[value], value })) : choices(params);
      const selection = await pick(options, title);
      if (!check() || !selection) return { decision: 'cancel' };
      if (['cancel', 'decline'].includes(selection.value)) return { decision: selection.value };
      const confirmed = await vscode.window.showWarningMessage(title, {
        modal: true, detail: detail + (selection.detail ? '\n' + selection.detail : ''),
      }, selection.label);
      return { decision: check() && confirmed === selection.label ? selection.value : 'cancel' };
    }
    case 'item/permissions/requestApproval': {
      const permissions = params.permissions;
      if (!permissions || typeof permissions !== 'object') return permissionDenial;
      const detail = exactJson({ cwd: params.cwd, reason: params.reason, permissions });
      const selection = await vscode.window.showWarningMessage('Grant the requested native Codex permissions?', { modal: true, detail },
        'Grant for this turn', 'Grant for this session');
      if (!check() || !selection) return permissionDenial;
      return {
        permissions: Object.fromEntries(['network', 'fileSystem'].filter(key => permissions[key] != null).map(key => [key, permissions[key]])),
        scope: selection === 'Grant for this turn' ? 'turn' : 'session',
      };
    }
    case 'item/tool/requestUserInput': {
      if (!Array.isArray(params.questions) || params.questions.length > 10) return null;
      const answers = Object.create(null);
      for (const question of params.questions) {
        if (!check() || typeof question.id !== 'string' || typeof question.question !== 'string') return { answers: {} };
        const title = clean(question.header, 160) || 'Codex question';
        const prompt = clean(question.question, 4000);
        let answer;
        if (question.options?.length && !question.isSecret) {
          const options = question.options.slice(0, 20).map(option => ({ label: option.label, detail: option.description, value: option.label }));
          if (question.isOther) options.push({ label: 'Enter your own answer', value: null });
          const selected = await pick(options.map(option => ({ ...option, description: prompt })), title);
          if (!selected) return { answers: {} };
          answer = selected.value;
        }
        if (answer == null) answer = await vscode.window.showInputBox({ title, prompt, password: question.isSecret === true, ignoreFocusOut: true }, token);
        if (!check() || answer === undefined || answer.length > 8192) return { answers: {} };
        answers[question.id] = { answers: [answer] };
      }
      return { answers };
    }
    case 'mcpServer/elicitation/request': {
      const title = 'MCP request from ' + clean(params.serverName, 160);
      const detail = clean(params.message, 6000);
      if (params.mode === 'url') {
        const url = externalUrl(params.url);
        if (!url) return decline;
        const confirmed = await vscode.window.showWarningMessage(title, { modal: true, detail: detail + '\n' + url.href }, 'Open link', 'Deny');
        if (confirmed === 'Deny') return decline;
        if (!check() || confirmed !== 'Open link') return cancel;
        return await vscode.env.openExternal(vscode.Uri.parse(url.href)) ? { action: 'accept', content: null, _meta: null } : cancel;
      }
      if (params.mode !== 'form') return null;
      const fields = formFields(params.requestedSchema);
      if (!fields) return null;
      const confirmed = await vscode.window.showWarningMessage(title, { modal: true, detail }, 'Review form', 'Deny');
      if (confirmed === 'Deny') return decline;
      if (!check() || confirmed !== 'Review form') return cancel;
      const content = Object.create(null);
      for (const field of fields) {
        if (!check()) return cancel;
        const result = await inputField(vscode, field, token, pick);
        if (!check() || !result) return cancel;
        if (!result.skip) content[field.name] = result.value;
      }
      return { action: 'accept', content, _meta: null };
    }
    default: return null;
  }
}

function externalUrl(raw, allowLoopback = false) {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    if (url.protocol === 'https:') return url;
    if (allowLoopback && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url;
  } catch { /* Reject invalid URLs. */ }
  return null;
}

function formFields(schema) {
  if (schema?.type !== 'object' || !schema.properties || typeof schema.properties !== 'object') return null;
  const fields = Object.entries(schema.properties);
  const required = new Set(schema.required || []);
  if (fields.length > 20 || [...required].some(key => !Object.hasOwn(schema.properties, key))) return null;
  if (fields.some(([, field]) => !['string', 'boolean', 'integer', 'number'].includes(field?.type)
    || Object.keys(field).some(key => !['type', 'title', 'description', 'default', 'enum', 'enumNames', 'oneOf', 'minimum',
      'maximum', 'minLength', 'maxLength', 'format'].includes(key))
    || (field.format && !['email', 'uri', 'date', 'date-time'].includes(field.format)))) return null;
  return fields.map(([name, field]) => ({ ...field, name, required: required.has(name) }));
}

async function inputField(vscode, field, token, pick) {
  const title = clean(field.title || field.name, 160);
  const description = clean(field.description, 2000);
  const values = field.enum?.map((value, index) => ({ label: field.enumNames?.[index] ?? value, value }))
    ?? field.oneOf?.map(option => ({ label: option.title ?? option.const, value: option.const }))
    ?? (field.type === 'boolean' ? [{ label: 'Yes', value: true }, { label: 'No', value: false }] : null);
  if (values) {
    const items = values.map(option => ({ ...option, label: String(option.label), detail: description }));
    if (!field.required) items.push({ label: 'Skip optional field', detail: description, skip: true });
    return pick(items, title);
  }
  if (!field.required) {
    const choice = await pick([{ label: 'Enter value' }, { label: 'Skip optional field', skip: true }], title);
    if (!choice || choice.skip) return choice;
  }
  const validateInput = value => {
    if (field.type === 'string') {
      if (value.length > 8192 || value.length < (field.minLength ?? 0) || value.length > (field.maxLength ?? Infinity)) return 'Value has an invalid length';
      if (field.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter an email address';
      if (field.format === 'uri' && !URL.canParse(value)) return 'Enter an absolute URI';
      if (field.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))) return 'Enter a date in YYYY-MM-DD format';
      if (field.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))) return 'Enter an ISO date and time';
      return null;
    }
    const number = Number(value);
    return !value.trim() || !Number.isFinite(number) || (field.type === 'integer' && !Number.isSafeInteger(number))
      || number < (field.minimum ?? -Infinity) || number > (field.maximum ?? Infinity) ? 'Enter a number within the requested range' : null;
  };
  const value = await vscode.window.showInputBox({
    title, prompt: description, value: field.default === undefined ? undefined : String(field.default), validateInput, ignoreFocusOut: true,
  }, token);
  return value === undefined || validateInput(value) ? null : { value: field.type === 'string' ? value : Number(value) };
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

module.exports = { approval, externalUrl, formFields, isInside };
