'use strict';

function renderHtml(csp, nonce, css, js) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp}; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'">
  <link rel="stylesheet" href="${css}">
  <title>HP Codex</title>
</head>
<body>
  <header class="masthead">
    <div class="titleLine"><span class="signal" id="signal"></span><strong id="connection">Connecting</strong><span id="elapsed" class="elapsed"></span></div>
    <div class="runtime"><span id="account">Existing Codex</span><span id="model">Model unavailable</span><span id="provider"></span></div>
    <nav aria-label="Views" class="tabs">
      <button data-tab="conversation" aria-pressed="true">Conversation</button>
      <button data-tab="execution" aria-pressed="false">Execution</button>
      <button data-tab="history" aria-pressed="false">History</button>
      <button data-tab="settings" aria-pressed="false">Settings</button>
    </nav>
  </header>
  <div class="notice" id="notice" role="status"></div>
  <aside class="attention" id="attention" hidden><span id="attentionText"></span><button id="attentionAction"></button></aside>
  <main id="scroll">
    <section id="conversation" aria-label="Conversation">
      <div class="sectionLine"><h1 id="threadTitle">New conversation</h1><button data-action="new" class="quiet">New</button></div>
      <div class="blank" id="welcome">
        <h2>Work with Codex</h2>
        <p>Send a task in the selected workspace or continue a native conversation from History.</p>
        <button data-action="connect" class="primary">Connect existing Codex</button>
      </div>
      <button id="older" data-action="older" class="quiet" hidden>Load earlier messages</button>
      <p class="secondary" id="readOnly" hidden>Read-only history. Resume this conversation to send a message.</p>
      <div id="chat"></div>
      <div id="turnError" class="error" role="status" hidden></div>
    </section>
    <section id="execution" aria-label="Execution" hidden>
      <div class="sectionLine"><h1>Execution</h1><span id="taskStatus" class="tag">Idle</span></div>
      <section class="block">
        <div class="sectionLine"><h2>Token usage</h2><span class="tag" id="usageScope">Conversation</span></div>
        <dl id="metrics" class="metrics"></dl>
        <canvas id="graph" height="38" aria-label="Most recent reported token increments" role="img" hidden></canvas>
        <details class="expandable" id="billing"><summary>Context and billing</summary><dl id="quota" class="list"></dl></details>
      </section>
      <section class="block">
        <div class="sectionLine"><h2>Plan</h2><span id="progressText" class="mono"></span></div>
        <progress id="planProgress" aria-label="Plan progress" max="1" value="0" hidden></progress>
        <p id="explanation" class="secondary"></p>
        <ol id="plan"></ol>
      </section>
      <section class="block" id="agentsBlock">
        <div class="sectionLine"><h2>Agents</h2><span id="agentCount" class="mono"></span></div>
        <div id="agents"></div>
      </section>
      <section class="block">
        <div class="sectionLine"><h2>Activity</h2><button data-action="diff" class="quiet">Open diff</button></div>
        <input id="filter" type="search" aria-label="Filter activity" placeholder="Filter activity">
        <p id="emptyActivity" class="secondary">Native activity will appear here.</p>
        <div id="activity"></div>
      </section>
    </section>
    <section id="history" aria-label="History" hidden>
      <div class="sectionLine"><h1>History</h1><button data-action="history" class="quiet">Refresh</button></div>
      <label class="check"><input id="archived" type="checkbox"> Archived conversations</label>
      <p id="emptyHistory" class="secondary"></p>
      <div id="historyRows"></div>
      <button data-action="historyMore" class="quiet" hidden>Load more conversations</button>
    </section>
    <section id="settings" aria-label="Settings" hidden>
      <div class="sectionLine"><h1>Settings</h1><span id="version" class="tag"></span></div>
      <section class="block"><h2>Connection</h2><dl class="list"><dt>Workspace</dt><dd id="workspace"></dd><dt>Billing mode</dt><dd id="billingMode"></dd></dl>
        <div class="actions"><button data-action="connect">Connect existing Codex</button><button data-action="changeFolder">Choose folder</button></div>
        <div class="actions"><button data-action="login">Sign in to shared account</button><button data-action="cancelLogin" hidden>Cancel sign-in</button><button data-action="logout">Sign out</button></div>
      </section>
      <section class="block"><h2>Independent API key</h2><p id="keyStatus" class="secondary"></p>
        <div class="actions"><button data-action="setKey">Save or replace key</button><button data-action="removeKey">Remove key</button><button data-action="api">Connect API mode</button></div>
      </section>
      <section class="block"><h2>Effective native settings</h2><dl class="list" id="config"></dl>
        <div class="actions"><button data-action="enablePlan">Enable experimental Plan mode</button></div>
      </section>
      <section class="block">
        <div class="sectionLine"><h2>Native integrations</h2><button data-action="inventory" class="quiet">Refresh</button></div>
        <p id="inventoryEmpty" class="secondary"></p>
        <div id="inventory"></div>
        <div class="actions"><button data-action="mcpReload">Reload MCP config</button><button data-action="mcpLogin">Authorize MCP server</button><button data-action="skillToggle">Change skill enablement</button></div>
      </section>
      <section class="block"><h2>Workspace actions</h2>
        <div class="actions"><button data-action="scm">Source Control</button><button data-action="worktree">Create worktree in Codex CLI</button><button data-action="revertHistory">Revert thread history</button></div>
      </section>
      <section class="block"><h2>Official clients</h2><p class="secondary">Cloud tasks, Remote Control, scheduled work, and embedded app interfaces open in the official clients.</p><div class="actions"><button data-action="official">Official VS Code extension</button><button data-action="cloud">Open Codex Cloud</button></div></section>
    </section>
  </main>
  <footer id="composer">
    <div id="attachments" class="attachments" hidden></div>
    <textarea id="prompt" aria-label="Message to Codex" placeholder="Message Codex · / for commands" rows="3" maxlength="50000" aria-describedby="composerHelp"></textarea>
    <div id="slash" class="slash" hidden aria-label="Conversation commands"></div>
    <div class="composeOptions">
      <label><span class="sr">Model</span><select id="pickModel"></select></label>
      <label><span class="sr">Reasoning effort</span><select id="pickEffort"></select></label>
      <label id="modeSelect" hidden><span class="sr">Collaboration mode</span><select id="pickMode"></select></label>
    </div>
    <div class="composeActions">
      <div class="actions"><button data-action="attach" title="Attach a file or image">Attach</button><button data-action="attachEditor" title="Add the active editor or selection">Editor</button><button data-action="findFile" title="Find a workspace file to mention">Mention file</button><button data-action="pickSkill">Skill</button><button data-action="pickPlugin">Plugin</button><button data-action="appMention">App</button></div>
      <div class="actions"><button data-action="stop" hidden>Stop</button><button data-action="steer" hidden class="primary">Steer</button><button data-action="send" class="primary">Send</button></div>
    </div>
    <span class="sr" id="composerHelp">Command or Control plus Enter to send. Shift plus Enter adds a line.</span>
  </footer>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
}

module.exports = { renderHtml };
