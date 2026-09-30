// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import claimRequests from '../src/data/collection/claim_requests/+collection.ts';
import { runTransform } from './helpers/ctx.ts';
import { buildStatutory, createStatutoryWorld, settingsIdOn } from './fixtures/statutory-world.ts';

// CPF N12 paras.2–3 and SDL S375/2023 paras.2–3: actual necessary treatment for the employee or
// a defined dependant at payment due is outside both wage bases. IRAS reporting is a separate rule.
// The treatment facts are the class's declared request inputs (`claim_catalogue.request_facts`),
// recorded on the claim's `facts`; the day reimbursement becomes payable is the claim's `due_on`.
const person = {
	key: 'SG-MED',
	wage: 3000,
	age: 30,
	citizenship: 'CITIZEN',
	hire_date: '2025-01-01'
};
const medical = (facts = {}) => ({
	amount_incurred: 100,
	patient: 'EMPLOYEE',
	relationship_recognised: false,
	treatment: 'MEDICAL',
	treatment_received: true,
	treatment_necessary: true,
	solely_aesthetic: false,
	treatment_country: 'Singapore',
	practitioner_qualified: true,
	practitioner_reference: 'Registered practitioner evidence',
	...facts
});

function claimIn(world, due_on, facts = {}, incurred_on = `${due_on.slice(0, 7)}-01`) {
	const catalogue = world.claim_catalogue.find(
		(row) =>
			row.settings_id === settingsIdOn('SG', due_on) &&
			row.code === 'MEDICAL_TREATMENT_REIMBURSEMENT'
	);
	assert.ok(catalogue, `No sealed medical claim class on ${due_on}`);
	return {
		id: 'c0000000-0000-4000-8000-0000000000c1',
		employment_id: world.employments[0].id,
		catalogue_id: catalogue.id,
		amount: 100,
		incurred_on,
		description: 'Treatment reimbursement',
		evidence_file: 'receipt.pdf',
		due_on,
		facts: medical(facts),
		as_adjustment_entry: false,
		pay_period: null,
		payslip_id: null,
		approval_id: null
	};
}

function price(period, due_on, facts = {}, incurred_on) {
	return buildStatutory({ code: 'SG', period, people: [person] }, (world) => {
		world.claim_requests.push(claimIn(world, due_on, facts, incurred_on));
	}).slips.get(person.key);
}

test('qualified medical reimbursement follows payment due and stays outside CPF and SDL wages', () => {
	assert.deepEqual(price('2026-04', '2026-05-10', {}, '2026-04-10').adjustments, []);
	assert.equal(price('2026-05', '2026-05-10', {}, '2026-04-10').adjustments.length, 1);
	for (const [period, due] of [
		['2025-12', '2025-12-15'],
		['2026-01', '2026-01-15'],
		['2026-04', '2026-04-15'],
		['2026-07', '2026-07-15'],
		['2027-01', '2027-01-15']
	]) {
		const slip = price(period, due);
		assert.deepEqual(
			slip.adjustments.map((row) => [row.component_code, row.amount]),
			[['MEDICAL_TREATMENT_REIMBURSEMENT', 100]],
			period
		);
		assert.deepEqual(
			slip.statutory
				.filter((row) => ['CPF', 'SDL'].includes(row.scheme_code))
				.map((row) => [row.scheme_code, row.base_amount, row.employee_amount, row.employer_amount]),
			[
				['CPF', 3000, 600, 510],
				['SDL', 3000, 0, 7.5]
			],
			period
		);
	}
});

test('a mismatched treatment or dependant is refused at collection admission and in the run', async () => {
	const world = createStatutoryWorld({ code: 'SG', period: '2026-05', people: [person] });
	const valid = claimIn(world, '2026-05-10');
	assert.equal((await runTransform(claimRequests, [valid], { tables: world })).length, 1);
	await assert.rejects(
		runTransform(claimRequests, [{ ...valid, evidence_file: null }], { tables: world }),
		/requires evidence/
	);
	assert.throws(
		() =>
			buildStatutory({ code: 'SG', period: '2026-05', people: [person] }, (runWorld) => {
				runWorld.claim_requests.push({ ...claimIn(runWorld, '2026-05-10'), evidence_file: null });
			}),
		/requires a receipt or other evidence/
	);
	for (const facts of [
		{ solely_aesthetic: true },
		{ practitioner_qualified: false },
		{ amount_incurred: 99 },
		{ patient: 'OTHER', relationship_from: '2020-01-01', relationship_recognised: true },
		{
			patient: 'FOSTER_CHILD',
			relationship_from: '2020-01-01',
			relationship_through: '2026-05-09',
			relationship_recognised: true,
			relationship_reference: 'Guardianship order'
		}
	]) {
		const row = { ...valid, facts: medical(facts) };
		await assert.rejects(
			runTransform(claimRequests, [row], { tables: world }),
			/does not satisfy its claim qualification rule/
		);
		assert.throws(() => price('2026-05', '2026-05-10', facts), /qualification rule/);
	}
	await assert.rejects(
		runTransform(claimRequests, [{ ...valid, incurred_on: '2026-05-11' }], { tables: world }),
		/qualification rule/
	);
	assert.throws(() => price('2026-05', '2026-05-10', {}, '2026-05-11'), /qualification rule/);
	await assert.rejects(
		runTransform(claimRequests, [{ ...valid, pay_period: '2026-04' }], { tables: world }),
		/do not override its pay period/
	);
	assert.throws(
		() =>
			buildStatutory({ code: 'SG', period: '2026-04', people: [person] }, (runWorld) => {
				runWorld.claim_requests.push({ ...claimIn(runWorld, '2026-05-10'), pay_period: '2026-04' });
			}),
		/do not override its pay period/
	);
	const child = {
		patient: 'FOSTER_CHILD',
		relationship_from: '2020-01-01',
		relationship_through: '2026-05-10',
		relationship_recognised: true,
		relationship_reference: 'Guardianship order'
	};
	assert.equal(
		(await runTransform(claimRequests, [{ ...valid, facts: medical(child) }], { tables: world }))
			.length,
		1
	);
	assert.equal(price('2026-05', '2026-05-10', child).adjustments.length, 1);
});

test('medical claim inputs require a positive incurred amount and relationship evidence', async () => {
	const world = createStatutoryWorld({ code: 'SG', period: '2026-05', people: [person] });
	const valid = claimIn(world, '2026-05-10');
	const admit = (row) => runTransform(claimRequests, [row], { tables: world });
	await assert.rejects(
		admit({ ...valid, amount: 0, facts: medical({ amount_incurred: 0 }) }),
		/Enter the positive amount actually incurred/
	);
	// A dependant with no relationship start never qualifies (the start is what para.3 dates).
	await assert.rejects(
		admit({ ...valid, facts: medical({ patient: 'FOSTER_CHILD', relationship_recognised: true }) }),
		/does not satisfy its claim qualification rule/
	);
	await assert.rejects(
		admit({
			...valid,
			facts: medical({
				patient: 'FOSTER_CHILD',
				relationship_from: '2020-01-01',
				relationship_recognised: true
			})
		}),
		/Patient relationship evidence is required/
	);
});
