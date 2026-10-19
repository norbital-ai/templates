import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import {
	entitlementHasError,
	entitlementWindowFields,
	setEntitlement
} from '../src/lib/ui/settings/entitlement.ts';

describe('entitlement editor', () => {
	it('retains undisplayed settings when editing or clearing one optional field', () => {
		const original = {
			days: '14.0',
			window: 'SERVICE_YEAR',
			service_year_offset_months: 6,
			carry_forward: '5.0',
			bands: [{ service_months: 12, days: 14 }],
			future_setting: 'retained'
		};
		assert.deepEqual(setEntitlement(original, 'days', '16.0'), { ...original, days: '16.0' });
		const { carry_forward, ...withoutCarry } = original;
		assert.equal(carry_forward, '5.0');
		assert.deepEqual(setEntitlement(original, 'carry_forward', ''), withoutCarry);
		assert.equal(setEntitlement({ days: '14.0' }, 'days', null), null);
		assert.deepEqual(original.bands, [{ service_months: 12, days: 14 }]);
	});

	it('reveals only the settings used by the selected balance window', () => {
		assert.deepEqual(entitlementWindowFields('ROLLING'), ['window_months']);
		assert.deepEqual(entitlementWindowFields('SERVICE_YEAR'), ['service_year_offset_months']);
		assert.deepEqual(entitlementWindowFields('EVENT'), ['window_key']);
		assert.deepEqual(entitlementWindowFields('CALENDAR_YEAR'), []);
		assert.deepEqual(entitlementWindowFields(undefined), []);
	});

	it('reveals refused inactive settings and the group owning a nested refusal', () => {
		const errors = new Map([
			['entitlement.window_months', 'Rolling months must be an integer'],
			['entitlement.bands.0.days', 'Days must be an integer'],
			['entitlement.carry_depth', 'Carry windows must be an integer']
		]);
		assert.deepEqual(entitlementWindowFields('EVENT', errors), ['window_months', 'window_key']);
		assert.equal(entitlementHasError(errors, ['bands']), true);
		assert.equal(entitlementHasError(errors, ['carry_forward', 'carry_depth']), true);
		assert.equal(entitlementHasError(errors, ['hours_per_day']), false);
		errors.delete('entitlement.window_months');
		assert.deepEqual(entitlementWindowFields('EVENT', errors), ['window_key']);
		assert.equal(
			entitlementHasError(new Map([['entitlement.bands_extra', 'Other field']]), ['bands']),
			false
		);
	});
});
