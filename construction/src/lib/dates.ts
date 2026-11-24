import { DateTime, Duration, Option } from 'effect';

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SCHEDULE_DATE_RE =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Validates a strict Gregorian YYYY-MM-DD calendar date (rejecting impossible dates or trailing text). */
export function parseIsoDate(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const match = raw.trim().match(ISO_DATE_RE);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const dt = DateTime.make({ year, month, day });
	if (Option.isNone(dt)) return null;
	const parts = DateTime.toPartsUtc(dt.value);
	if (parts.year !== year || parts.month !== month || parts.day !== day) return null;
	return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Validates a strict schedule export date or timestamp (Primavera P6 `.xer` / MS Project `.xml`) into YYYY-MM-DD. */
export function parseScheduleDate(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const match = raw.trim().match(SCHEDULE_DATE_RE);
	if (!match) return null;
	return parseIsoDate(`${match[1]}-${match[2]}-${match[3]}`);
}

/** Adds signed calendar days to a YYYY-MM-DD string using Effect DateTime. */
export function addCalendarDays(isoDate: string, days: number): string {
	const valid = parseIsoDate(isoDate);
	if (!valid) return isoDate;
	const match = valid.match(ISO_DATE_RE);
	if (!match) return isoDate;
	const base = DateTime.makeUnsafe({
		year: Number(match[1]),
		month: Number(match[2]),
		day: Number(match[3])
	});
	const shifted =
		days >= 0
			? DateTime.addDuration(base, Duration.days(days))
			: DateTime.subtractDuration(base, Duration.days(-days));
	return DateTime.formatIsoDateUtc(shifted);
}

/** Whole calendar days between two YYYY-MM-DD dates (`b - a`). */
export function diffCalendarDays(a: string, b: string): number {
	const va = parseIsoDate(a);
	const vb = parseIsoDate(b);
	if (!va || !vb) return 0;
	const ma = va.match(ISO_DATE_RE);
	const mb = vb.match(ISO_DATE_RE);
	if (!ma || !mb) return 0;
	const da = DateTime.makeUnsafe({ year: Number(ma[1]), month: Number(ma[2]), day: Number(ma[3]) });
	const db = DateTime.makeUnsafe({ year: Number(mb[1]), month: Number(mb[2]), day: Number(mb[3]) });
	return Math.round((DateTime.toEpochMillis(db) - DateTime.toEpochMillis(da)) / 86_400_000);
}

/** Converts an ISO instant to its YYYY-MM-DD calendar date in the given IANA workspace timezone. */
export function instantToLocalDate(instant: string, tz: string, fallback: string): string {
	const dt = DateTime.make(instant);
	if (Option.isNone(dt)) return fallback;
	const zone = DateTime.zoneMakeNamed(tz);
	if (Option.isNone(zone)) return DateTime.formatIsoDateUtc(dt.value);
	return DateTime.formatIsoDate(DateTime.setZone(dt.value, zone.value));
}
