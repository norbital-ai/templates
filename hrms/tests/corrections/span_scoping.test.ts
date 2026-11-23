// Query scoping and reuse in the amendment span: a far-back point edit skips un-recalculated tax years, does not widen
// other amended people's reads, reuses already-loaded company/person tables, and bounds company-wide write checks.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { amendedRun } from '../../src/data/model/payroll_run/service/amended.ts';
import { amendmentsOf } from '../../src/data/model/payroll_run/service/amendments.ts';
import { loadRun } from '../../src/data/model/payroll_run/service/run_calculation.ts';
import { jsonObject, type JsonObject } from '../../src/lib/foundation.ts';
import { idOf, objectValue, type Reader } from '../../src/lib/reads.ts';
import { claimAt, claimed, pay, rostered, run, carriedFor } from '../amendment_kit.ts';
import {
	ENTITY,
	PAY_GROUP,
	storedQuery,
	storedReader,
	uuid,
	withSecond,
	workspace
} from '../kit.ts';

const FIRST_EMPLOYEE = uuid(4);
const SECOND_EMPLOYEE = uuid(904);
const SECOND_EMPLOYMENT = uuid(906);

const recordReads = (base: Reader) => {
	const requests: JsonObject[] = [];
	const reader: Reader = (request) => {
		requests.push(jsonObject(request));
		return base(request);
	};
	return { requests, reader };
};

describe('amendment read scoping', () => {
	it.live(
		'amendmentsOf bounds point-in-time company edits to ±62 days (+ unpaid runs) and scopes pay_amendment to the entity',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-01');
				yield* pay(t, '2028-01');
				const { requests, reader } = recordReads(storedReader(t));
				yield* amendmentsOf(reader, [{ entity: ENTITY, from: '2026-01-15', to: '2026-01-15' }]);
				const [req] = requests;
				assert.ok(req !== undefined);
				const payslipWhere = objectValue(objectValue(req.payslip).where);
				assert.ok(Array.isArray(payslipWhere.or), 'uses bounded span OR unpaid runs');
				const [bounded, unpaid] = payslipWhere.or.map(objectValue);
				const boundedOverlaps = objectValue(
					objectValue(objectValue(bounded?.payroll_run_id).is).salary_coverage
				).overlaps;
				assert.equal(objectValue(boundedOverlaps).from, '2025-11-14');
				assert.equal(objectValue(boundedOverlaps).to, '2026-03-18');
				assert.equal(
					objectValue(objectValue(objectValue(unpaid?.payroll_run_id).is).state).eq,
					'UNPAID'
				);
				const amendmentWhere = objectValue(objectValue(req.pay_amendment).where);
				assert.deepEqual(
					objectValue(objectValue(objectValue(amendmentWhere.pay_group_id).is).entity_id).in,
					[idOf('entity', ENTITY)]
				);

				// a single-employee span narrows both payslip and pay_amendment to that employee
				const single = recordReads(storedReader(t));
				yield* amendmentsOf(single.reader, [
					{ entity: ENTITY, employee: FIRST_EMPLOYEE, from: '2026-01-15', to: '2026-01-15' }
				]);
				const singlePayslipWhere = objectValue(objectValue(single.requests[0]?.payslip).where);
				assert.deepEqual(objectValue(singlePayslipWhere.employee_id).in, [
					idOf('employee_profile', FIRST_EMPLOYEE)
				]);
			}).pipe(Effect.provide(workspace({ seed: rostered([]), now: '2028-01-20T02:00:00.000Z' })))
	);

	it.live(
		'a 2-year-old point edit skips un-recalculated intermediate years and reuses own-run tables',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const made = yield* claimed(t, 120, '2026-01-15');
				for (const month of ['2026-01', '2026-12', '2027-06', '2027-12']) yield* pay(t, month);
				yield* (yield* t.as(t.admin)).act({
					'claim_catalog_entry.delete': [{ target: yield* claimAt(t, made) }]
				});
				yield* t.run_due();

				const stored = storedReader(t);
				const known = yield* storedQuery(t, {
					payroll_run: { where: { entity_id: { eq: idOf('entity', ENTITY) } }, limit: 100 },
					pay_group: { where: { entity_id: { eq: idOf('entity', ENTITY) } }, limit: 100 },
					pay_amendment: { where: { payroll_run_id: { is_null: true } }, limit: 100 },
					entity: { where: { id: { eq: idOf('entity', ENTITY) } }, limit: 10 }
				});
				const ownRow: JsonObject = {
					entity_id: ENTITY,
					pay_group_id: PAY_GROUP,
					period: '2028-01',
					kind: 'ON_CYCLE',
					pay_date: '2028-01-25',
					salary_coverage: { from: '2028-01-01', to: '2028-01-31' }
				};
				const frame = { attendance: { from: '2028-01-01', to: '2028-01-31' } };
				const ownData = yield* loadRun(stored, ownRow, frame, 'MY');
				const { requests, reader } = recordReads(stored);
				yield* amendedRun(
					reader,
					{ id: uuid(777), row: ownRow, frame, data: ownData },
					{
						runs: known.payroll_run.rows.map((r) => jsonObject(r)),
						groups: known.pay_group.rows.map((r) => jsonObject(r)),
						amendments: known.pay_amendment.rows.map((r) => jsonObject(r)),
						entities: known.entity.rows.map((r) => jsonObject(r)),
						recovered: new Set()
					}
				);

				const spanReq = requests.find((req) => 'roster_entry' in req);
				assert.ok(spanReq !== undefined, 'loadSpan ran');
				// already-loaded company and on-cycle person tables are reused, not re-queried
				for (const reused of [
					'work_event',
					'shift_definition',
					'shift_pattern',
					'holiday',
					'dependant',
					'employee_balance'
				])
					assert.equal(reused in spanReq, false, `${reused} is reused from own run`);
				// entry window stops at the end of 2026 rather than spanning all of 2027
				const rosterWhere = objectValue(objectValue(spanReq.roster_entry).where);
				const workDate = objectValue(rosterWhere.work_date);
				assert.equal(workDate.gte, '2026-01-01');
				assert.equal(workDate.lte, '2026-12-31');

				// end-to-end run still carries the exact 2026-01 difference
				yield* run(t, '2028-01');
				assert.deepEqual(yield* carriedFor(t, '2028-01', '2026-01'), {
					'MEDICAL_CLAIM/EMPLOYEE': -120
				});
			}).pipe(Effect.provide(workspace({ seed: rostered([]), now: '2028-01-20T02:00:00.000Z' })))
	);

	it.live(
		'mixed horizons bucket loadSpan per person so a 2-year-old edit does not widen a recent edit',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const oldClaim = yield* claimed(t, 120, '2026-01-15');
				// second employee has a claim in 2027-12
				yield* (yield* t.as(t.admin)).act({
					'claim_catalog_entry.create': [
						{
							entity_id: idOf('entity', ENTITY),
							employment_id: idOf('employment', SECOND_EMPLOYMENT),
							catalog_code: 'MEDICAL_CLAIM',
							quantity: '80',
							incurred_on: '2027-12-15'
						}
					]
				});
				yield* t.run_due();
				const { claim_catalog_entry } = yield* storedQuery(t, {
					claim_catalog_entry: { limit: 10 }
				});
				const recentClaim = claim_catalog_entry.rows.find(
					(row) => row.employment_id === SECOND_EMPLOYMENT
				);
				assert.ok(recentClaim !== undefined);

				for (const month of ['2026-01', '2026-12', '2027-06', '2027-12']) yield* pay(t, month);
				yield* (yield* t.as(t.admin)).act({
					'claim_catalog_entry.delete': [
						{ target: yield* claimAt(t, oldClaim) },
						{ target: yield* claimAt(t, recentClaim.id) }
					]
				});
				yield* t.run_due();

				const stored = storedReader(t);
				const known = yield* storedQuery(t, {
					payroll_run: { where: { entity_id: { eq: idOf('entity', ENTITY) } }, limit: 100 },
					pay_group: { where: { entity_id: { eq: idOf('entity', ENTITY) } }, limit: 100 },
					pay_amendment: { where: { payroll_run_id: { is_null: true } }, limit: 100 },
					entity: { where: { id: { eq: idOf('entity', ENTITY) } }, limit: 10 }
				});
				const ownRow: JsonObject = {
					entity_id: ENTITY,
					pay_group_id: PAY_GROUP,
					period: '2028-01',
					kind: 'ON_CYCLE',
					pay_date: '2028-01-25',
					salary_coverage: { from: '2028-01-01', to: '2028-01-31' }
				};
				const frame = { attendance: { from: '2028-01-01', to: '2028-01-31' } };
				const ownData = yield* loadRun(stored, ownRow, frame, 'MY');
				const { requests, reader } = recordReads(stored);
				yield* amendedRun(
					reader,
					{ id: uuid(778), row: ownRow, frame, data: ownData },
					{
						runs: known.payroll_run.rows.map((r) => jsonObject(r)),
						groups: known.pay_group.rows.map((r) => jsonObject(r)),
						amendments: known.pay_amendment.rows.map((r) => jsonObject(r)),
						entities: known.entity.rows.map((r) => jsonObject(r)),
						recovered: new Set()
					}
				);

				const spanReq = requests.find((req) => 'roster_entry' in req);
				assert.ok(spanReq !== undefined);
				const rosterOr = objectValue(objectValue(spanReq.roster_entry).where).or;
				assert.ok(Array.isArray(rosterOr) && rosterOr.length === 2, 'two separate entry buckets');
				const [firstBucket, secondBucket] = rosterOr.map(objectValue);
				assert.deepEqual(objectValue(firstBucket?.work_date), {
					gte: '2026-01-01',
					lte: '2026-12-31'
				});
				assert.deepEqual(objectValue(secondBucket?.work_date), {
					gte: '2027-12-01',
					lte: '2027-12-31'
				});
				const payslipOr = objectValue(objectValue(spanReq.payslip).where).or;
				assert.ok(
					Array.isArray(payslipOr) && payslipOr.length === 2,
					'two separate balance buckets'
				);
				const secondPayslipBranch = payslipOr
					.map(objectValue)
					.find((branch) => JSON.stringify(branch.employee_id).includes(SECOND_EMPLOYEE));
				const dec2027 = known.payroll_run.rows.find((row) => row.period === '2027-12');
				assert.ok(dec2027 !== undefined);
				assert.equal(
					objectValue(objectValue(objectValue(secondPayslipBranch?.payroll_run_id).is).pay_date)
						.gte,
					dec2027.pay_date,
					'recent employee only unwinds from 2027-12, not 2026-01'
				);

				// end-to-end run carries both people's exact differences
				yield* run(t, '2028-01');
				assert.deepEqual(yield* carriedFor(t, '2028-01', '2026-01', FIRST_EMPLOYEE), {
					'MEDICAL_CLAIM/EMPLOYEE': -120
				});
				assert.deepEqual(yield* carriedFor(t, '2028-01', '2027-12', SECOND_EMPLOYEE), {
					'MEDICAL_CLAIM/EMPLOYEE': -80
				});
			}).pipe(
				Effect.provide(
					workspace({ seed: withSecond(rostered([]), false), now: '2028-01-20T02:00:00.000Z' })
				)
			)
	);
});
