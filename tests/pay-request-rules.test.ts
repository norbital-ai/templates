// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import claimRequests from '../src/data/collection/claim_requests/+collection.ts';
import { runTransform } from './helpers/ctx.ts';
import { createStatutoryWorld, settingsIdOn } from './fixtures/statutory-world.ts';

// F16: a claim missing a declared request input is refused by that input's label, before the
// class's qualification rule reads it (a missing fact made the rule fail with no name, or throw).
const person = {
	key: 'SG-MED',
	wage: 3000,
	age: 30,
	citizenship: 'CITIZEN',
	hire_date: '2025-01-01'
};
const facts = {
	amount_incurred: 80,
	patient: 'EMPLOYEE',
	relationship_recognised: false,
	treatment: 'MEDICAL',
	treatment_received: true,
	treatment_necessary: true,
	solely_aesthetic: false,
	treatment_country: 'Singapore',
	practitioner_qualified: true,
	practitioner_reference: 'MCR 12345A'
};

test('a claim missing a declared input is refused by the input it lacks', async () => {
	const world = createStatutoryWorld({ code: 'SG', period: '2026-07', people: [person] });
	const catalogue = world.claim_catalogue.find(
		(row) =>
			row.settings_id === settingsIdOn('SG', '2026-07-03') &&
			row.code === 'MEDICAL_TREATMENT_REIMBURSEMENT'
	);
	const claim = {
		employment_id: world.employments[0].id,
		catalogue_id: catalogue.id,
		amount: 80,
		incurred_on: '2026-07-03',
		due_on: '2026-07-03',
		description: 'GP visit',
		evidence_file: 'receipt.pdf',
		facts
	};
	const admit = (row) => runTransform(claimRequests, [row], { tables: world });
	assert.equal((await admit(claim)).length, 1);
	// The FINDINGS #8 payload: treatment details sent outside `facts`, so none are recorded.
	await assert.rejects(
		admit({ ...claim, facts: undefined, medical_reimbursement: facts }),
		/MEDICAL_TREATMENT_REIMBURSEMENT: Amount actually incurred is required before calculation/
	);
	const { practitioner_reference: _, ...unreferenced } = facts;
	await assert.rejects(
		admit({ ...claim, facts: unreferenced }),
		/Practitioner qualification evidence is required before calculation/
	);
	// `required_when` is judged before the rule that reads the relationship start.
	await assert.rejects(
		admit({
			...claim,
			facts: { ...facts, patient: 'FOSTER_CHILD', relationship_recognised: true }
		}),
		/When the patient relationship began is required before calculation/
	);
});
