// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Every record form of the org settings offers every field its collection lets a person write, except the few that are
 * written elsewhere on purpose: the kiosk face lifecycle (the enrolment action), the member link, a version's seal
 * columns (the Settings timeline) and its clone provenance, the encashment stamps (the exit automations), a holiday's
 * import source, the entity's Google source (its Holidays tab). A form that silently drops a writable field is a behaviour nobody can reach.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const fields = (...paths) =>
	new Set(
		paths.flatMap((path) => {
			const source = read(path);
			return [
				...[...source.matchAll(/<Field\s[^>]*?name="([a-z0-9_]+)"|<(EmploymentField)\b/gs)].map(
					(m) => (m[2] ? 'employment_id' : m[1])
				),
				...[...source.matchAll(/<Field\b[^>]*\baddress="([a-z0-9_]+)"/gs)].map((m) => m[1]),
				// A field rendered through a snippet that forwards its name to `<Field {name}>`.
				...[...source.matchAll(/\{@render coded\('([a-z0-9_]+)'/g)].map((m) => m[1])
			];
		})
	);
const writable = async (collection) => {
	const spec = (await import(`../src/data/collection/${collection}/+collection.ts`)).default.spec;
	return [
		...new Set([...(spec.create?.input.columns ?? []), ...(spec.update?.input.columns ?? [])])
	];
};
const FORMS = {
	companies: [['data/collection/companies/+representation.svelte'], ['holiday_source']],
	company_facts: [['data/collection/company_facts/+representation.svelte'], []],
	employees: [
		['data/collection/employees/+representation.svelte'],
		[
			'user_id',
			'face_embedding',
			'face_photo',
			'face_enrollment_status',
			'face_consent_at',
			'face_enrolled_at',
			'face_last_match_at',
			'face_match_count'
		]
	],
	employments: [
		['lib/ui/contract/contract-detail.svelte'],
		['encashment_due_on', 'encashment_raised_at']
	],
	employment_terms: [['lib/ui/contract/terms-fields.svelte'], []],
	employment_wage_periods: [['data/collection/employment_wage_periods/+representation.svelte'], []],
	employment_statutory_facts: [
		['data/collection/employment_statutory_facts/+representation.svelte'],
		[]
	],
	jurisdiction_settings: [
		['data/collection/jurisdiction_settings/+representation.svelte'],
		['sealed_at', 'voided_at', 'void_reason', 'cloned_from_id']
	],
	jurisdiction_holidays: [
		['data/collection/jurisdiction_holidays/+representation.svelte'],
		['source']
	]
};

test('each org-settings record form offers every writable field but those written elsewhere on purpose', async () => {
	for (const [collection, [paths, elsewhere]] of Object.entries(FORMS)) {
		const offered = fields(...paths);
		const missing = (await writable(collection)).filter(
			(field) => !offered.has(field) && !elsewhere.includes(field)
		);
		assert.deepEqual(missing, [], collection);
	}
});

test('a hire names the person, the entity, the number, the pay destination and the stint', () => {
	assert.deepEqual([...fields('lib/ui/contract/hire-form.svelte')].toSorted(), [
		'bank',
		'company_id',
		'effective_range',
		'employee_id',
		'employee_number'
	]);
});

test('residency is a contract term, never a personal fact', async () => {
	const person = (await import('../src/data/model/employees/+model.ts')).default;
	const terms = (await import('../src/data/model/employment_terms/+model.ts')).default;
	assert.equal('residency_status' in person.fields, false);
	assert.deepEqual(terms.fields.residency_status.values, [
		'CITIZEN',
		'PERMANENT_RESIDENT',
		'FOREIGNER'
	]);
	assert.ok(fields('lib/ui/contract/terms-fields.svelte').has('residency_status'));
});
