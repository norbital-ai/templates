import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	templateEnvironmentVariables,
	validateTemplateEnvironmentVariables
} from '../lib/artifact-environment.mjs';

describe('compiled artifact environment declarations', () => {
	it('accepts the complete HR Payroll declaration independent of artifact order', () => {
		assert.deepEqual(
			validateTemplateEnvironmentVariables('hr-payroll', [
				'PAYROLL_EXPORT_SIGNING_SECRET',
				'GEOCODING_API_KEY',
				'MAP_TILE_URL'
			]),
			['GEOCODING_API_KEY', 'MAP_TILE_URL', 'PAYROLL_EXPORT_SIGNING_SECRET']
		);
	});

	it('rejects every incomplete HR Payroll declaration', () => {
		const expected = templateEnvironmentVariables.get('hr-payroll');
		assert.ok(expected);
		for (const omitted of expected) {
			assert.throws(
				() =>
					validateTemplateEnvironmentVariables(
						'hr-payroll',
						expected.filter((variable) => variable !== omitted)
					),
				new RegExp(`hr-payroll artifact environment variables differ:.*${omitted}`)
			);
		}
	});

	it('rejects undeclared artifact environment variables', () => {
		assert.throws(
			() =>
				validateTemplateEnvironmentVariables('hr-payroll', [
					'GEOCODING_API_KEY',
					'MAP_TILE_URL',
					'PAYROLL_EXPORT_SIGNING_SECRET',
					'UNDECLARED_SECRET'
				]),
			/received .*UNDECLARED_SECRET/
		);
	});
});
