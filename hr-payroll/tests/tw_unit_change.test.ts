// A change of the responsible person is a unit change for labour insurance and NHI, just like a change of the
// registered name or address. Only the version immediately before the new one is compared.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

type Rule = {
	readonly code: string;
	readonly condition?: string;
	readonly lookup?: Record<string, unknown>;
};
const rules = JSON.parse(
	readFileSync(
		new URL('../seed/public/jurisdiction/TW/version_5/registered_effect.json', import.meta.url),
		'utf8'
	)
) as readonly Rule[];
const effects = ['LI_UNIT_CHANGE', 'NHI_UNIT_CHANGE'].map((code) => {
	const effect = rules.find((row) => row.code === code);
	assert.ok(effect?.condition !== undefined);
	return effect;
});
type Version = {
	readonly id: string;
	readonly effective_range: { readonly from: string };
	readonly name: string;
	readonly representative_name: string;
	readonly registered_address: string;
	readonly settings_code?: string;
};
const version = (id: string, from: string, over: Partial<Version> = {}): Version => ({
	id,
	effective_range: { from },
	name: 'Acme',
	representative_name: 'Alice',
	registered_address: 'Taipei',
	...over
});
const fires = (effect: Rule, entry: Version, earlier: readonly Version[]) =>
	evaluate(
		effect.condition!,
		'CALCULATION',
		{
			lookup: effect.lookup ?? {},
			entry,
			reads: { entity_profile_version: [entry, ...earlier], obligation: [] }
		},
		effect.code
	);

describe('TW unit-change effects', () => {
	it('a representative-only change raises both reports', () => {
		for (const effect of effects) {
			const previous = version('v1', '2025-01-01');
			const entry = version('v2', '2026-01-01', { representative_name: 'Bob' });
			assert.equal(fires(effect, entry, [previous]), true, effect.code);
		}
	});
	it('name and address changes still raise them', () => {
		for (const effect of effects) {
			const previous = version('v1', '2025-01-01');
			assert.equal(
				fires(effect, version('v2', '2026-01-01', { name: 'Acme 2' }), [previous]),
				true
			);
			assert.equal(
				fires(effect, version('v2', '2026-01-01', { registered_address: 'Kaohsiung' }), [previous]),
				true
			);
		}
	});
	it('an unrelated edit or no earlier version raises nothing', () => {
		for (const effect of effects) {
			const previous = version('v1', '2025-01-01');
			assert.equal(
				fires(effect, version('v2', '2026-01-01', { settings_code: 'TW-2' }), [previous]),
				false,
				effect.code
			);
			assert.equal(
				fires(effect, version('v2', '2026-01-01', { representative_name: 'Bob' }), []),
				false
			);
		}
	});
	it('compares the immediately preceding version, not an older one', () => {
		for (const effect of effects) {
			const older = version('v1', '2024-01-01', { representative_name: 'Old' });
			const latest = version('v2', '2025-01-01');
			assert.equal(fires(effect, version('v3', '2026-01-01'), [older, latest]), false, effect.code);
		}
	});
});
