// Derived materialisation for the public seed's 2026 leave carry-forward rows.
//
// The 2026 `CARRY_FORWARD` rows in `tests/fixtures/seed/leave_requests.json` are never hand-typed:
// this script derives them by running the same closing arithmetic `process_leave_year` posts from
// (`closingBalance` over the seed's 2025 events, capped by the seed leave type's carry policy)
// and rewrites that fixture with the derived rows merged in by id. Re-run after any seed change:
//
// ```
// cd templates/hr-payroll
// node scripts/materialize-leave-carry.mjs
// ```
//
// Only pure engine modules are loaded (through Vite's SSR module graph, as the verify scripts do);
// nothing here touches a database. Rows for employments hired in 2026 are not emitted: the close
// only posts for employments active on the last day of the previous leave year.

import { createServer } from 'vite';
import { Effect } from 'effect';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const seedDirectory = path.join(root, 'tests', 'fixtures', 'seed');
const leaveRequestsPath = path.join(seedDirectory, 'leave_requests.json');

const readSeed = (name) => JSON.parse(readFileSync(path.join(seedDirectory, name), 'utf8'));

// repository-health:allow EFF3 -- This standalone Node entry must await Vite's asynchronous SSR module graph before running its synchronous materialisation.
const modules = await Effect.runPromise(
	Effect.acquireUseRelease(
		Effect.tryPromise(() =>
			createServer({
				root,
				configFile: false,
				logLevel: 'error',
				server: { middlewareMode: true, hmr: false }
			})
		),
		(server) => {
			const load = (name) =>
				Effect.tryPromise(() =>
					server.ssrLoadModule(`/src/collections/payroll_runs/lib/${name}.ts`)
				);
			return Effect.all([load('leave'), load('dates'), load('effective')]);
		},
		(server) => Effect.tryPromise(() => server.close())
	)
);
const [
	{ closingBalance, policyCarryExpiry, resolveEntitlement, yearWindow },
	{ dateKey },
	{ coversDate }
] = modules;

const LEAVE_YEAR = 2026;
const CARRY_ROW_IDS = [
	'ffffffff-ffff-4fff-8fff-fffffffffff5',
	'ffffffff-ffff-4fff-8fff-fffffffffff6',
	'ffffffff-ffff-4fff-8fff-fffffffffff7'
];

const companies = readSeed('companies.json');
const employments = readSeed('employments.json');
const leaveTypes = readSeed('leave_types.json');
const jurisdictions = readSeed('jurisdictions.json');
const leaveRequests = readSeed('leave_requests.json');

const toDay = (instant) => (instant == null ? null : dateKey(String(instant)));

const asLedger = (requests) =>
	requests.flatMap((request) => {
		const event = request.event;
		if (event == null) return [];
		if (event.kind === 'TIME_OFF') {
			return [
				{
					id: request.id,
					leave_type_id: request.leave_type_id,
					entry_date: event.range.start.date,
					through_date: event.range.end.date,
					kind: 'TAKEN',
					days: -Math.abs(event.chargeable_days ?? 0),
					source_id: request.id,
					approval_id: null
				}
			];
		}
		if (event.kind === 'BALANCE_ADJUSTMENT' || event.kind === 'ENCASHMENT') {
			return [
				{
					id: request.id,
					leave_type_id: request.leave_type_id,
					entry_date: event.effective_on,
					kind: event.kind === 'BALANCE_ADJUSTMENT' ? 'ADJUSTMENT' : 'ENCASHMENT',
					days: event.movement_days,
					source_id: event.source_id,
					approval_id: null
				}
			];
		}
		return [];
	});

const derived = [];
for (const company of companies) {
	const startMonth = company.leave_year_start_month;
	const previousEnd = yearWindow(LEAVE_YEAR - 1, startMonth).end;
	const yearStart = yearWindow(LEAVE_YEAR, startMonth).start;
	const profile = jurisdictions.find((row) => row.id === company.jurisdiction_id);
	if (profile == null) throw new Error(`Company ${company.name} has no jurisdiction row.`);
	const bankedTypes = leaveTypes.filter(
		(type) =>
			type.company_id === company.id &&
			type.statutory_profile_id === profile.id &&
			type.accrual != null &&
			type.accrual.kind !== 'PER_EVENT' &&
			type.accrual.carry != null
	);
	const active = employments
		.filter(
			(employment) =>
				employment.company_id === company.id && coversDate(employment.effective_range, previousEnd)
		)
		.toSorted((left, right) => left.employee_number.localeCompare(right.employee_number));
	for (const employment of active) {
		const hireDate = toDay(employment.hire_date);
		if (hireDate == null)
			throw new Error(`Employment ${employment.employee_number} has no hire date.`);
		const ledger = asLedger(
			leaveRequests.filter((request) => request.employment_id === employment.id)
		);
		for (const type of bankedTypes) {
			const balanceInput = {
				leaveType: type,
				entitlementAt: (serviceMonths, asOf) =>
					resolveEntitlement({
						leaveType: type,
						profile,
						children: [],
						serviceMonths,
						employmentId: employment.id,
						asOf
					}),
				hireDate,
				exitDate: toDay(employment.exit_date),
				leaveYearStartMonth: startMonth,
				ledger,
				basis: 'SETTLED'
			};
			const closing = closingBalance(balanceInput, LEAVE_YEAR - 1);
			const limit = type.accrual.carry.limit_days;
			const movement = closing.closing < 0 ? 0 : Math.min(Math.max(0, limit), closing.closing);
			const rowId = CARRY_ROW_IDS[derived.length % CARRY_ROW_IDS.length];
			if (derived.some((row) => row.id === rowId))
				throw new Error(`Carry row id ${rowId} is already used; extend CARRY_ROW_IDS.`);
			derived.push({
				id: rowId,
				employment_id: employment.id,
				leave_type_id: type.id,
				event: {
					kind: 'CARRY_FORWARD',
					leave_year: LEAVE_YEAR,
					effective_on: yearStart,
					movement_days: movement,
					expires_on: policyCarryExpiry(balanceInput, LEAVE_YEAR),
					forfeited_days: Math.max(0, closing.closing - movement),
					closing: {
						entitlement: closing.entitlement,
						carried_in: closing.carried_in,
						accrued: closing.accrued,
						adjusted: closing.adjusted,
						taken: closing.taken,
						encashed: closing.encashed,
						expired: closing.expired,
						closing: closing.closing
					},
					statutory_profile_id: profile.id
				}
			});
		}
	}
}

const derivedIds = new Set(derived.map((row) => row.id));
const merged = [
	...leaveRequests.filter((request) => !derivedIds.has(request.id)),
	...derived.toSorted(
		(left, right) =>
			left.employment_id.localeCompare(right.employment_id) ||
			left.leave_type_id.localeCompare(right.leave_type_id) ||
			left.id.localeCompare(right.id)
	)
];
writeFileSync(leaveRequestsPath, `${JSON.stringify(merged, null, '\t')}\n`);
console.log(
	`materialize-leave-carry: ${derived.length} carry-forward row(s) for ${LEAVE_YEAR}: ` +
		derived.map((row) => `${row.employment_id} ${row.event.movement_days}d`).join(', ')
);
