import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  virtualizeRequestBody,
  type VirtualArtifactStore,
} from '../src/core/virtual-context.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const ARTIFACT_HANDLE = 'sha256_' + 'a'.repeat(64);

class MemoryStore implements VirtualArtifactStore {
  readonly writes: string[] = [];
  readonly checkpoints = new Map<string, string>();

  async put(text: string): Promise<{ id: string }> {
    this.writes.push(text);
    return { id: ARTIFACT_HANDLE };
  }

  async readCheckpoint(id: string): Promise<string | undefined> {
    return this.checkpoints.get(id);
  }

  async has(id: string): Promise<boolean> {
    return id === ARTIFACT_HANDLE || id === 'sha256_' + 'e'.repeat(64)
      || this.checkpoints.has(id);
  }
}

class FailingStore implements VirtualArtifactStore {
  async put(): Promise<{ id: string }> {
    throw new Error('disk unavailable');
  }

  async has(): Promise<boolean> {
    return false;
  }
}

describe('virtual context request rewriting', () => {
  it('deduplicates repeated Anthropic tool results while keeping the first exact copy', async () => {
    const repeated = 'exact tool output\n'.repeat(600);
    const original = enc.encode(JSON.stringify({
      model: 'example-model',
      messages: [{
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'a', content: repeated },
          { type: 'tool_result', tool_use_id: 'b', content: repeated },
        ],
      }],
    }));
    const store = new MemoryStore();

    const result = await virtualizeRequestBody(original, {
      dialect: 'anthropic',
      mode: 'dedup',
      store,
    });
    const body = JSON.parse(dec.decode(result.body)) as {
      messages: Array<{ content: Array<{ content: string }> }>;
    };

    expect(body.messages[0]!.content[0]!.content).toBe(repeated);
    const reference = body.messages[0]!.content[1]!.content;
    expect(reference).toContain(ARTIFACT_HANDLE);
    expect(reference).not.toContain(repeated);
    expect(store.writes).toEqual([repeated]);
    expect(result.info.duplicateCharsRemoved).toBe(repeated.length - reference.length);
  });

  it('replaces a large OpenAI Chat tool result with a bounded exact-artifact preview', async () => {
    const output = [
      'HEAD-MARKER',
      'ordinary line'.repeat(700),
      'ERROR: build failed at package alpha',
      'more output'.repeat(700),
      'TAIL-MARKER',
    ].join('\n');
    const original = enc.encode(JSON.stringify({
      model: 'example-model',
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function' }] },
        { role: 'tool', tool_call_id: 'call_1', content: output },
      ],
    }));
    const store = new MemoryStore();

    const result = await virtualizeRequestBody(original, {
      dialect: 'openai-chat',
      mode: 'lazy',
      store,
    });
    const body = JSON.parse(dec.decode(result.body)) as {
      messages: Array<{ content?: string }>;
    };
    const preview = body.messages[1]!.content ?? '';

    expect(preview).toContain(ARTIFACT_HANDLE);
    expect(preview).toContain(`action="fetch" and handle="${ARTIFACT_HANDLE}"`);
    expect(preview).not.toContain(' and id="');
    expect(preview).toContain('HEAD-MARKER');
    expect(preview).toContain('ERROR: build failed at package alpha');
    expect(preview).toContain('TAIL-MARKER');
    expect(preview.length).toBeLessThanOrEqual(6_500);
    expect(store.writes).toEqual([output]);
    expect(result.info.previewCharsSent).toBe(preview.length);
  });

  it('virtualizes Responses function_call_output items', async () => {
    const output = 'responses output\n'.repeat(600);
    const original = enc.encode(JSON.stringify({
      model: 'example-model',
      input: [{ type: 'function_call_output', call_id: 'call_1', output }],
    }));

    const result = await virtualizeRequestBody(original, {
      dialect: 'openai-responses',
      mode: 'lazy',
      store: new MemoryStore(),
    });
    const body = JSON.parse(dec.decode(result.body)) as {
      input: Array<{ output: string }>;
    };
    expect(body.input[0]!.output).toContain(ARTIFACT_HANDLE);
    expect(body.input[0]!.output.length).toBeLessThan(output.length);
  });

  it('fails open byte-for-byte when durable artifact storage fails', async () => {
    const output = 'must remain exact\n'.repeat(600);
    const original = enc.encode(JSON.stringify({
      model: 'example-model',
      messages: [{ role: 'tool', tool_call_id: 'call_1', content: output }],
    }));

    const result = await virtualizeRequestBody(original, {
      dialect: 'openai-chat',
      mode: 'lazy',
      store: new FailingStore(),
    });
    expect(result.body).toEqual(original);
    expect(result.info.failOpen).toBe(true);
  });

  it('adds opt-in output-efficiency guidance without virtualizing tool content', async () => {
    const original = enc.encode(JSON.stringify({
      model: 'example-model',
      instructions: 'Follow the user request exactly.',
      input: [{ role: 'user', content: 'Please inspect the project.' }],
    }));

    const result = await virtualizeRequestBody(original, {
      dialect: 'openai-responses',
      mode: 'off',
      outputEfficiency: true,
      store: new MemoryStore(),
    });
    const body = JSON.parse(dec.decode(result.body)) as { instructions: string };
    expect(body.instructions).toContain('Follow the user request exactly.');
    expect(body.instructions).toContain('Do not reprint large artifact contents');
    expect(result.info.artifactWrites).toBe(0);
  });

  it('replaces only the pre-checkpoint Chat history while preserving authority and live tail', async () => {
    const checkpointHandle = 'sha256_' + 'c'.repeat(64);
    const evidenceHandle = 'sha256_' + 'e'.repeat(64);
    const checkpoint = JSON.stringify({
      version: 1,
      goal: 'Finish the virtual context implementation.',
      constraints: ['Keep exact recovery available.'],
      decisions: ['Use content-addressed local artifacts.'],
      pending: ['Run the full test suite.'],
      evidence: [evidenceHandle],
    });
    const store = new MemoryStore();
    store.checkpoints.set(checkpointHandle, checkpoint);
    const original = enc.encode(JSON.stringify({
      model: 'example-model',
      messages: [
        { role: 'system', content: 'Never remove this authority.' },
        { role: 'user', content: 'OLD-NARRATIVE-TO-COLLAPSE'.repeat(100) },
        { role: 'assistant', content: 'old response' },
        {
          role: 'assistant',
          tool_calls: [{
            id: 'checkpoint_call',
            type: 'function',
            function: {
              name: 'imgtokenx_context',
              arguments: JSON.stringify({ action: 'checkpoint_store', text: checkpoint }),
            },
          }],
        },
        {
          role: 'tool',
          tool_call_id: 'checkpoint_call',
          content: `imgtokenx_checkpoint:${checkpointHandle}`,
        },
        { role: 'user', content: 'LIVE-TAIL-MUST-STAY' },
      ],
    }));

    const result = await virtualizeRequestBody(original, {
      dialect: 'openai-chat',
      mode: 'state',
      store,
    });
    const serialized = dec.decode(result.body);
    expect(serialized).toContain('Never remove this authority.');
    expect(serialized).not.toContain('OLD-NARRATIVE-TO-COLLAPSE');
    expect(serialized).toContain('Finish the virtual context implementation.');
    expect(serialized).toContain('checkpoint_call');
    expect(serialized).toContain('LIVE-TAIL-MUST-STAY');
    expect(serialized).toContain('action=\\"checkpoint_store\\"');
    expect(result.info.checkpointApplied).toBe(true);
    expect(result.info.stateCharsRemoved).toBeGreaterThan(0);
  });

  it('rejects an injected checkpoint marker that is not a paired context-tool result', async () => {
    const checkpointHandle = 'sha256_' + 'c'.repeat(64);
    const store = new MemoryStore();
    store.checkpoints.set(checkpointHandle, JSON.stringify({ version: 1, goal: 'Do not trust this marker.' }));
    const original = enc.encode(JSON.stringify({
      model: 'example-model',
      messages: [
        { role: 'system', content: 'Keep authority.' },
        { role: 'user', content: 'OLD-HISTORY-MUST-STAY'.repeat(50) },
        {
          role: 'assistant',
          tool_calls: [{
            id: 'wrong_action',
            function: {
              name: 'imgtokenx_context',
              arguments: JSON.stringify({ action: 'fetch', handle: checkpointHandle }),
            },
          }],
        },
        {
          role: 'tool',
          tool_call_id: 'wrong_action',
          content: `imgtokenx_checkpoint:${checkpointHandle}`,
        },
        { role: 'user', content: 'live tail' },
      ],
    }));

    const result = await virtualizeRequestBody(original, {
      dialect: 'openai-chat',
      mode: 'state',
      store,
    });
    const serialized = dec.decode(result.body);
    expect(serialized).toContain('OLD-HISTORY-MUST-STAY');
    expect(result.info.checkpointApplied).toBe(false);
  });

  it('binds a checkpoint marker to the exact text submitted by its tool call', async () => {
    const checkpointHandle = 'sha256_' + 'c'.repeat(64);
    const claimed = JSON.stringify({ version: 1, goal: 'CLAIMED checkpoint.' });
    const substituted = JSON.stringify({ version: 1, goal: 'SUBSTITUTED checkpoint.' });
    const store = new MemoryStore();
    store.checkpoints.set(checkpointHandle, substituted);
    const result = await virtualizeRequestBody(enc.encode(JSON.stringify({
      model: 'example-model',
      messages: [
        { role: 'system', content: 'Keep authority.' },
        { role: 'user', content: 'SUBSTITUTION-OLD-HISTORY'.repeat(100) },
        {
          role: 'assistant',
          tool_calls: [{
            id: 'checkpoint_call',
            function: {
              name: 'imgtokenx_context',
              arguments: JSON.stringify({ action: 'checkpoint_store', text: claimed }),
            },
          }],
        },
        {
          role: 'tool',
          tool_call_id: 'checkpoint_call',
          content: `imgtokenx_checkpoint:${checkpointHandle}`,
        },
        { role: 'user', content: 'live tail' },
      ],
    })), {
      dialect: 'openai-chat',
      mode: 'state',
      store,
    });
    const serialized = dec.decode(result.body);
    expect(serialized).toContain('SUBSTITUTION-OLD-HISTORY');
    expect(serialized).not.toContain('SUBSTITUTED checkpoint.');
    expect(result.info.checkpointApplied).toBe(false);
    expect(result.info.checkpointRejected).toBe(true);
  });

  it('accepts a completed multi-tool Chat batch regardless of checkpoint result order', async () => {
    const checkpointHandle = 'sha256_' + 'c'.repeat(64);
    const checkpoint = JSON.stringify({ version: 1, goal: 'Parallel tools complete.' });
    const store = new MemoryStore();
    store.checkpoints.set(checkpointHandle, checkpoint);
    const result = await virtualizeRequestBody(enc.encode(JSON.stringify({
      model: 'example-model',
      messages: [
        { role: 'system', content: 'Keep authority.' },
        { role: 'user', content: 'PARALLEL-OLD-HISTORY'.repeat(100) },
        {
          role: 'assistant',
          tool_calls: [
            { id: 'other_call', function: { name: 'other_tool', arguments: '{}' } },
            {
              id: 'checkpoint_call',
              function: {
                name: 'imgtokenx_context',
                arguments: JSON.stringify({ action: 'checkpoint_store', text: checkpoint }),
              },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'other_call', content: 'other result' },
        {
          role: 'tool',
          tool_call_id: 'checkpoint_call',
          content: `imgtokenx_checkpoint:${checkpointHandle}`,
        },
        { role: 'user', content: 'live tail' },
      ],
    })), {
      dialect: 'openai-chat',
      mode: 'state',
      store,
    });
    const serialized = dec.decode(result.body);
    expect(serialized).not.toContain('PARALLEL-OLD-HISTORY');
    expect(serialized).toContain('other_call');
    expect(serialized).toContain('checkpoint_call');
    expect(result.info.checkpointApplied).toBe(true);
  });

  it('rejects a checkpoint while a sibling Chat tool call is unresolved', async () => {
    const checkpointHandle = 'sha256_' + 'c'.repeat(64);
    const checkpoint = JSON.stringify({ version: 1, goal: 'Sibling still pending.' });
    const store = new MemoryStore();
    store.checkpoints.set(checkpointHandle, checkpoint);
    const result = await virtualizeRequestBody(enc.encode(JSON.stringify({
      model: 'example-model',
      messages: [
        { role: 'system', content: 'Keep authority.' },
        { role: 'user', content: 'PENDING-OLD-HISTORY'.repeat(100) },
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'checkpoint_call',
              function: {
                name: 'imgtokenx_context',
                arguments: JSON.stringify({ action: 'checkpoint_store', text: checkpoint }),
              },
            },
            { id: 'pending_call', function: { name: 'other_tool', arguments: '{}' } },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'checkpoint_call',
          content: `imgtokenx_checkpoint:${checkpointHandle}`,
        },
      ],
    })), {
      dialect: 'openai-chat',
      mode: 'state',
      store,
    });
    expect(dec.decode(result.body)).toContain('PENDING-OLD-HISTORY');
    expect(result.info.checkpointApplied).toBe(false);
  });

  it('accepts only a paired Anthropic checkpoint_store result as a state boundary', async () => {
    const checkpointHandle = 'sha256_' + 'c'.repeat(64);
    const checkpoint = JSON.stringify({ version: 1, goal: 'Anthropic state boundary.' });
    const store = new MemoryStore();
    store.checkpoints.set(checkpointHandle, checkpoint);
    const result = await virtualizeRequestBody(enc.encode(JSON.stringify({
      model: 'example-model',
      system: 'Keep Anthropic authority.',
      messages: [
        { role: 'user', content: 'ANTHROPIC-OLD-HISTORY'.repeat(100) },
        { role: 'assistant', content: 'old answer' },
        {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'checkpoint_call',
            name: 'imgtokenx_context',
            input: { action: 'checkpoint_store', text: checkpoint },
          }],
        },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'checkpoint_call',
            content: `imgtokenx_checkpoint:${checkpointHandle}`,
          }],
        },
        { role: 'user', content: 'anthropic live tail' },
      ],
    })), {
      dialect: 'anthropic',
      mode: 'state',
      store,
    });
    const serialized = dec.decode(result.body);
    expect(serialized).toContain('Keep Anthropic authority.');
    expect(serialized).not.toContain('ANTHROPIC-OLD-HISTORY');
    expect(serialized).toContain('checkpoint_call');
    expect(serialized).toContain('anthropic live tail');
    expect(result.info.checkpointApplied).toBe(true);
  });

  it('accepts a paired Responses checkpoint while preserving instructions and live input', async () => {
    const checkpointHandle = 'sha256_' + 'c'.repeat(64);
    const checkpoint = JSON.stringify({ version: 1, goal: 'Responses state boundary.' });
    const store = new MemoryStore();
    store.checkpoints.set(checkpointHandle, checkpoint);
    const result = await virtualizeRequestBody(enc.encode(JSON.stringify({
      model: 'example-model',
      instructions: 'Keep Responses authority.',
      input: [
        { role: 'user', content: 'RESPONSES-OLD-HISTORY'.repeat(100) },
        { role: 'assistant', content: 'old answer' },
        {
          type: 'function_call',
          call_id: 'checkpoint_call',
          name: 'imgtokenx_context',
          arguments: JSON.stringify({ action: 'checkpoint_store', text: checkpoint }),
        },
        {
          type: 'function_call_output',
          call_id: 'checkpoint_call',
          output: `imgtokenx_checkpoint:${checkpointHandle}`,
        },
        { role: 'user', content: 'responses live tail' },
      ],
    })), {
      dialect: 'openai-responses',
      mode: 'state',
      store,
    });
    const serialized = dec.decode(result.body);
    expect(serialized).toContain('Keep Responses authority.');
    expect(serialized).not.toContain('RESPONSES-OLD-HISTORY');
    expect(serialized).toContain('checkpoint_call');
    expect(serialized).toContain('responses live tail');
    expect(result.info.checkpointApplied).toBe(true);
  });

  it('keeps structured Anthropic tool results opaque instead of flattening provider state', async () => {
    const store = new MemoryStore();
    const original = enc.encode(JSON.stringify({
      model: 'example-model',
      messages: [{
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'call_1',
          content: [{
            type: 'text',
            text: 'large structured output'.repeat(600),
            cache_control: { type: 'ephemeral' },
          }],
        }],
      }],
    }));

    const result = await virtualizeRequestBody(original, {
      dialect: 'anthropic',
      mode: 'lazy',
      store,
    });
    expect(result.body).toEqual(original);
    expect(store.writes).toHaveLength(0);
  });

  it('fails open when storage returns a non-retrievable handle', async () => {
    const original = enc.encode(JSON.stringify({
      model: 'example-model',
      messages: [{ role: 'tool', tool_call_id: 'call_1', content: 'large'.repeat(2_000) }],
    }));
    const result = await virtualizeRequestBody(original, {
      dialect: 'openai-chat',
      mode: 'lazy',
      store: {
        async put() { return { id: 'not-a-content-hash' }; },
        async has() { return true; },
      },
    });
    expect(result.body).toEqual(original);
    expect(result.info.failOpen).toBe(true);
  });

  it('bounds multilingual previews in UTF-8 bytes without broken characters', async () => {
    const output = '錯誤 ERROR 😀 build failed\n'.repeat(1_000);
    const result = await virtualizeRequestBody(enc.encode(JSON.stringify({
      model: 'example-model',
      messages: [{ role: 'tool', tool_call_id: 'call_1', content: output }],
    })), {
      dialect: 'openai-chat',
      mode: 'lazy',
      store: new MemoryStore(),
    });
    const body = JSON.parse(dec.decode(result.body)) as { messages: Array<{ content: string }> };
    const preview = body.messages[0]!.content;
    expect(Buffer.byteLength(preview, 'utf8')).toBeLessThanOrEqual(6_800);
    expect(preview).not.toContain('\uFFFD');
  });

  it('sends an exact compact delta only for repeated stable tool origins', async () => {
    const beforeLines = Array.from({ length: 900 }, (_, index) => `line ${index}: unchanged value`);
    const afterLines = [...beforeLines];
    afterLines[450] = 'line 450: exact replacement value';
    const before = beforeLines.join('\n');
    const after = afterLines.join('\n');
    const stored = new Set<string>();
    const store: VirtualArtifactStore = {
      async put(text) {
        const id = `sha256_${createHash('sha256').update(text).digest('hex')}`;
        stored.add(id);
        return { id };
      },
      async has(id) { return stored.has(id); },
    };
    const originArgs = JSON.stringify({ path: 'src/example.ts' });
    const original = enc.encode(JSON.stringify({
      model: 'example-model',
      messages: [
        {
          role: 'assistant',
          tool_calls: [{ id: 'call_1', function: { name: 'read_file', arguments: originArgs } }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: before },
        {
          role: 'assistant',
          tool_calls: [{ id: 'call_2', function: { name: 'read_file', arguments: originArgs } }],
        },
        { role: 'tool', tool_call_id: 'call_2', content: after },
      ],
    }));

    const result = await virtualizeRequestBody(original, {
      dialect: 'openai-chat',
      mode: 'lazy',
      store,
    });
    const body = JSON.parse(dec.decode(result.body)) as { messages: Array<{ content?: string }> };
    const deltaText = body.messages[3]!.content ?? '';
    const payload = JSON.parse(deltaText.split('\n')[1]!) as {
      start_line_0: number;
      delete_line_count: number;
      insert_lines: string[];
    };
    const reconstructed = before.split('\n');
    reconstructed.splice(payload.start_line_0, payload.delete_line_count, ...payload.insert_lines);

    expect(deltaText).toContain('replace_lines_v1');
    expect(reconstructed.join('\n')).toBe(after);
    expect(Buffer.byteLength(deltaText)).toBeLessThan(4_096);
    expect(result.info.deltaArtifacts).toBe(1);
    expect(result.info.deltaCharsRemoved).toBeGreaterThan(0);
  });
});
