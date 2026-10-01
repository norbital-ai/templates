// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * One CN lineage, two cities: the worksite each terms row records is the contract performance place
 * (劳动合同法实施条例 art.14), and its locality (MINIMUM_WAGE.locality) selects the city law that prices
 * the day. An unrecorded worksite refuses by name; a worksite no city covers cannot be priced.
 * Social insurance and the housing fund follow where the employer is registered
 * (`si_registration_locality`, else the company region; owner-delegated rule 2026-10-01).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import payrollRuns from '../src/data/collection/payroll_runs/+collection.ts';
import { COMPANY_ID, createStatutoryWorld, settingsIdOn } from './fixtures/statutory-world.ts';
import { runTransform } from './helpers/ctx.ts';

const SH = 'CN-shanghai';
const WUHUA = '云南省/昆明市/五华区';
const REGISTERED = {
	PENSION: { kind: 'REGISTERED', elections: { contribution_base: 10_000 } },
	HOUSING_FUND: { kind: 'REGISTERED', elections: { contribution_base: 10_000 } }
};

function world(people, company = {}) {
	return createStatutoryWorld({
		code: SH,
		period: '2025-12',
		region: company.region,
		companyFacts: {
			injury_rate: 0.2,
			housing_fund_rate: 7,
			housing_fund_supplementary_rate: 0,
			...company.facts
		},
		people: people.map(([key, worksite, wage = 10_000]) => ({
			key,
			wage,
			worksite,
			registrations: REGISTERED
		}))
	});
}

const create = (tables) =>
	runTransform(payrollRuns, [{ company_id: COMPANY_ID, period: '2025-12' }], { tables });

const charge = (run, key, code) => {
	const employment = run.payslips.create.find((slip) => slip.employee_number === key);
	const row = (employment ?? run.payslips.create[0]).statutory.find(
		(item) => item.scheme_code === code
	);
	return row == null ? null : [row.employee_amount, row.employer_amount];
};

test('saved CN payroll refuses an unrecorded or uncovered worksite before writing a run', async () => {
	await assert.rejects(create(world([['CN-WORKER', null]])), /CN-WORKER: record the worksite/);
	await assert.rejects(
		create(world([['CN-WORKER', 'SHANGHAI/UNKNOWN']])),
		/cannot price.*SHANGHAI\/UNKNOWN/
	);
});

test('social insurance follows the registration city, the minimum wage the worksite', async () => {
	// December 2025 on a declared 10,000: pension 16% / 8% in both cities; medical 9% employer in
	// Shanghai (沪医保规〔2025〕2号), 7% and maternity 0.9% in Kunming (CN-KM04, KM32); fund 7% each side.
	for (const [label, company, worksite, medical, maternity] of [
		['Shanghai unit, Shanghai site', {}, 'SHANGHAI', [200, 900], null],
		['Shanghai unit, Kunming site', {}, WUHUA, [200, 900], null],
		[
			'Kunming-registered unit, Kunming site',
			{ facts: { si_registration_locality: 'KUNMING' } },
			WUHUA,
			[200, 700],
			[0, 90]
		]
	]) {
		const [run] = await create(world([['CN-W', worksite]], company));
		assert.equal(run.settings_id, settingsIdOn(SH, '2025-12-20'));
		assert.deepEqual(charge(run, 'CN-W', 'PENSION'), [800, 1600], label);
		assert.deepEqual(charge(run, 'CN-W', 'MEDICAL'), medical, label);
		assert.deepEqual(charge(run, 'CN-W', 'HOUSING_FUND'), [700, 700], label);
		const maternityLine = charge(run, 'CN-W', 'MATERNITY');
		assert.deepEqual(
			maternityLine == null || (maternityLine[0] === 0 && maternityLine[1] === 0)
				? null
				: maternityLine,
			maternity,
			label
		);
	}
	// The Shanghai-insured worker posted to Wuhua is held to Kunming's 2,170 gross, not Shanghai's 2,740.
	const [posted] = await create(world([['CN-W', WUHUA, 2_200]]));
	assert.deepEqual(charge(posted, 'CN-W', 'PENSION'), [800, 1600]);
	await assert.rejects(create(world([['CN-W', WUHUA, 2_100]])), /MINIMUM_WAGE_BELOW.*2170/);
});

test('a company region naming no locality refuses until the registration city is recorded', async () => {
	await assert.rejects(
		create(world([['CN-W', WUHUA]], { region: 'CATEGORY_I' })),
		/CN-W: PENSION: .*si_registration_locality/
	);
	const [run] = await create(
		world([['CN-W', WUHUA]], {
			region: 'CATEGORY_I',
			facts: { si_registration_locality: 'KUNMING' }
		})
	);
	assert.deepEqual(charge(run, 'CN-W', 'MEDICAL'), [200, 700]);
});

test('saved CN payroll refuses a move between cities inside one pay window', async () => {
	const tables = world([['CN-WORKER', WUHUA]]);
	const first = tables.employment_terms[0];
	first.effective_range = { start: '2015-01-01', end: '2025-12-09' };
	tables.employment_terms.push({
		...first,
		id: 'b0000000-0000-4000-8000-000000000099',
		worksite: 'SHANGHAI',
		effective_range: { start: '2025-12-10', end: null }
	});
	await assert.rejects(
		create(tables),
		/CN-WORKER: A workplace or wage class change inside one pay window/
	);
});

test('saved CN payroll checks historical worksites for a post-exit payment', async () => {
	const postExit = (worksite) => {
		const tables = createStatutoryWorld({
			code: SH,
			period: '2025-12',
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
					registrations: REGISTERED
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
	await assert.rejects(create(postExit(null)), /CN-LEAVER: record the worksite/);
	await assert.rejects(
		create(postExit('SHANGHAI/UNKNOWN')),
		/CN-LEAVER.*post-exit payment.*worksite/
	);
	for (const worksite of ['SHANGHAI', WUHUA]) {
		const [run] = await create(postExit(worksite));
		assert.equal(run.payslips.create.length, 1, worksite);
	}
});
