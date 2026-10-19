import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from '@effect/vitest';
import { Schema } from 'effect';
import { overtimeRule } from '../seed/overtime_policies.js';
import { readRows } from '../seed/seed.js';
import { evaluateStrict } from '../src/lib/payroll_engine/expressions.js';

const Limit = Schema.Struct({
	code: Schema.String,
	from: Schema.String,
	limit: Schema.String,
	applies: Schema.String,
	hours: Schema.String
});
const Policy = Schema.Struct({ limits: Schema.Array(Limit) });
const lineages = ['SG', 'MY', 'ID', 'TH', 'VN', 'PH', 'CN', 'TW', 'JP'];
const settingsOf = (lineage: string, version = 'version_1') => {
	const [settings] = readRows(
		resolve('seed/jurisdiction', lineage, version, 'jurisdiction_settings.json')
	);
	assert.ok(settings);
	return settings;
};
const limitsOf = (lineage: string) => {
	const row = overtimeRule(settingsOf(lineage));
	assert.ok(row);
	return Schema.decodeUnknownSync(Policy)(row['rules']).limits;
};
const limitOf = (lineage: string, code: string) => {
	const limit = limitsOf(lineage).find((limit) => limit.code === code);
	assert.ok(limit, `${lineage} declares ${code}`);
	return limit;
};
const example = (
	input: {
		date?: string;
		scheduled?: number;
		approved?: number;
		paid?: number;
		dayType?: string;
		holiday?: string;
		classification?: string;
		workCategory?: string;
		wage?: number;
		termFacts?: Record<string, Schema.Json>;
		companyFacts?: Record<string, Schema.Json>;
		employeeFacts?: Record<string, Schema.Json>;
	} = {}
): Record<string, Schema.Json> => ({
	day: {
		date: input.date ?? '2026-10-17',
		approved_overtime_hours: input.approved ?? 5,
		overtime_hours: input.paid ?? 2,
		banked_hours: (input.approved ?? 5) - (input.paid ?? 2),
		scheduled_hours: input.scheduled ?? 8,
		day_type: input.dayType ?? 'WORK',
		holiday_kind: input.holiday ?? ''
	},
	terms: {
		base_salary: input.wage ?? 2500,
		statutory_work_category: input.workCategory ?? 'NON_MANUAL',
		work_classification: input.classification ?? 'STANDARD',
		employment_type: 'FULL_TIME',
		facts: input.termFacts ?? {}
	},
	company: { facts: input.companyFacts ?? {} },
	employee: {
		nationality: 'TW',
		date_of_birth: '1990-01-01',
		facts: input.employeeFacts ?? {}
	}
});

describe('version-owned overtime classification sources', () => {
	it('emits a distinct deterministic rule for every actual version and an explicit unconfigured PH policy', () => {
		const ids = new Set<string>();
		for (const lineage of lineages) {
			for (const version of readdirSync(resolve('seed/jurisdiction', lineage)).filter((name) =>
				/^version_\d+$/.test(name)
			)) {
				const settings = settingsOf(lineage, version);
				const row = overtimeRule(settings);
				assert.ok(row);
				assert.deepEqual(overtimeRule(settings), row);
				assert.equal(row['settings_id'], settings['id']);
				assert.equal(row['family'], 'PAYROLL');
				assert.equal(row['scope'], 'JURISDICTION');
				assert.equal(row['code'], 'overtime_classification');
				const id = Schema.decodeUnknownSync(Schema.String)(row['id']);
				assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
				assert.ok(!ids.has(id), `${lineage}/${version} owns its own rule`);
				ids.add(id);
				const policy = Schema.decodeUnknownSync(Policy)(row['rules']);
				assert.equal(policy.limits.length === 0, lineage === 'PH');
				assert.equal(new Set(policy.limits.map((limit) => limit.code)).size, policy.limits.length);
			}
		}
		for (const jurisdiction_code of ['UNREGISTERED', 'toString'])
			assert.equal(overtimeRule({ ...settingsOf('SG'), jurisdiction_code }), null);
	});

	it('evaluates every configured field with explicit historical-day roots and counts approved hours including banked time', () => {
		for (const lineage of lineages) {
			for (const limit of limitsOf(lineage)) {
				const context = example();
				assert.match(
					Schema.decodeUnknownSync(Schema.String)(evaluateStrict(limit.from, context)),
					/^\d{4}-\d{2}-\d{2}$/
				);
				assert.ok(
					Schema.decodeUnknownSync(Schema.Finite)(evaluateStrict(limit.limit, context)) >= 0
				);
				assert.equal(typeof evaluateStrict(limit.applies, context), 'boolean');
				assert.equal(evaluateStrict(limit.hours, context), 5);
			}
		}
	});

	it('keeps SG wage eligibility, MY universal warnings, and overtime-relative daily allowances', () => {
		const sg = limitOf('SG', 'OVERTIME_MONTHLY_CAP');
		assert.equal(evaluateStrict(sg.applies, example({ wage: 2600 })), true);
		assert.equal(evaluateStrict(sg.applies, example({ wage: 2600.01 })), false);
		assert.equal(
			evaluateStrict(sg.applies, example({ wage: 4500, workCategory: 'MANUAL_LABOUR' })),
			true
		);
		assert.equal(
			evaluateStrict(sg.applies, example({ wage: 4500.01, workCategory: 'MANUAL_LABOUR' })),
			false
		);
		for (const lineage of ['SG', 'MY', 'TW']) {
			const daily = limitOf(lineage, lineage === 'TW' ? 'OVERTIME_DAILY_CAP' : 'DAILY_HOURS_CAP');
			assert.equal(evaluateStrict(daily.limit, example({ scheduled: 9 })), 3);
			assert.equal(evaluateStrict(daily.limit, example({ scheduled: 13 })), 0);
		}
		assert.equal(
			evaluateStrict(
				limitOf('MY', 'OVERTIME_MONTHLY_CAP').applies,
				example({ wage: 10000, classification: 'MANAGERIAL' })
			),
			true
		);
	});

	it('distinguishes Indonesian ordinary days, rolling weeks and Thai fixed weeks and continuous work', () => {
		const id = limitOf('ID', 'OVERTIME_WEEKLY_CAP');
		assert.equal(evaluateStrict(id.from, example({ date: '2026-10-19' })), '2026-10-13');
		for (const context of [example({ dayType: 'REST' }), example({ holiday: 'MAKEUP_WORKDAY' })]) {
			assert.equal(evaluateStrict(id.applies, context), false);
			assert.equal(evaluateStrict(id.hours, context), 0);
		}
		const th = limitOf('TH', 'OVERTIME_WEEKLY_CAP');
		assert.equal(evaluateStrict(th.from, example({ date: '2026-10-18' })), '2026-10-12');
		assert.equal(evaluateStrict(th.from, example({ date: '2026-10-19' })), '2026-10-19');
		assert.equal(
			evaluateStrict(th.applies, example({ termFacts: { continuous_work: true } })),
			false
		);
	});

	it('retains Vietnamese daily arrangements and the declared 200/300-hour calendar-year branch', () => {
		const daily = limitOf('VN', 'OVERTIME_DAILY_CAP');
		assert.equal(evaluateStrict(daily.limit, example({ scheduled: 6 })), 3);
		assert.equal(evaluateStrict(daily.applies, example({ scheduled: 0 })), false);
		assert.equal(
			evaluateStrict(daily.applies, example({ termFacts: { normal_hours_arrangement: 'WEEKLY' } })),
			false
		);
		const weekly = limitOf('VN', 'OVERTIME_DAILY_WEEKLY_ARRANGEMENT_CAP');
		assert.equal(evaluateStrict(weekly.limit, example({ scheduled: 9 })), 3);
		const annual = limitOf('VN', 'OVERTIME_ANNUAL_CAP');
		assert.equal(evaluateStrict(annual.from, example()), '2026-01-01');
		assert.equal(evaluateStrict(annual.limit, example()), 200);
		assert.equal(
			evaluateStrict(annual.limit, example({ companyFacts: { overtime_300h_sector: true } })),
			300
		);
		assert.equal(evaluateStrict(annual.hours, example({ holiday: 'PUBLIC_HOLIDAY' })), 5);
	});

	it('does not impose standard Chinese ceilings on comprehensive or flexible work', () => {
		for (const limit of limitsOf('CN')) {
			for (const classification of ['COMPREHENSIVE', 'FLEXIBLE'])
				assert.equal(evaluateStrict(limit.applies, example({ classification })), false);
		}
		const daily = limitOf('CN', 'OVERTIME_DAILY_LIMIT');
		assert.equal(evaluateStrict(daily.applies, example({ dayType: 'REST' })), false);
		assert.equal(
			evaluateStrict(daily.applies, example({ dayType: 'REST', holiday: 'MAKEUP_WORKDAY' })),
			true
		);
		assert.equal(evaluateStrict(daily.applies, example({ holiday: 'PUBLIC_HOLIDAY' })), false);
	});

	it('uses dated Taiwanese collective approval, holiday eligibility and the individual responsibility-system agreement', () => {
		const monthly = limitOf('TW', 'OVERTIME_MONTHLY_CAP');
		const consent = {
			overtime_extension_approval_on: '2026-10-18',
			overtime_extension_approved_by: 'UNION'
		};
		assert.equal(evaluateStrict(monthly.limit, example({ companyFacts: consent })), 46);
		assert.equal(
			evaluateStrict(monthly.limit, example({ date: '2026-10-18', companyFacts: consent })),
			54
		);
		assert.equal(
			evaluateStrict(monthly.applies, example({ companyFacts: { responsibility_system: true } })),
			true
		);
		assert.equal(
			evaluateStrict(
				monthly.applies,
				example({
					companyFacts: { responsibility_system: true },
					termFacts: { responsibility_system_agreement: '2026-01-01' }
				})
			),
			false
		);
		assert.equal(evaluateStrict(monthly.hours, example({ dayType: 'REST' })), 0);
		assert.equal(
			evaluateStrict(
				monthly.hours,
				example({
					dayType: 'REST',
					holiday: 'SPECIAL_HOLIDAY',
					employeeFacts: { voting_right: true }
				})
			),
			5
		);
		assert.equal(
			evaluateStrict(
				monthly.hours,
				example({
					dayType: 'REST',
					holiday: 'SPECIAL_HOLIDAY',
					employeeFacts: { voting_right: false }
				})
			),
			0
		);
		assert.equal(
			evaluateStrict(limitOf('TW', 'OVERTIME_QUARTER_CAP').from, example()),
			'2026-08-01'
		);
	});

	it('retains Japanese anniversary-month windows, sector and care limits without using the 60-hour pay band as a ceiling', () => {
		const annual = limitOf('JP', 'OVERTIME_YEAR_720H');
		assert.equal(
			evaluateStrict(
				annual.from,
				example({ date: '2026-02-20', companyFacts: { overtime_agreement_from: '2025-03-15' } })
			),
			'2025-03-01'
		);
		assert.equal(
			evaluateStrict(
				annual.from,
				example({ date: '2026-03-01', companyFacts: { overtime_agreement_from: '2025-03-15' } })
			),
			'2026-03-01'
		);
		assert.equal(
			evaluateStrict(annual.limit, example({ companyFacts: { overtime_sector: 'DRIVER' } })),
			960
		);
		assert.equal(
			evaluateStrict(annual.limit, example({ companyFacts: { overtime_sector: 'DOCTOR_BC' } })),
			1860
		);
		assert.equal(
			evaluateStrict(annual.applies, example({ companyFacts: { overtime_sector: 'NEW_TECH_RD' } })),
			false
		);
		const six = limitOf('JP', 'OVERTIME_AVERAGE_80H_6_MONTHS');
		assert.equal(evaluateStrict(six.from, example()), '2026-05-01');
		assert.equal(evaluateStrict(six.limit, example()), 480);
		assert.equal(
			evaluateStrict(six.applies, example({ companyFacts: { overtime_sector: 'DRIVER' } })),
			false
		);
		assert.equal(
			evaluateStrict(six.applies, example({ companyFacts: { disaster_recovery_work: true } })),
			false
		);
		const care = limitOf('JP', 'CHILDCARE_CARE_MONTHLY_LIMIT');
		assert.equal(evaluateStrict(care.applies, example()), false);
		assert.equal(
			evaluateStrict(
				care.applies,
				example({ termFacts: { childcare_overtime_limit_requested: true } })
			),
			true
		);
		assert.equal(evaluateStrict(care.limit, example()), 24);
		assert.equal(evaluateStrict(limitOf('JP', 'OVERTIME_REST_DAY_100H').limit, example()), 100);
		assert.equal(
			limitsOf('JP').some((limit) => limit.limit === '60.0'),
			false
		);
	});
});
