import type { Id } from '@norbital-ai/bolt';
import { addDays, type PlainDate } from '@norbital-ai/std/date';
import { bolt } from '$bolt';
import { everyField } from '../../every-field.js';
import { PAYROLL_TIME_ZONE } from '../../iso-day.js';
import { settingsInForce } from '../../jurisdiction_settings.js';
import { attachPatterns, type ShiftPatternLike } from '../../scheduling/work-pattern.js';
import { HOLIDAY_QUERY_LIMIT, holidayView } from '../holiday-calendar.js';
import { liveRows } from '../live.svelte.js';
import { onLineage } from '../settings-scope.js';
import { t } from '../t.js';

/** Every catalogue read on these surfaces skips rows still held under an approval request. */
const approved = { approval_id: { isNull: true } } as const;

/**
 * The live reads one roster month is derived from (`buildRosterMonth`), shared by the controller's board (an entity's
 * people) and an employee's month (one contract), so the two draw a day from the same facts: the terms with their named
 * patterns, the entity's roster and leave codes, the rosters of record around the month, the month's person-days and
 * time off, and the entity's calendar and the version of its lineage in force. Call during component initialisation.
 */
export function monthSources(scope: {
	readonly companyId: () => Id<'companies'> | null;
	readonly settingsCode: () => string | null;
	readonly employmentIds: () => readonly Id<'employments'>[];
	/** The calendar month's first and last day. */
	readonly start: () => PlainDate;
	readonly end: () => PlainDate;
	/** The periods whose rosters of record the plan yields to. */
	readonly rosterPeriods: () => readonly string[];
	/**
	 * Whether person-days held under an approval are read too: an employee's own reported punch is the most important
	 * state on their month, while the board plans against committed rows.
	 */
	readonly held: boolean;
}) {
	// Each input its own thunk, so a read re-subscribes only when what it names changes.
	const ids = $derived(scope.employmentIds());
	const companyId = $derived(scope.companyId());
	const settingsCode = $derived(scope.settingsCode());
	const start = $derived(scope.start());
	const end = $derived(scope.end());

	const termRows = liveRows(() =>
		ids.length === 0
			? null
			: bolt.read('employment_terms', {
					select: everyField('employment_terms'),
					where: { ...approved, employment_id: { in: ids } },
					all: true
				})
	);
	const patterns = liveRows(() =>
		companyId == null
			? null
			: bolt.read('shift_patterns', {
					select: everyField('shift_patterns'),
					where: { company_id: { eq: companyId } },
					all: true
				})
	);
	const shifts = liveRows(() =>
		companyId == null
			? null
			: bolt.read('shift_definitions', {
					select: everyField('shift_definitions'),
					where: { ...approved, company_id: { eq: companyId } },
					all: true
				})
	);
	const leaveCodes = liveRows(() =>
		settingsCode == null
			? null
			: bolt.read('leave_catalogue', {
					where: { ...approved, settings_id: { is: onLineage(settingsCode) } },
					select: { code: true },
					all: true
				})
	);
	const rosters = liveRows(() =>
		ids.length === 0
			? null
			: bolt.read('rosters', {
					where: {
						...approved,
						employment_id: { in: ids },
						period: { in: [...scope.rosterPeriods()] }
					},
					select: { employment_id: true, period: true },
					all: true
				})
	);
	const workDays = liveRows(() =>
		ids.length === 0
			? null
			: bolt.read('work_days', {
					select: everyField('work_days'),
					where: {
						...(scope.held ? {} : approved),
						work_date: { gte: start, lte: end },
						employment_id: { in: ids }
					},
					all: true
				})
	);
	/** Time off, committed and held alike (held leave is drawn as uncommitted coverage); a reversed entry is not. */
	const leave = liveRows(() =>
		ids.length === 0
			? null
			: bolt.read('leave_entries', {
					select: everyField('leave_entries'),
					where: {
						employment_id: { in: ids },
						activity: { eq: 'TIME_OFF' },
						reversals: { none: { approval_id: { isNull: true } } },
						from_date: { lte: end },
						to_date: { gte: start }
					},
					all: true
				})
	);
	const settings = liveRows(() =>
		settingsCode == null
			? null
			: // the version in force and its clock and work rules only: the whole row (sources, obligations, facts) runs to
				// megabytes per version, past what a live view holds
				bolt.read('jurisdiction_settings', {
					select: {
						code: true,
						jurisdiction_code: true,
						name: true,
						sealed_at: true,
						voided_at: true,
						approval_id: true,
						effective_range: true,
						payroll: true,
						work_rules: true,
						work_day_facts: true
					},
					where: onLineage(settingsCode),
					limit: HOLIDAY_QUERY_LIMIT
				})
	);
	// The calendar is the employing entity's, not the lineage's, which cannot tell two entities of one country apart.
	const holidays = liveRows(() =>
		companyId == null
			? null
			: bolt.read('jurisdiction_holidays', {
					where: {
						...approved,
						company_id: { eq: companyId },
						// a month either side: payroll resolves each assessment window whole, and a holiday before the
						// month can carry into it (`observedHolidays`)
						date: { gte: addDays(start, -31), lte: addDays(end, 31) },
						published_at: { isNull: false }
					},
					limit: HOLIDAY_QUERY_LIMIT
				})
	);

	// The declared `work_pattern` kind spells each member optional; the scheduling schema reads the two shapes whole.
	const terms = $derived(
		attachPatterns(termRows.current ?? [], (patterns.current ?? []) as readonly ShiftPatternLike[])
	);
	const shiftsById = $derived(new Map((shifts.current ?? []).map((row) => [row.id, row])));
	const leaveCodeById = $derived(
		new Map((leaveCodes.current ?? []).map((row) => [row.id, row.code]))
	);
	const calendar = $derived(
		holidayView({
			settingsCount: settings.current?.length,
			jurisdiction: companyId,
			rows: holidays.current,
			start,
			end,
			noJurisdiction: t('holiday_calendar.no_jurisdiction'),
			truncated: t('holiday_calendar.truncated')
		})
	);
	const versionInForce = $derived.by(() => {
		if (settingsCode == null) return null;
		try {
			return settingsInForce(settings.current ?? [], settingsCode, start);
		} catch {
			return null;
		}
	});
	return {
		termRows,
		patterns,
		shifts,
		leaveCodes,
		rosters,
		workDays,
		leave,
		settings,
		holidays,
		/** The terms with their named pattern riding along, which every pattern reader takes. */
		get terms() {
			return terms;
		},
		get shiftsById() {
			return shiftsById;
		},
		get leaveCodeById() {
			return leaveCodeById;
		},
		get calendar() {
			return calendar;
		},
		get versionInForce() {
			return versionInForce;
		},
		/** The employing entity's clock: the version in force's payroll timezone, else the default. */
		get timeZone() {
			return versionInForce?.payroll?.timezone ?? PAYROLL_TIME_ZONE;
		}
	};
}
