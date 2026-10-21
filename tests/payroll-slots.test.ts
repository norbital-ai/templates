/** M18 / runs guard: every payroll key and PAYROLL rule slot the engine requires is stated in every seed version. */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from '@effect/vitest';
import { Result, Schema } from 'effect';
import {
	PAYROLL_SLOTS,
	payrollSetting,
	REQUIRED_PAYROLL_SETTINGS
} from '../src/lib/payroll_engine/foundation.ts';
import { LINEAGES, SEED } from './jurisdiction_kit.ts';
import { readSeedRows } from './seed_values.ts';

const versions = LINEAGES.flatMap((code) =>
	readdirSync(resolve(SEED, code))
		.filter((name) => /^version_\d+$/.test(name))
		.map((name) => `${code}/${name}`)
);
const isObject = Schema.is(Schema.Record(Schema.String, Schema.Json));
const required = Object.entries(PAYROLL_SLOTS).flatMap(([code, need]) =>
	need === 'required' ? [code] : []
);

it('every seed version states each required payroll key and PAYROLL slot', () => {
	assert.ok(versions.length > 0);
	const missing: string[] = [];
	for (const version of versions) {
		const directory = resolve(SEED, version);
		for (const settings of readSeedRows(directory, 'jurisdiction_settings')) {
			const payroll = isObject(settings['payroll']) ? settings['payroll'] : {};
			for (const key of REQUIRED_PAYROLL_SETTINGS)
				if (payroll[key] == null || payroll[key] === '') missing.push(`${version} payroll.${key}`);
		}
		const slots = new Set(
			readSeedRows(directory, 'rule_set')
				.filter((row) => row['family'] === 'PAYROLL')
				.map((row) => row['code'])
		);
		for (const code of required) if (!slots.has(code)) missing.push(`${version} rule_set ${code}`);
	}
	assert.deepEqual(missing, []);
});

it('M16: a version without payroll.timezone refuses, naming the row and key, instead of counting days in UTC', () => {
	const absent = payrollSetting('SG', { currency: 'SGD' }, 'timezone');
	assert.ok(Result.isFailure(absent));
	assert.equal(
		absent.failure.message,
		'jurisdiction_settings SG names no payroll.timezone; it is required.'
	);
	const stated = payrollSetting('SG', { timezone: 'Asia/Singapore' }, 'timezone');
	assert.ok(Result.isSuccess(stated) && stated.success === 'Asia/Singapore');
});
