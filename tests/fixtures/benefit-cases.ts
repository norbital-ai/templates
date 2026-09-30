// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The seeded PH maternity case type (`payroll.benefit_cases:MATERNITY_LEAVE`), read from the public
 * law, so every benefit-case test prices its numbers through the configuration the template ships.
 */
import assert from 'node:assert/strict';
import { settingsVersions } from './statutory-world.ts';

export const PH_VERSIONS = settingsVersions('PH');
const declared = PH_VERSIONS.map((version) =>
	JSON.stringify(version.payroll.benefit_cases.find((row) => row.case_type === 'MATERNITY_LEAVE'))
);
// Every sealed version carries the same case type: the law it transcribes has not moved.
assert.equal(new Set(declared).size, 1);
export const MATERNITY = JSON.parse(declared[0]);

/** The tables a case write reads its lineage through: the employment, its entity and the PH versions. */
export const lineageTables = (
	employment = { id: 'contract', employee_id: 'mother', company_id: 'company' },
	settingsCode = 'PH'
) => ({
	employments: [employment],
	companies: [{ id: employment.company_id, settings_code: settingsCode }],
	jurisdiction_settings: PH_VERSIONS
});

/** A birth's event-valid solo-parent ID, as the case records it. */
export const SOLO_PARENT_ID = {
	solo_parent_claimed: true,
	solo_parent_document_kind: 'SOLO_PARENT_ID',
	solo_parent_document_issued_on: '2026-08-01',
	solo_parent_document_valid_from: '2026-08-01',
	solo_parent_document_valid_through: '2027-07-31',
	solo_parent_document_reference: 'LGU-SP-001',
	solo_parent_document_issuer_lgu: 'City LGU',
	solo_parent_social_worker_signature_seen: true,
	solo_parent_mayor_signature_seen: true
};

/** The document's file, recorded as the reference fact's evidence. */
export const soloParentFile = (caseId = 'case-1') => ({
	subject: { collection: 'benefit_cases', id: caseId },
	fact_key: 'solo_parent_document_reference',
	file: { path: 'solo-parent-id.pdf' }
});
