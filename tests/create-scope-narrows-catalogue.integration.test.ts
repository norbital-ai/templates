/**
 * The filed bug: `ANNUAL_LEAVE` offered five times in the leave form's picker.
 *
 * They were never duplicate rows. They were five *versions* of one lineage, offered because a
 * representation is a shared component with no page above it, so nothing narrowed its catalogue
 * picker to the version in force. `tests/create-scope.test.ts` proves the predicate's shape and
 * that all three pages provide the scope and all three forms consume it — both code facts. Neither
 * proves the thing the owner actually saw: that the list got shorter.
 *
 * This runs the predicate against a real host and counts what comes back, which also exercises the
 * half a unit test cannot reach — the predicate has to survive the decoder. A relation may only
 * enter a `where` under a quantifier, and `inForceCatalogue` builds its key by computation, so the
 * source scanner in `tests/predicate-grammar.test.ts` is blind to it: if that quantifier were ever
 * dropped, this query is what refuses.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { bearerHeaders, postGuestCommand, requireOk, rowsOf } from '@norbital-ai/test-utilities';
import { inForceCatalogue } from '../src/lib/ui/create-scope.ts';
import {
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

/**
 * A superseded sibling of the seeded version: same lineage, sealed, unvoided, and out of force.
 *
 * The seeded version runs `2020-01-01 → ∞`, so a plausible predecessor is a closed range that ends
 * the day before it opens. Overlapping ones are refused by the sealed-overlap rule, and a version
 * that could not legally exist would make this test pass on a technicality rather than on the
 * distinction it is about.
 */
const OLD_VERSION_ID = '22222222-2222-4222-8222-222222222299';
const OLD_ANNUAL_ID = 'ffffffff-ffff-4fff-8fff-ffffffffff99';
const LINEAGE = 'PUB';
const TODAY = '2026-03-10';

test(
	'a scoped catalogue picker offers the version in force, not every version of the lineage',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-create-scope-narrows');
		try {
			// Clone the settings identity from the public fixture; only the version and its span differ.
			await session.query(
				`insert into jurisdiction_settings
				   (id, code, jurisdiction_code, name, sealed_at, voided_at, void_reason, cloned_from_id, currency,
				    tax_year_start_month, utc_offset_minutes, effective_range,
				    approval_id, created_at, updated_at)
				 select $1, code, jurisdiction_code, 'Public fixture profile (superseded)', '2018-01-01T00:00:00.000Z',
				        null, null, id, currency, tax_year_start_month, utc_offset_minutes,
				        $2::jsonb, null, created_at, updated_at
				   from jurisdiction_settings where id = $3`,
				[
					OLD_VERSION_ID,
					JSON.stringify({
						start: '2018-01-01T00:00:00.000Z',
						end: '2019-12-31T00:00:00.000Z'
					}),
					JURISDICTION_ID
				]
			);
			// The same ANNUAL row, on the version nobody is governed by today. This is the second
			// `ANNUAL_LEAVE` the owner saw in their picker.
			await session.query(
				`insert into leave_catalogue
				   (id, settings_id, code, name, is_statutory, authority, eligibility,
				    requires_certificate_after_days, paid, entitlement,
				    treatments, approval_id, created_at, updated_at)
				 select $1, $2, code, name, is_statutory, authority, eligibility,
				        requires_certificate_after_days, paid, entitlement,
				        treatments, null, created_at, updated_at
				   from leave_catalogue where code = 'ANNUAL' and settings_id = $3`,
				[OLD_ANNUAL_ID, OLD_VERSION_ID, JURISDICTION_ID]
			);

			const read = async (
				where: Record<string, unknown> | undefined,
				label: string
			): Promise<ReadonlyArray<Record<string, unknown>>> =>
				rowsOf(
					requireOk(
						await postGuestCommand(
							session.host.baseUrl,
							'collections.findMany',
							{
								collection: 'leave_catalogue',
								...(where === undefined ? {} : { where }),
								columns: { id: true, code: true, settings_id: true },
								limit: 100
							},
							bearerHeaders(session.credential)
						),
						label
					),
					label
				);

			// Unscoped is what the form did before: every version of the lineage, which is the bug.
			const unscoped = await read(undefined, 'unscoped catalogue');
			const unscopedAnnual = unscoped.filter((row) => row.code === 'ANNUAL');
			assert.equal(
				unscopedAnnual.length,
				2,
				`the superseded version did not reach the unnarrowed picker: ${JSON.stringify(unscoped)}`
			);

			// Scoped is what it does now: the version in force on the day, and only that one.
			const predicate = inForceCatalogue('leave_catalogue_settings', LINEAGE, TODAY);
			assert.ok(predicate !== undefined, 'a scoped page produced no predicate');
			const scoped = await read(predicate, 'scoped catalogue');
			assert.ok(
				scoped.length > 0,
				'the scoped picker offers nothing at all, which is a different bug from offering too much'
			);
			const scopedAnnual = scoped.filter((row) => row.code === 'ANNUAL');
			assert.equal(
				scopedAnnual.length,
				1,
				`ANNUAL is still offered ${scopedAnnual.length} times: ${JSON.stringify(scoped)}`
			);
			assert.equal(
				scopedAnnual[0]?.settings_id,
				JURISDICTION_ID,
				'the row offered belongs to the version in force, not the superseded one'
			);
			for (const row of scoped) {
				assert.equal(
					row.settings_id,
					JURISDICTION_ID,
					`a superseded row survived the scope: ${JSON.stringify(row)}`
				);
			}

			/**
			 * The non-vacuous half, and the exact regression.
			 *
			 * Dropping the scope must put the duplicates back. If it does not, this test is measuring
			 * something other than the narrowing — and note the boundary `inForceCatalogue` keeps: an
			 * unscoped page gets `undefined`, never an empty predicate, so a form opened outside a
			 * scoped page is left unnarrowed rather than filtered down to nothing.
			 */
			assert.equal(inForceCatalogue('leave_catalogue_settings', undefined, TODAY), undefined);
			assert.ok(
				unscoped.length > scoped.length,
				`removing the scope must widen the list: ${unscoped.length} unscoped vs ${scoped.length} scoped`
			);
		} finally {
			await session.stop();
		}
	}
);
