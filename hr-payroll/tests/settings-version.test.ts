/** L-TPL-hr-payroll-009 clone/seal/void; L-TPL-hr-payroll-010 snapshot diff. */
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { datePeriod, Instant } from '@norbital-ai/std/date';
import { fixtureId, nativeId } from './fixture_values.ts';
import {
	cloneSettingsFields,
	diffCatalogCodes,
	diffSettings,
	refuseSealedUpdate,
	sealSettings
} from '../src/lib/payroll_engine/settings_version.ts';

const settingsId = (id: string) => nativeId('jurisdiction_settings', fixtureId(id));

const row = (id: string, from: string, to: string | null, sealed = true) => ({
	id: settingsId(id),
	code: 'SG',
	jurisdiction_code: 'SG',
	name: id,
	payroll: { currency: 'SGD' },
	sources: { entries: [] },
	effective_range: datePeriod(from, to),
	sealed_at: sealed ? Instant('2026-01-01T00:00:00.000Z') : null,
	voided_at: null,
	void_reason: null
});

describe('settings version lifecycle', () => {
	it('L-TPL-hr-payroll-009 clones an open unsealed successor with cloned_from_id', () => {
		const next = cloneSettingsFields(row('a', '2026-01-01', null), '2026-07-01');
		assert.equal(next.cloned_from_id, settingsId('a'));
		assert.deepEqual(next.effective_range, { from: '2026-07-01', to: null });
		assert.equal(next.sealed_at, null);
		assert.equal(next.voided_at, null);
		assert.equal(next.code, 'SG');
		assert.equal(next.payroll.currency, 'SGD');
		assert.equal('id' in next, false);
	});

	it('L-TPL-hr-payroll-009 seals a draft by ending the predecessor the day before', () => {
		const writes = sealSettings(
			row('draft', '2026-04-01', null, false),
			[row('a', '2026-01-01', null), row('c', '2026-07-01', null)],
			Instant('2026-09-25T00:00:00.000Z')
		);
		assert.deepEqual(writes, [
			{
				target: settingsId('a'),
				set: { effective_range: { from: '2026-01-01', to: '2026-03-31' } }
			},
			{
				target: settingsId('draft'),
				set: {
					effective_range: { from: '2026-04-01', to: '2026-06-30' },
					sealed_at: '2026-09-25T00:00:00.000Z'
				}
			}
		]);
	});

	it('L-TPL-hr-payroll-009 refuses a sealed rename and admits a void with a reason', () => {
		const sealed = row('a', '2026-01-01', null);
		assert.match(refuseSealedUpdate(sealed, { name: 'renamed' })!, /name cannot change/);
		assert.equal(
			refuseSealedUpdate(sealed, {
				effective_range: { from: '2026-01-01', to: '2026-03-31' }
			}),
			null
		);
		assert.match(
			refuseSealedUpdate(sealed, { voided_at: '2026-09-25T00:00:00.000Z' })!,
			/states its reason/
		);
		assert.equal(
			refuseSealedUpdate(sealed, {
				voided_at: '2026-09-25T00:00:00.000Z',
				void_reason: 'wrong rate'
			}),
			null
		);
	});

	it('L-TPL-hr-payroll-010 diffs settings fields and catalogue codes', () => {
		const left = { name: 'SG 2024', payroll: { currency: 'SGD' }, change_summary: 'a' };
		const right = { name: 'SG 2025', payroll: { currency: 'SGD' }, change_summary: 'b' };
		assert.deepEqual(diffSettings(left, right, ['name', 'payroll', 'change_summary']), [
			{ path: 'name', kind: 'changed', left: 'SG 2024', right: 'SG 2025' },
			{ path: 'change_summary', kind: 'changed', left: 'a', right: 'b' }
		]);
		assert.deepEqual(diffCatalogCodes(['AL', 'SL'], ['AL', 'ML'], 'leave_catalog'), [
			{ path: 'leave_catalog.SL', kind: 'removed', left: 'SL' },
			{ path: 'leave_catalog.ML', kind: 'added', right: 'ML' }
		]);
	});

	it('does not report nested settings changes caused only by key order', () => {
		assert.deepEqual(
			diffSettings(
				{ payroll: { currency: 'SGD', rounding: { mode: 'half_up', digits: 2 } } },
				{ payroll: { rounding: { digits: 2, mode: 'half_up' }, currency: 'SGD' } },
				['payroll']
			),
			[]
		);
	});
});
