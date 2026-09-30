import { refuse } from './refuse.js';
import { isCalendarDate } from './iso-day.js';
import type { WorkspaceRow } from './rows.js';
import { HOLIDAY_KINDS, type HolidaySnapshot } from './datatypes/holiday_snapshots.js';
import { dateKey } from './iso-day.js';

/** What a consumer reads off a holiday row; the snapshot is the same columns, dates as day keys. */
export type HolidayRow = Pick<
	WorkspaceRow<'jurisdiction_holidays'>,
	| 'id'
	| 'company_id'
	| 'date'
	| 'name'
	| 'kind'
	| 'replaces'
	| 'given_to'
	| 'worksite'
	| 'published_at'
> &
	Partial<Pick<WorkspaceRow<'jurisdiction_holidays'>, 'applies_when'>>;

/** How much a kind pays over an ordinary day: DOUBLE is two regular holidays, SPECIAL the least. */
const RANK: Record<HolidayRow['kind'], number> = {
	SPECIAL_HOLIDAY: 0,
	PUBLIC_HOLIDAY: 1,
	SUBSTITUTE: 1,
	DOUBLE_HOLIDAY: 2
};

/** A worksite as both sides record it; blank is none. */
const siteOf = (worksite: string | null | undefined) => worksite?.trim() || null;

/** A row's person condition (`applies_when`); blank is none. */
export const conditionOf = (row: Pick<HolidayRow, 'applies_when'>) =>
	row.applies_when?.trim() || null;

/** The row exactly as a run captures it. An unpublished pin is still evidence, so it is not refused. */
function holidaySnapshot(row: HolidayRow): HolidaySnapshot {
	return {
		id: row.id,
		company_id: row.company_id,
		date: dateKey(row.date),
		name: row.name,
		kind: HOLIDAY_KINDS.find((kind) => kind === row.kind) ?? 'PUBLIC_HOLIDAY',
		replaces: row.replaces == null ? null : dateKey(row.replaces),
		given_to:
			row.given_to === 'ONLY_IF_OFF_ON_REPLACED_DATE' ? 'ONLY_IF_OFF_ON_REPLACED_DATE' : 'EVERYONE',
		...(siteOf(row.worksite) == null ? {} : { worksite: siteOf(row.worksite) }),
		published_at: row.published_at == null ? '' : row.published_at
	};
}

/**
 * The published holidays of one jurisdiction across a date range, by day.
 *
 * Publication is per holiday: a published row is a holiday, an unpublished one is not there.
 * Nothing asks a year to be complete first. A day a work day pinned is read back by id elsewhere,
 * published or not, because the pin is what the day was classified against.
 *
 * A row naming a worksite is a local day (PH RA 12271: "in the City of Navotas"): it reaches only
 * the days `worksiteOn` places at that site. Without it, the company's own calendar: rows with no
 * worksite. A local day on a company-wide date keeps the dearer of the two.
 *
 * A row with `applies_when` (a religion's own day) is a holiday only where `appliesOn` says the
 * person on that day meets it; without `appliesOn` — a company-wide read — it is not there.
 */
export function resolveHolidays(
	rows: readonly HolidayRow[],
	companyId: string,
	start: string,
	end: string,
	worksiteOn: (date: string) => string | null | undefined = () => null,
	appliesOn?: (expression: string, date: string) => boolean
): ReadonlyMap<string, HolidaySnapshot> {
	if (!isCalendarDate(start) || !isCalendarDate(end) || start > end)
		refuse('Holiday coverage needs a valid ordered date range.');
	const holidays = new Map<string, HolidaySnapshot>();
	for (const row of rows) {
		if (row.company_id !== companyId || row.published_at == null) continue;
		const date = dateKey(row.date);
		if (date < start || date > end) continue;
		const site = siteOf(row.worksite);
		if (site != null && site !== siteOf(worksiteOn(date))) continue;
		const condition = conditionOf(row);
		if (condition != null && appliesOn?.(condition, date) !== true) continue;
		const held = holidays.get(date);
		if (held != null) {
			if ((held.worksite != null) === (site != null))
				refuse(`Entity ${companyId} has two published holidays on ${date}.`);
			// Owner rule 2026-09-28: the law is silent on a local day falling on a company-wide one; the
			// dearer kind stands, the company-wide row on a tie. Paying the higher meets both.
			const gain = RANK[row.kind] - RANK[held.kind];
			if (gain < 0 || (gain === 0 && site != null)) continue;
		}
		holidays.set(date, holidaySnapshot(row));
	}
	return holidays;
}

/** One classified day: the holiday it was read against, or none. */
export type PreparedHolidayInput = {
	readonly company_id: string;
	readonly date: string;
	readonly holiday_id: string | null;
};

/** Classifies every requested day against what the entity's calendar publishes at the point of running. */
export function resolveHolidayInputs(
	rows: readonly HolidayRow[],
	companyId: string,
	dates: readonly string[]
): {
	readonly holidays: ReadonlyMap<string, HolidaySnapshot>;
	readonly snapshots: readonly HolidaySnapshot[];
	readonly inputs: readonly PreparedHolidayInput[];
} {
	const ordered = [...new Set(dates.map(dateKey))].sort();
	if (!ordered.length) return { holidays: new Map(), snapshots: [], inputs: [] };
	const [start, end] = [ordered[0]!, ordered.at(-1)!];
	const holidays = new Map(resolveHolidays(rows, companyId, start, end));
	// The local and person-conditioned days no company-wide read returns; a run still captures them.
	const local = rows
		.filter(
			(row) =>
				row.company_id === companyId &&
				row.published_at != null &&
				(siteOf(row.worksite) != null || conditionOf(row) != null)
		)
		.filter((row) => dateKey(row.date) >= start && dateKey(row.date) <= end)
		.map(holidaySnapshot);
	const inputs = ordered.map((date) => ({
		company_id: companyId,
		date,
		holiday_id: holidays.get(date)?.id ?? null
	}));
	return {
		holidays,
		snapshots: [...holidays.values(), ...local].toSorted((a, b) => a.date.localeCompare(b.date)),
		inputs
	};
}
