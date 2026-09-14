/**
 * The snapshot diff names schemes, not rows.
 *
 * Cloning a settings version remaps every opt-in to the new version's `statutory_contributions`
 * rows, so the same scheme carries a new UUID while its code stays. The diff resolves each id
 * through the caller's lookup: a remap that lands on the same code is not a change of law, and a
 * genuine move between schemes reads as the two codes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { diffCollection, diffSettingsRoot } from '../src/lib/snapshot_diff.ts';

const rules = (contributionId: string) => ({
	work_rules: {
		engine_lines: {
			salary: { statutory_opt_ins: [{ contribution_id: contributionId, effect: 'INCLUDE' }] }
		}
	}
});
const codeOf = (id: string): string | null =>
	({ 'row-a': 'JHT', 'row-b': 'JHT', 'row-c': 'PPH21' })[id] ?? null;

test('a remapped opt-in on the same scheme code is not a change', () => {
	const changes = diffSettingsRoot(rules('row-a'), rules('row-b'), codeOf);
	assert.deepEqual(changes, []);
});

test('an opt-in that moved scheme reads as the two codes', () => {
	const changes = diffSettingsRoot(rules('row-a'), rules('row-c'), codeOf);
	assert.equal(changes.length, 1);
	assert.equal(changes[0]?.previous, 'JHT');
	assert.equal(changes[0]?.proposed, 'PPH21');
	assert.match(changes[0]?.path ?? '', /contribution_id$/);
});

test('without a lookup the raw ids still diff', () => {
	const changes = diffSettingsRoot(rules('row-a'), rules('row-b'));
	assert.equal(changes.length, 1);
});

test('a catalogue band’s remapped opt-in is not a change either', () => {
	const catalogue = (contributionId: string) => [
		{
			code: 'ANNUAL_LEAVE',
			bands: [{ when: '', amount: 1, statutory_opt_ins: [{ contribution_id: contributionId }] }]
		}
	];
	assert.equal(
		diffCollection('leave_catalogue', catalogue('row-a'), catalogue('row-b'), codeOf),
		null
	);
	const moved = diffCollection('leave_catalogue', catalogue('row-a'), catalogue('row-c'), codeOf);
	assert.equal(moved?.rows[0]?.changes[0]?.previous, 'JHT');
	assert.equal(moved?.rows[0]?.changes[0]?.proposed, 'PPH21');
});
