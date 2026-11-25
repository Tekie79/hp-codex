import type { ClientRequest } from '../../protocol/0.155.1/ClientRequest';
import type { CommandExecutionRequestApprovalResponse } from '../../protocol/0.155.1/v2/CommandExecutionRequestApprovalResponse';
import type { ToolRequestUserInputResponse } from '../../protocol/0.155.1/v2/ToolRequestUserInputResponse';

const requests = [
  { id: 1, method: 'initialize', params: {
    clientInfo: { name: 'hp_codex', title: 'HP Codex', version: '0.1.0' },
    capabilities: { experimentalApi: false, requestAttestation: false, optOutNotificationMethods: ['item/reasoning/textDelta'] },
  } },
  { id: 2, method: 'thread/start', params: { cwd: '/workspace' } },
  { id: 3, method: 'thread/list', params: { cwd: '/workspace', modelProviders: ['openai'], sortKey: 'updated_at' } },
  { id: 4, method: 'turn/start', params: {
    threadId: 'thread', clientUserMessageId: 'client',
    input: [{ type: 'text', text: 'Summarize this', text_elements: [] }, { type: 'localImage', path: '/workspace/test.png' }],
    collaborationMode: { mode: 'plan', settings: { model: 'fixture', reasoning_effort: 'medium', developer_instructions: null } },
  } },
  { id: 5, method: 'turn/steer', params: { threadId: 'thread', expectedTurnId: 'turn', input: [] } },
  { id: 6, method: 'thread/items/list', params: { threadId: 'thread', limit: 30, sortDirection: 'desc' } },
  { id: 7, method: 'review/start', params: { threadId: 'thread', target: { type: 'uncommittedChanges' } } },
  { id: 8, method: 'collaborationMode/list', params: {} },
] satisfies ClientRequest[];

const decision: CommandExecutionRequestApprovalResponse = { decision: 'decline' };
const answer: ToolRequestUserInputResponse = { answers: { field: { answers: ['yes'] } } };
export { requests, decision, answer };
