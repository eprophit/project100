'use client';

import { useEffect, useRef, useState } from 'react';

interface TraceEntry {
  tool: string;
  summary: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  trace: TraceEntry[];
  streaming?: boolean;
}

const SUGGESTIONS = [
  'Should I train hard today?',
  'Is my sleep affecting my HRV?',
  'How has my rowing split progressed this year?',
  'Am I eating enough protein on hard training days?',
  'What changed most in my last blood panel?',
  'Is my training load ramping too fast?',
];

const TOOL_LABEL: Record<string, string> = {
  list_metrics: 'browsing the metric catalog',
  query_metric: 'querying a metric',
  correlate_metrics: 'correlating two metrics',
  get_daily_summary: 'reading today’s summary',
  get_training: 'reading training history',
  get_nutrition: 'reading nutrition',
  get_biomarkers: 'reading biomarker panels',
  get_recovery_protocols: 'reading recovery protocols',
};

export function CoachClient({ online, model }: { online: boolean; model: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/chat?thread=default');
      const data = await res.json();
      if (data.messages?.length) setMessages(data.messages);
    })();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;

    setError(null);
    setInput('');
    setBusy(true);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text, trace: [] },
      { role: 'assistant', content: '', trace: [], streaming: true },
    ]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      });

      if (!res.body) throw new Error('No response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // The endpoint emits newline-delimited JSON; a chunk can split an event,
      // so hold the tail until a newline arrives.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          applyEvent(event, setMessages, setError);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant') last.streaming = false;
        return next;
      });
    } finally {
      setBusy(false);
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant') next[next.length - 1] = { ...last, streaming: false };
        return next;
      });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Coach</h1>
          <p className="page-sub">
            {online ? (
              <>
                Backed by <span className="mono">{model}</span>, with read access to your data through eight
                tools. Every number it quotes comes from a tool call you can see.
              </>
            ) : (
              <>
                Running the offline analyst — no <span className="mono">ANTHROPIC_API_KEY</span> is set, so
                answers come from keyword-matched queries against the same tools.
              </>
            )}
          </p>
        </div>
        {!online ? <span className="badge badge-warning">◐ Offline mode</span> : null}
      </div>

      <div className="chat-shell">
        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="card">
              <h2 style={{ marginBottom: 8 }}>Ask about your data</h2>
              <p className="page-sub" style={{ marginBottom: 14 }}>
                The coach can read your training, sleep, HRV, food log, supplements, recovery protocols and
                biomarker panels — and correlate any two of them.
              </p>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="btn btn-sm" type="button" onClick={() => ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((m, i) => (
            <div className={`msg ${m.role === 'user' ? 'msg-user' : ''}`} key={i}>
              <div className={`msg-avatar ${m.role === 'user' ? 'msg-avatar-user' : 'msg-avatar-ai'}`}>
                {m.role === 'user' ? 'You' : '✦'}
              </div>
              <div className="msg-body">
                {m.trace.length ? (
                  <div className="tool-trace">
                    {m.trace.map((t, j) => (
                      <span className="tool-chip" key={j}>
                        <span style={{ color: 'var(--series-3)' }}>▸</span>
                        {TOOL_LABEL[t.tool] ?? t.tool}
                        <span className="muted"> — {t.summary}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
                {m.content ? (
                  <Markdownish text={m.content} />
                ) : m.streaming ? (
                  <span className="muted small">
                    <span className="spin" style={{ marginRight: 6 }} />
                    thinking…
                  </span>
                ) : null}
              </div>
            </div>
          ))}

          {error ? (
            <div className="card" style={{ borderColor: 'var(--critical)' }}>
              <span style={{ color: 'var(--critical)' }}>▲ {error}</span>
            </div>
          ) : null}
        </div>

        <div>
          {messages.length > 0 ? (
            <div className="suggestions">
              {SUGGESTIONS.slice(0, 3).map((s) => (
                <button key={s} className="btn btn-sm" type="button" disabled={busy} onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          ) : null}
          <div className="chat-input">
            <textarea
              rows={2}
              placeholder="Ask about training, sleep, food, recovery or labs…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(input);
                }
              }}
            />
            <button className="btn btn-primary" type="button" disabled={busy || !input.trim()} onClick={() => ask(input)}>
              {busy ? <span className="spin" /> : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function applyEvent(
  event: Record<string, unknown>,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setError: (s: string | null) => void,
) {
  const type = event.type as string;

  if (type === 'error') {
    setError(String(event.message ?? 'Something went wrong'));
    return;
  }

  setMessages((prev) => {
    const next = [...prev];
    const idx = next.length - 1;
    const last = next[idx];
    if (!last || last.role !== 'assistant') return prev;

    if (type === 'text') {
      next[idx] = { ...last, content: last.content + String(event.delta ?? '') };
    } else if (type === 'tool_result') {
      next[idx] = {
        ...last,
        trace: [...last.trace, { tool: String(event.name), summary: String(event.summary ?? '') }],
      };
    } else if (type === 'done') {
      next[idx] = { ...last, streaming: false };
    }
    return next;
  });
}

/**
 * Just enough markdown for the coach's output: bold, inline code, bullets and
 * blank-line paragraphs. Deliberately not a full parser — the surface is one
 * trusted producer, and a dependency here would outweigh the feature.
 */
function Markdownish({ text }: { text: string }) {
  const blocks = text.split('\n');
  return (
    <>
      {blocks.map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: 8 }} />;
        const bullet = /^\s*[-*]\s+/.test(line);
        const content = bullet ? line.replace(/^\s*[-*]\s+/, '') : line;
        return (
          <div key={i} style={bullet ? { paddingLeft: 14, textIndent: -10 } : undefined}>
            {bullet ? <span className="muted">• </span> : null}
            {inline(content)}
          </div>
        );
      })}
    </>
  );
}

function inline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      parts.push(
        <code key={key++} className="mono" style={{ background: 'var(--surface-3)', padding: '1px 4px', borderRadius: 4 }}>
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(
        <em key={key++} className="muted">
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
