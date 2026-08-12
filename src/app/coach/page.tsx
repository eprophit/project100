import { CoachClient } from './CoachClient';
import { ensureReady } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

export default async function CoachPage() {
  await ensureReady();
  return <CoachClient online={Boolean(process.env.ANTHROPIC_API_KEY)} model={process.env.COACH_MODEL ?? 'claude-opus-5'} />;
}
