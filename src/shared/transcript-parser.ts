import type { WorkStatusState } from './types';

export interface ParsedTranscriptStatus {
  state: WorkStatusState | null;
  task: string | null;
  timestampMs: number;
}

/**
 * Parse the tail of an Antigravity `transcript.jsonl` file and infer the agent's current activity.
 * Pure function with zero VS Code dependency so it can be unit-tested directly.
 */
export function parseTranscriptTailLines(jsonlText: string): ParsedTranscriptStatus | null {
  const lines = jsonlText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  for (let i = lines.length - 1; i >= 0; i--) {
    let step: Record<string, unknown>;
    try {
      step = JSON.parse(lines[i]) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = String(step.type || '');
    const status = String(step.status || '');
    const createdAt = typeof step.created_at === 'string' ? Date.parse(step.created_at) : Number.NaN;
    const timestampMs = Number.isFinite(createdAt) ? createdAt : Date.now();
    const content = typeof step.content === 'string' ? step.content : '';
    const toolCalls = Array.isArray(step.tool_calls) ? (step.tool_calls as Array<Record<string, unknown>>) : [];

    if (type === 'USER_INPUT') {
      const preview = content.replace(/\s+/g, ' ').slice(0, 24);
      return {
        state: 'thinking',
        task: preview ? `思考中：${preview}${content.length > 24 ? '…' : ''}` : '正在理解主人指令',
        timestampMs,
      };
    }

    if (type === 'PLANNER_RESPONSE') {
      if (status === 'ERROR') {
        return {
          state: 'error',
          task: 'Agent 执行遇到异常',
          timestampMs,
        };
      }

      if (toolCalls.length > 0) {
        const lastCall = toolCalls[toolCalls.length - 1];
        const name = String(lastCall?.name || lastCall?.tool_name || '');
        if (name === 'ask_question' || name === 'request_review') {
          return {
            state: 'waiting',
            task: '正在等待主人答复确认',
            timestampMs,
          };
        }
        if (status !== 'DONE') {
          return {
            state: 'working',
            task: name ? `正在调用 ${name}` : '正在执行工具调用',
            timestampMs,
          };
        }
        return {
          state: 'result',
          task: name ? `刚完成 ${name}` : '工具调用已完成，整理中',
          timestampMs,
        };
      }

      if (status === 'DONE') {
        return {
          state: 'success',
          task: '本轮回复已完成',
          timestampMs,
        };
      }

      return {
        state: 'thinking',
        task: '正在思考推演中',
        timestampMs,
      };
    }
  }

  return null;
}
