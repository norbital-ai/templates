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

const rules = (divisor: string) => ({ work_rules: { ordinary_divisor_days: divisor } });

test('an unchanged root is no change; a moved divisor reads as its leaf', () => {
	assert.deepEqual(diffSettingsRoot(rules('26.0'), rules('26.0')), []);
	const changes = diffSettingsRoot(rules('26.0'), rules('30.0'));
	assert.equal(changes.length, 1);
	assert.equal(changes[0]?.previous, '26.0');
	assert.equal(changes[0]?.proposed, '30.0');
	assert.match(changes[0]?.path ?? '', /ordinary_divisor_days$/);
});

test('a scheme whose formula selects one more row reads as that change', () => {
	const scheme = (assessedOn: string) => [{ code: 'EPF', assessed_on: assessedOn }];
	assert.equal(
		diffCollection(
			'statutory_contributions',
			scheme('BASE + ENCASHMENT'),
			scheme('BASE + ENCASHMENT')
		),
		null
	);
	const moved = diffCollection(
		'statutory_contributions',
		scheme('BASE'),
		scheme('BASE + ALLOWANCES')
	);
	assert.equal(moved?.rows[0]?.code, 'EPF');
	assert.equal(moved?.rows[0]?.changes[0]?.path, 'assessed_on');
});
