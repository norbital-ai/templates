/**
 * Compliance closure probes — Singapore (2026-09-29 pass).
 *
 * SG-SHG01 (docs/inventory/singapore.md): "Other mixed-race combinations, rate bands, opt-outs,
 * corrections and paid/remitted output remain open." The SINDA limb is probed here: CPF Act 1953
 * s.76(3) requires the deduction from "an employee who belongs to that community" and s.2 defines
 * an employee as any person employed in Singapore; SINDA Rules 1992 r.2 sets no residency
 * condition, so an S Pass or Work Permit holder of any Indian-community race pays SINDA whatever
 * the pass. CDAC Rules 1992 r.2 and the Eurasian Association Rules 1995 r.2 confine their
 * communities to citizens and permanent residents, so a foreign employee pays neither.
 *
 * Figures are the funds' own published wage-band amounts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	expectStatutory,
	expectStatutorySkipped
} from './fixtures/statutory-world.ts';

test('SG-SHG01 — SINDA follows the Indian-community race, not the pass; CDAC and ECF stay resident-only', () => {
	const book = assessStatutory({
		code: 'SG',
		period: '2026-01',
		people: [
			{
				key: 'SPASS-TAMIL',
				wage: 3000,
				age: 30,
				citizenship: 'FOREIGNER',
				race: 'TAMIL',
				pass_type: 'S_PASS'
			},
			{
				key: 'WP-SIKH',
				wage: 3000,
				age: 30,
				citizenship: 'FOREIGNER',
				race: 'SIKH',
				pass_type: 'WORK_PERMIT'
			},
			{
				key: 'SPASS-CHINESE',
				wage: 3000,
				age: 30,
				citizenship: 'FOREIGNER',
				race: 'CHINESE',
				pass_type: 'S_PASS'
			},
			{
				key: 'EP-EURASIAN',
				wage: 3000,
				age: 30,
				citizenship: 'FOREIGNER',
				race: 'EURASIAN',
				pass_type: 'EMPLOYMENT_PASS'
			}
		]
	});
	// SINDA Rules 1992 r.2: every Indian-community race, no residency condition — the S Pass and
	// Work Permit holders pay the $7 band at $3,000.
	expectStatutory(book, 'SPASS-TAMIL', 'SINDA', 7, 0);
	expectStatutory(book, 'WP-SIKH', 'SINDA', 7, 0);
	// CDAC/ECF Rules r.2 cover citizens and permanent residents only: the foreign employees pay no
	// Chinese or Eurasian fund, and a Chinese race is not SINDA's community.
	expectStatutorySkipped(book, 'SPASS-CHINESE', 'CDAC');
	expectStatutorySkipped(book, 'SPASS-CHINESE', 'SINDA');
	expectStatutorySkipped(book, 'EP-EURASIAN', 'ECF');
	assert.equal(
		book.get('SPASS-CHINESE')?.has('SINDA') ?? false,
		false,
		'no SINDA row for a Chinese race'
	);
});
