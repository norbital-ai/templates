// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import payrollRuns from '../src/data/collection/payroll_runs/+collection.ts';
import {
	COMPANY_ID,
	contributionSchemes,
	createStatutoryWorld,
	settingsIdOn,
	settingsVersions
} from './fixtures/statutory-world.ts';
import { runTransform } from './helpers/ctx.ts';

const SH = 'CN-shanghai';
const KM = 'CN-kunming';
const WUHUA = '云南省/昆明市/五华区';

function world(code, worksite) {
	return createStatutoryWorld({
		code,
		period: '2025-12',
		region: code === SH ? 'SHANGHAI' : 'CATEGORY_I',
		companyFacts: { injury_rate: 0.2, housing_fund_rate: 7, housing_fund_supplementary_rate: 0 },
		people: [
			{
				key: 'CN-WORKER',
				wage: 10_000,
				worksite,
				registrations: {
					PENSION: { kind: 'REGISTERED', elections: { contribution_base: 10_000 } },
					HOUSING_FUND: { kind: 'REGISTERED', elections: { contribution_base: 10_000 } }
				}
			}
		]
	});
}

const create = (tables) =>
	runTransform(payrollRuns, [{ company_id: COMPANY_ID, period: '2025-12' }], { tables });

test('saved CN payroll refuses a missing or out-of-profile worksite before writing a run', async () => {
	await assert.rejects(create(world(SH, null)), /CN-WORKER.*unrecorded worksite/);
	await assert.rejects(create(world(SH, WUHUA)), /CN-WORKER.*worksite "云南省\/昆明市\/五华区"/);
	await assert.rejects(create(world(KM, 'SHANGHAI')), /CN-WORKER.*worksite "SHANGHAI"/);
	await assert.rejects(create(world(SH, 'SHANGHAI/UNKNOWN')), /cannot price.*SHANGHAI\/UNKNOWN/);
});

test('saved CN payroll checks the worksite on each salary day, including a move within the window', async () => {
	const tables = world(SH, WUHUA);
	const first = tables.employment_terms[0];
	first.effective_range = { start: '2015-01-01', end: '2025-12-09' };
	tables.employment_terms.push({
		...first,
		id: 'b0000000-0000-4000-8000-000000000099',
		worksite: 'SHANGHAI',
		effective_range: { start: '2025-12-10', end: null }
	});
	await assert.rejects(create(tables), /CN-WORKER.*2025-12-01.*worksite "云南省\/昆明市\/五华区"/);
});

test('saved CN payroll refuses prior-month overtime at a foreign worksite', async () => {
	const tables = world(SH, 'SHANGHAI');
	const first = tables.employment_terms[0];
	first.effective_range = { start: '2015-01-01', end: '2025-11-24' };
	tables.employment_terms.push({
		...first,
		id: 'b0000000-0000-4000-8000-000000000098',
		worksite: WUHUA,
		effective_range: { start: '2025-11-25', end: '2025-11-25' }
	});
	tables.employment_terms.push({
		...first,
		id: 'b0000000-0000-4000-8000-000000000099',
		worksite: 'SHANGHAI',
		effective_range: { start: '2025-11-26', end: null }
	});
	tables.work_days.push({
		id: 'wd-cn-cross-city-2025-11-25',
		employment_id: tables.employments[0].id,
		work_date: '2025-11-25',
		shift_definition_id: null,
		worked_intervals: [{ start: '2025-11-25T18:00:00+08:00', end: '2025-11-25T21:00:00+08:00' }],
		approved_overtime_hours: 3,
		requested_by: null,
		approval_id: null
	});
	await assert.rejects(create(tables), /CN-WORKER.*2025-11-25.*五华区/);
});

test('saved CN payroll still accepts a proved worksite in the selected city', async () => {
	const [run] = await create(world(SH, 'SHANGHAI'));
	assert.equal(run.settings_id, settingsIdOn(SH, '2025-12-20'));
	assert.equal(run.payslips.create.length, 1);
});

test('saved CN payroll checks historical worksites for a post-exit payment', async () => {
	const postExit = (worksite) => {
		const tables = createStatutoryWorld({
			code: SH,
			period: '2025-12',
			region: 'SHANGHAI',
			companyFacts: {
				injury_rate: 0.2,
				housing_fund_rate: 7,
				housing_fund_supplementary_rate: 0
			},
			people: [
				{
					key: 'CN-LEAVER',
					wage: 10_000,
					worksite,
					exit_date: '2025-11-15',
					registrations: {
						PENSION: { kind: 'REGISTERED', elections: { contribution_base: 10_000 } },
						HOUSING_FUND: { kind: 'REGISTERED', elections: { contribution_base: 10_000 } }
					}
				}
			]
		});
		const bonus = tables.adhoc_catalogue.find(
			(row) => row.code === 'BONUS' && row.settings_id === settingsIdOn(SH, '2025-12-05')
		);
		tables.adhoc_requests.push({
			id: 'd0000000-0000-4000-8000-000000000002',
			employment_id: tables.employments[0].id,
			catalogue_id: bonus.id,
			amount: 1000,
			event_date: '2025-12-05',
			pay_period: null,
			payslip_id: null,
			reason: 'Earned bonus settled after exit',
			evidence_file: null,
			as_adjustment_entry: false,
			approval_id: null
		});
		return tables;
	};
	await assert.rejects(create(postExit(WUHUA)), /CN-LEAVER.*post-exit payment.*worksite/);
	const [run] = await create(postExit('SHANGHAI'));
	assert.equal(run.payslips.create.length, 1);
});

test('saved Kunming payroll cannot reuse Shanghai pension or fund declarations by scheme code', async () => {
	const shanghaiVersion = settingsVersions(SH).find(
		(row) => row.id === settingsIdOn(SH, '2025-12-20')
	);
	for (const code of ['PENSION', 'HOUSING_FUND']) {
		const tables = world(KM, WUHUA);
		const shanghaiScheme = contributionSchemes(SH).find(
			(row) => row.settings_id === shanghaiVersion.id && row.code === code
		);
		tables.jurisdiction_settings.push(shanghaiVersion);
		tables.statutory_contributions.push(shanghaiScheme);
		const localSchemeIds = new Set(
			tables.statutory_contributions
				.filter((row) => row.code === code && row.settings_id !== shanghaiVersion.id)
				.map((row) => row.id)
		);
		const foreignFact = tables.employment_statutory_facts.find((fact) =>
			localSchemeIds.has(fact.statutory_contribution_id)
		);
		for (let index = tables.employment_statutory_facts.length - 1; index >= 0; index--)
			if (localSchemeIds.has(tables.employment_statutory_facts[index].statutory_contribution_id))
				tables.employment_statutory_facts.splice(index, 1);
		tables.employment_statutory_facts.push({
			...foreignFact,
			id:
				code === 'PENSION'
					? 'f0000000-0000-4000-8000-000000000010'
					: 'f0000000-0000-4000-8000-000000000011',
			statutory_contribution_id: shanghaiScheme.id
		});
		await assert.rejects(create(tables), new RegExp(`${code}:.*contribution base.*required`, 'i'));
	}
});
