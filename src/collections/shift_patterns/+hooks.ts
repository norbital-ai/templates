import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { readRange } from '../payroll_runs/lib/effective.js';
import { dateKey } from '../../lib/iso-day.js';
import { addDays } from '../../lib/period.js';
import { settingsInForce } from '../../lib/jurisdiction_settings.js';
import { patternRosterCodeId } from '../../lib/scheduling/work-pattern.js';
import { rosterCodeKind, workWindow } from '../../lib/scheduling/roster-code.js';
import {
	plannedDay,
	projectedLimitBreaches,
	type RosterCodeFacts,
	type SchedulePlanDay
} from '../../lib/scheduling/work-limits.js';
import type { WorkRules } from '../../datatypes/work_rules/+definition.js';
import type { WorkPattern } from '../../datatypes/work_pattern/+definition.js';
import type { Hooks } from './$types.js';

const QUERY_LIMIT = 20_000;
/** How far a pattern is projected when the limits are judged. One full year covers every period. */
const PROJECTION_DAYS = 366;

/** The version columns this gate reads; the rest of the row is not loaded. */
type SettingsVersionRow = {
	readonly id: string;
	readonly code: string;
	readonly name: string | null;
	readonly sealed_at: string | null;
	readonly voided_at: string | null;
	readonly approval_id: string | null;
	readonly effective_range: unknown;
	readonly work_rules?: {
		readonly limits?: WorkRules['limits'];
		readonly authority?: string | null;
	} | null;
};

/**
 * A pattern write is a schedule write: its cycle is the base every employment on it projects, and
 * a cycle that breaches a jurisdiction's hour ceilings must never become that base.
 *
 * The gate projects the full repeating cycle over one year from the pattern's effective start —
 * every period a limit names: day, week, month, quarter and year — and refuses the first breach
 * with the same sentence the roster gate quotes. A `ROSTERED` pattern has no cycle to project;
 * its expectation is judged at payroll precheck, where the money is, exactly as before.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Requires a cycle of whole weeks, and refuses a work pattern whose projected cycle breaches any hour limit of the jurisdiction settings version in force at its effective start.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						const row = { ...existing, ...input };
						const pattern = row.pattern as WorkPattern | null | undefined;
						if (pattern == null || !('days' in pattern)) return input;
						// A cycle is whole weeks: it names a code for every weekday, so the day an
						// employment is projected onto is never one the pattern has no answer for.
						if (pattern.days.length % 7 !== 0)
							refuse(
								`A shift pattern cycle is whole weeks; this one has ${pattern.days.length} days.`
							);
						const companyId = row.company_id as string | null | undefined;
						const range = readRange(row.effective_range);
						if (companyId == null || range == null) return input;
						const start = dateKey(range.start);
						const company = yield* api.db.companies.findFirst({
							where: { id: { eq: companyId } },
							columns: { id: true, settings_code: true }
						});
						const settingsCode = company?.settings_code;
						if (settingsCode == null || settingsCode === '') return input;
						const [codes, versions] = yield* Effect.all(
							[
								api.db.shift_definitions.findMany({
									where: { company_id: { eq: companyId } },
									columns: { id: true, variant: true },
									limit: QUERY_LIMIT
								}),
								api.db.jurisdiction_settings.findMany({
									where: { code: { eq: settingsCode } },
									columns: {
										id: true,
										code: true,
										name: true,
										sealed_at: true,
										voided_at: true,
										approval_id: true,
										effective_range: true,
										work_rules: true
									},
									limit: QUERY_LIMIT
								})
							],
							{ concurrency: 'unbounded' }
						);
						if (codes.length === QUERY_LIMIT || versions.length === QUERY_LIMIT)
							refuse('This legal entity has too many roster codes to validate safely.');
						const version = settingsInForce(
							versions as readonly SettingsVersionRow[],
							settingsCode,
							start
						);
						const limits = version?.work_rules?.limits ?? [];
						if (limits.length === 0) return input;
						const codeById = new Map<string, RosterCodeFacts>();
						for (const code of codes) {
							try {
								const kind = rosterCodeKind(code.variant);
								if (kind === 'WORK') {
									const window = workWindow(code.variant);
									if (window == null) continue;
									codeById.set(code.id, {
										kind: 'WORK',
										paid_minutes: window.paid_minutes,
										break_minutes: window.break_minutes,
										spread_hours: window.elapsed_minutes / 60
									});
								} else {
									codeById.set(code.id, {
										kind,
										paid_minutes: 0,
										break_minutes: 0,
										spread_hours: 0
									});
								}
							} catch {
								continue;
							}
						}
						const end = addDays(start, PROJECTION_DAYS);
						const planByDate = new Map<string, SchedulePlanDay>();
						const changedDates = new Set<string>();
						for (let date = start; date <= end; date = addDays(date, 1)) {
							let rosterCodeId: string | null = null;
							try {
								rosterCodeId = patternRosterCodeId(pattern, date, start);
							} catch {
								rosterCodeId = null;
							}
							planByDate.set(date, plannedDay({ date, rosterCodeId, codeById }));
							changedDates.add(date);
						}
						const breach = projectedLimitBreaches({
							subject: `pattern ${String(row.code ?? '')}`.trim(),
							changedDates,
							planByDate,
							limits,
							authority: version?.work_rules?.authority ?? null
						})[0];
						if (breach != null) refuse(breach.message);
						return input;
					})
			}
		}
	}
} satisfies Hooks;
