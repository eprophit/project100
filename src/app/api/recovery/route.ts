import { NextResponse } from 'next/server';
import { ensureReady } from '@/lib/bootstrap';
import { run } from '@/lib/db';
import { today } from '@/lib/dates';
import { protocolsForDay, supplementsForDay } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Recovery-side writes: supplement check-offs and protocol logging. */

export async function GET(request: Request) {
  await ensureReady();
  const day = new URL(request.url).searchParams.get('day') ?? today();
  return NextResponse.json({
    day,
    supplements: supplementsForDay(day),
    protocols: protocolsForDay(day),
  });
}

export async function POST(request: Request) {
  await ensureReady();
  const body = (await request.json()) as {
    action: 'toggle_supplement' | 'log_protocol' | 'delete_protocol';
    day?: string;
    supplementId?: string;
    taken?: boolean;
    kind?: string;
    minutes?: number;
    intensity?: string;
    notes?: string;
    id?: string;
  };

  const day = body.day ?? today();

  switch (body.action) {
    case 'toggle_supplement': {
      if (!body.supplementId) {
        return NextResponse.json({ error: 'supplementId is required' }, { status: 400 });
      }
      run(
        `INSERT INTO supplement_logs (id, supplement_id, day, taken, source_id)
         VALUES (?, ?, ?, ?, 'manual')
         ON CONFLICT(supplement_id, day) DO UPDATE SET taken = excluded.taken`,
        [`${body.supplementId}:${day}`, body.supplementId, day, body.taken ? 1 : 0],
      );
      break;
    }
    case 'log_protocol': {
      if (!body.kind) return NextResponse.json({ error: 'kind is required' }, { status: 400 });
      const externalId = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      run(
        `INSERT INTO protocols (id, source_id, external_id, day, kind, minutes, intensity, notes)
         VALUES (?, 'manual', ?, ?, ?, ?, ?, ?)`,
        [
          `manual:${externalId}`, externalId, day, body.kind,
          Number(body.minutes) || null, body.intensity ?? null, body.notes ?? null,
        ],
      );
      break;
    }
    case 'delete_protocol': {
      if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
      run('DELETE FROM protocols WHERE id = ?', [body.id]);
      break;
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  return NextResponse.json({
    day,
    supplements: supplementsForDay(day),
    protocols: protocolsForDay(day),
  });
}
