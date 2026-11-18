import { expect, it } from '@effect/vitest';
import { newestOf, selectBatch } from '../src/lib/message-import.js';

const row = (id: string, seq: number, source_at: string | null, sent_at: string | null = null) => ({
	id,
	seq,
	source_at,
	sent_at,
	created_at: '2026-10-01T02:00:00Z'
});
const NOW = '2026-10-01T02:00:00Z';

it('a batch admits fresh mail and WhatsApp beside the oldest history, never FIFO over the backlog', () => {
	// five old chats arrived first; a late history page has a newer sequence than both current messages
	const old = Array.from({ length: 5 }, (_, i) => row(`old-${i}`, i + 1, '2026-09-01T02:00:00Z'));
	const chat = row('fresh-chat', 6, NOW);
	const mail = row('fresh-mail', 7, NOW);
	const late = row('late-history', 8, '2026-08-01T02:00:00Z');
	const whatsapp = newestOf([...old, chat, late], 4);
	expect(whatsapp[0]?.id).toBe('fresh-chat');
	const batch = selectBatch(
		[...old, chat, mail, late],
		[whatsapp, newestOf([mail], 4)],
		new Set(),
		5
	);
	expect(batch.map((m) => m.id)).toEqual(['old-0', 'old-1', 'old-2', 'fresh-chat', 'fresh-mail']);
	// a message already filed is never selected again
	expect(selectBatch(old, [], new Set(['old-0']), 3).map((m) => m.id)).toEqual([
		'old-1',
		'old-2',
		'old-3'
	]);
});

it('an undated message orders by arrival, independent of the sender date', () => {
	const lane = newestOf(
		[row('a', 1, null, '2026-08-01T02:00:00Z'), row('b', 2, '2026-09-01T02:00:00Z')],
		1
	);
	expect(lane.map((m) => m.id)).toEqual(['a']);
});
