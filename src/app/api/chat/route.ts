import Anthropic from '@anthropic-ai/sdk';
import { ensureReady } from '@/lib/bootstrap';
import { localCoach } from '@/lib/coach/local';
import { TOOLS, runTool } from '@/lib/coach/tools';
import { all, run } from '@/lib/db';
import { today } from '@/lib/dates';
import { coverage, todayCard } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL = process.env.COACH_MODEL ?? 'claude-opus-5';
const EFFORT = (process.env.COACH_EFFORT ?? 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const MAX_TURNS = 8;

/**
 * Streaming coach endpoint.
 *
 * Emits newline-delimited JSON events so the client can render tool calls as
 * they happen rather than staring at a spinner:
 *   {type:'tool_use',  name, input}
 *   {type:'tool_result', name, summary}
 *   {type:'text', delta}
 *   {type:'done', trace}
 *   {type:'error', message}
 */

function systemPrompt(): string {
  const cov = coverage();
  const card = todayCard();

  return `You are the analyst inside Vitalis, a personal health-tracking app. You answer questions about one athlete's own data.

## How to answer

Call tools to get numbers. Never estimate a value you could look up, and never state a figure the tools did not return. If a tool comes back empty, say the data isn't there rather than filling the gap.

Lead with the answer, then the evidence. Cite the actual numbers and the window they cover. Prefer two or three sentences of prose over a bulleted wall; use a short list only when the answer really is a list. Skip preamble — no "great question", no restating what was asked.

When a question is causal ("is X hurting my Y"), reach for correlate_metrics, report r and n, and be straight about what an observational correlation on one person's self-tracked data can and cannot support. Confounds worth naming: training phase, seasonality, and the fact that most of these signals move together.

You can suggest training and nutrition adjustments — that is the job. Do not diagnose, and do not interpret lab values as clinical findings; for anything out of reference range, note it and say it belongs with their clinician.

## Data on file

Range: ${cov.workouts?.first ?? 'n/a'} to ${cov.workouts?.last ?? 'n/a'}. Today is ${today()}.
Workouts ${cov.workouts?.n ?? 0} · sleep nights ${cov.sleep?.n ?? 0} · HRV mornings ${cov.recovery?.n ?? 0} · food entries ${cov.nutrition?.n ?? 0} · biomarker results ${cov.biomarkers?.n ?? 0} · body measurements ${cov.body?.n ?? 0}.

Sources: Function Health (labs), MyFitnessPal (food), Apple Health (sleep, body composition, running/strength/walking), ErgData (rowing), Peloton (cycling), HRV4Training (morning HRV). Supplements and recovery protocols are logged in the app.

Latest snapshot — readiness ${card.readiness ?? 'n/a'}, HRV ${card.hrv ?? 'n/a'} ms vs ${card.hrvBaseline ?? 'n/a'} ms baseline, resting HR ${card.restingHr ?? 'n/a'} bpm, sleep ${card.sleepHours ?? 'n/a'} h.

## Units

Rowing pace is seconds per 500 m and running pace is seconds per kilometre — for both, lower is faster, so a fall in the number is an improvement. Training load is an arbitrary unit: duration scaled by relative intensity squared. Acute load is its 7-day rolling mean, chronic load the 28-day mean.`;
}

interface TraceEntry {
  tool: string;
  summary: string;
}

export async function POST(request: Request) {
  await ensureReady();

  const body = (await request.json()) as {
    message: string;
    threadId?: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
  };

  const threadId = body.threadId ?? 'default';
  const question = (body.message ?? '').trim();
  if (!question) {
    return new Response(JSON.stringify({ error: 'message is required' }), { status: 400 });
  }

  run('INSERT INTO chat_messages (thread_id, role, content, created_at) VALUES (?, ?, ?, ?)', [
    threadId,
    'user',
    question,
    new Date().toISOString(),
  ]);

  const encoder = new TextEncoder();
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // ---- Offline path: same tools, keyword routing, no model ---------------
  if (!apiKey) {
    const { text, trace } = localCoach(question);
    persistAssistant(threadId, text, trace);

    const stream = new ReadableStream({
      start(controller) {
        for (const t of trace) {
          controller.enqueue(encoder.encode(json({ type: 'tool_use', name: t.tool, input: {} })));
          controller.enqueue(encoder.encode(json({ type: 'tool_result', name: t.tool, summary: t.summary })));
        }
        // Chunked so the client's rendering path is identical either way.
        for (const chunk of text.match(/[\s\S]{1,90}/g) ?? []) {
          controller.enqueue(encoder.encode(json({ type: 'text', delta: chunk })));
        }
        controller.enqueue(encoder.encode(json({ type: 'done', trace, offline: true })));
        controller.close();
      },
    });

    return new Response(stream, { headers: sseHeaders() });
  }

  // ---- Model path --------------------------------------------------------
  const client = new Anthropic({ apiKey });

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...(body.history ?? []).slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: question },
  ];

  const trace: TraceEntry[] = [];
  let finalText = '';

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(json(obj)));

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const message = await streamTurn(client, messages, send);

          if (message.stop_reason === 'refusal') {
            send({ type: 'error', message: 'The model declined to answer that.' });
            break;
          }

          for (const block of message.content) {
            if (block.type === 'text') finalText += block.text;
          }

          // A server-side tool paused mid-turn: echo the assistant turn back and
          // let the model pick up where it left off.
          if (message.stop_reason === 'pause_turn') {
            messages.push({ role: 'assistant', content: message.content });
            continue;
          }

          const toolUses = message.content.filter(
            (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
          );
          if (!toolUses.length) break;

          messages.push({ role: 'assistant', content: message.content });

          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const use of toolUses) {
            send({ type: 'tool_use', name: use.name, input: use.input });
            try {
              const outcome = runTool(use.name, (use.input ?? {}) as Record<string, unknown>);
              trace.push({ tool: use.name, summary: outcome.summary });
              send({ type: 'tool_result', name: use.name, summary: outcome.summary });
              results.push({
                type: 'tool_result',
                tool_use_id: use.id,
                content: JSON.stringify(outcome.result),
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              trace.push({ tool: use.name, summary: `failed: ${msg}` });
              send({ type: 'tool_result', name: use.name, summary: `failed: ${msg}` });
              // Every tool_use needs a matching tool_result or the next request
              // is rejected — errors are reported, not dropped.
              results.push({
                type: 'tool_result',
                tool_use_id: use.id,
                content: `Tool failed: ${msg}`,
                is_error: true,
              });
            }
          }

          messages.push({ role: 'user', content: results });
        }

        persistAssistant(threadId, finalText, trace);
        send({ type: 'done', trace });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send({ type: 'error', message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

/** One model turn, streaming text deltas out as they arrive. */
async function streamTurn(
  client: Anthropic,
  messages: Anthropic.Beta.BetaMessageParam[],
  send: (obj: unknown) => void,
): Promise<Anthropic.Beta.BetaMessage> {
  const params = {
    model: MODEL,
    max_tokens: 8000,
    system: systemPrompt(),
    // Thinking is on by default on Opus 5; max_tokens covers thinking + text,
    // which is why it is generous relative to the length of the answers.
    output_config: { effort: EFFORT },
    tools: TOOLS,
    messages,
  } as unknown as Anthropic.Beta.MessageCreateParamsStreaming;

  // Refusal fallbacks are opt-in and only exist on the first-party API, so a
  // 400 mentioning them means the SDK or endpoint predates the feature — drop
  // them and retry rather than failing the request.
  try {
    return await consume(
      client.beta.messages.stream({
        ...params,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      } as never),
      send,
    );
  } catch (err) {
    if (!isFallbackRejection(err)) throw err;
    return await consume(client.beta.messages.stream(params), send);
  }
}

async function consume(
  stream: ReturnType<Anthropic['beta']['messages']['stream']>,
  send: (obj: unknown) => void,
): Promise<Anthropic.Beta.BetaMessage> {
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      send({ type: 'text', delta: event.delta.text });
    }
  }
  return stream.finalMessage();
}

function isFallbackRejection(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  if (err.status !== 400 && err.status !== 404) return false;
  return /fallback|beta|unexpected|unknown|unsupported/i.test(err.message ?? '');
}

function persistAssistant(threadId: string, text: string, trace: TraceEntry[]): void {
  if (!text.trim()) return;
  run(
    'INSERT INTO chat_messages (thread_id, role, content, tool_trace, created_at) VALUES (?, ?, ?, ?, ?)',
    [threadId, 'assistant', text, JSON.stringify(trace), new Date().toISOString()],
  );
}

function json(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

function sseHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  };
}

/** GET — thread history, so a reload doesn't lose the conversation. */
export async function GET(request: Request) {
  await ensureReady();
  const threadId = new URL(request.url).searchParams.get('thread') ?? 'default';
  const rows = all<{ role: string; content: string; tool_trace: string | null; created_at: string }>(
    'SELECT role, content, tool_trace, created_at FROM chat_messages WHERE thread_id = ? ORDER BY id',
    [threadId],
  );
  return new Response(
    JSON.stringify({
      messages: rows.map((r) => ({
        role: r.role,
        content: r.content,
        trace: r.tool_trace ? JSON.parse(r.tool_trace) : [],
      })),
      online: Boolean(process.env.ANTHROPIC_API_KEY),
      model: MODEL,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}
