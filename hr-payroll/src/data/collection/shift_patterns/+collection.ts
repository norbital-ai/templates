import { collection } from '@norbital-ai/bolt';
import { readRange } from '../../../lib/payroll/run/effective.js';
import { addDays } from '../../../lib/payroll/run/dates.js';
import { dateKey } from '../../../lib/iso-day.js';
import { settingsInForce } from '../../../lib/jurisdiction_settings.js';
import { sealedLineages } from '../../../lib/entity-facts.js';
import { patternRosterCodeId } from '../../../lib/scheduling/work-pattern.js';
import {
	applicableLimits,
	plannedDay,
	rosterCodeFacts,
	projectedLimitBreaches,
	type RosterCodeFacts,
	type SchedulePlanDay
} from '../../../lib/scheduling/work-limits.js';
import type { WorkRules } from '../../../lib/datatypes/work_rules.js';
import type { WorkPattern } from '../../../lib/datatypes/work_pattern.js';
import type { RosterCodeVariant } from '../../../lib/datatypes/roster_code_variant.js';

const columns = ['company_id', 'code', 'name', 'pattern', 'effective_range'] as const;

const c = collection('shift_patterns', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {}
});
export default c;

/** How far a pattern is projected when the limits are judged. One full year covers every period. */
const PROJECTION_DAYS = 366;

/**
 * A pattern write is a schedule write: its cycle is the base every employment on it projects, and a cycle that
 * breaches a jurisdiction's hour ceilings must never become that base. A cycle is whole weeks. The gate projects the
 * cycle over one year from the pattern's effective start and refuses the first breach with the sentence the roster
 * gate quotes; a pattern plans no overtime, so only its shifts' own hours and spread-over are judged. A `ROSTERED`
 * pattern has no cycle to project; payroll's precheck judges it. One read wave.
 */
c.transform(async (inputs, ctx) => {
	const rows = inputs.map((input, index) => ({ ...ctx.existing[index], ...input }));
	// A cycle names a code for every weekday, so the day an employment is projected onto is never one it has no answer for.
	for (const row of rows) {
		const pattern = row.pattern as WorkPattern | null | undefined;
		if (pattern != null && 'days' in pattern && pattern.days.length % 7 !== 0)
			ctx.refuse(`A shift pattern cycle is whole weeks; this one has ${pattern.days.length} days.`);
	}
	const cycled = rows.filter(
		(row) => row.pattern != null && 'days' in row.pattern && row.company_id != null
	);
	if (cycled.length === 0) return inputs;
	const companyIds = [...new Set(cycled.map((row) => row.company_id!))];
	const [companies, codes] = await Promise.all([
		ctx.db.read('companies', { where: { id: { in: companyIds as never[] } }, all: true }),
		ctx.db.read('shift_definitions', {
			where: { company_id: { in: companyIds as never[] } },
			all: true
		})
	]);
	const settingsCodeByCompany = new Map(
		companies.rows.map((company) => [String(company.id), company.settings_code])
	);
	const lineageCodes = [...new Set(companies.rows.map((company) => company.settings_code))];
	const versions =
		lineageCodes.length === 0
			? { rows: [] }
			: await ctx.db.read('jurisdiction_settings', {
					...sealedLineages(lineageCodes),
					select: {
						id: true,
						code: true,
						effective_range: true,
						sealed_at: true,
						voided_at: true,
						approval_id: true,
						work_rules: true
					}
				});
	const settingsVersions = versions.rows.map((version) => ({
		...version,
		sealed_at: version.sealed_at == null ? null : String(version.sealed_at),
		voided_at: version.voided_at == null ? null : String(version.voided_at),
		approval_id: version.approval_id == null ? null : version.approval_id,
		work_rules: version.work_rules
	}));
	for (const row of rows) {
		const pattern = row.pattern as WorkPattern | null | undefined;
		if (pattern == null || !('days' in pattern)) continue;
		const range = readRange(row.effective_range);
		const settingsCode =
			row.company_id == null ? undefined : settingsCodeByCompany.get(String(row.company_id));
		if (range == null || settingsCode == null || settingsCode === '') continue;
		const start = dateKey(range.start);
		const version = settingsInForce(settingsVersions, settingsCode, start);
		const limits = applicableLimits(version?.work_rules?.limits ?? [], null);
		if (limits.length === 0) continue;
		const codeById = new Map<string, RosterCodeFacts>();
		for (const code of codes.rows) {
			if (String(code.company_id) !== String(row.company_id)) continue;
			try {
				const facts = rosterCodeFacts(code.variant);
				if (facts != null) codeById.set(String(code.id), facts);
			} catch {
				continue; // a code the projection cannot read plans nothing, as before
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
			subject: `pattern ${row.code ?? ''}`.trim(),
			changedDates,
			planByDate,
			limits,
			authority: version?.work_rules?.authority ?? null
		})[0];
		if (breach != null) ctx.refuse(breach.message);
	}
	return inputs;
});
