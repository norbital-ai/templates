/** What the classifier and meeting notes send to the model is bounded. */
import { describe, expect, it } from '@effect/vitest';
import { bounded, cap, ITEMS_MAX, ITEM_MAX, PROMPT_MAX, transcriptPrompt } from '../src/lib/ai.js';
describe('input caps', () => {
	it('cuts an item, a section and the whole prompt', () => {
		expect(cap('x'.repeat(10), 20)).toBe('x'.repeat(10));
		expect(cap('x'.repeat(100), 20).length).toBeLessThanOrEqual(20);
		const items = Array.from(
			{ length: ITEMS_MAX + 10 },
			(_, i) => `${i} ${'y'.repeat(ITEM_MAX * 2)}`
		);
		const text = bounded([{ title: 'Activity', items }]);
		expect(text.length).toBeLessThanOrEqual(PROMPT_MAX);
		expect(text).toContain('…[cut]');
		const few = bounded([{ title: 'Activity', items: items.slice(0, 3) }]);
		expect(
			few
				.split('\n')
				.filter((l) => l.startsWith('- '))
				.every((l) => l.length <= ITEM_MAX + 2)
		).toBe(true);
		expect(
			bounded([{ title: 'A', items: items.slice(0, ITEMS_MAX + 1).map(() => 'z') }])
		).toContain('…and 1 more not shown');
	});
	it('joins a speaker’s consecutive lines and names them', () => {
		expect(
			transcriptPrompt(
				[
					{ speaker: 'S1', start: 0, end: 2, text: 'Hello.' },
					{ speaker: 'S1', start: 2, end: 4, text: 'Shall we start?' },
					{ speaker: 'S2', start: 65, end: 70, text: 'Yes.' }
				],
				{ S1: 'Marcus Lee' }
			)
		).toBe('[00:00] Marcus Lee: Hello. Shall we start?\n[01:05] S2: Yes.');
	});
});
