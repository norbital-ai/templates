/**
 * The jurisdiction's wall clock, as an IANA zone.
 *
 * A shift start is a wall-clock time and a punch is a UTC instant, so pricing overtime needs the
 * offset the zone was actually at on that date — which a fixed number cannot express once a
 * jurisdiction observes daylight saving. The zone name is the fact; the offset is derived.
 */

/** Minutes east of UTC `timezone` was at midday on `date` (a `YYYY-MM-DD` day). */
// A formatter is expensive to build and a payroll asks the same zone for thousands of days.
const formatters = new Map<string, Intl.DateTimeFormat>();
const offsets = new Map<string, number>();

export function offsetMinutesFor(timezone: string, date: string): number {
	if (typeof timezone !== 'string' || timezone.trim() === '')
		throw new TypeError(
			'A jurisdiction timezone is required to price a day; an absent zone must not fall back ' +
				'to the host clock.'
		);
	const key = `${timezone}\n${date}`;
	const known = offsets.get(key);
	if (known !== undefined) return known;
	const at = new Date(`${date}T12:00:00.000Z`);
	if (Number.isNaN(at.getTime())) throw new TypeError(`Not a calendar day: ${date}.`);
	let parts: Intl.DateTimeFormatPart[];
	try {
		let formatter = formatters.get(timezone);
		if (formatter === undefined) {
			formatter = new Intl.DateTimeFormat('en-US', {
				timeZone: timezone,
				hourCycle: 'h23',
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit'
			});
			formatters.set(timezone, formatter);
		}
		parts = formatter.formatToParts(at);
	} catch (cause) {
		throw new TypeError(`Not an IANA time zone: ${timezone}.`, { cause });
	}
	const part = (type: Intl.DateTimeFormatPartTypes): number =>
		Number(parts.find((value) => value.type === type)?.value ?? Number.NaN);
	const asUtc = Date.UTC(
		part('year'),
		part('month') - 1,
		part('day'),
		part('hour'),
		part('minute'),
		part('second')
	);
	const offset = Math.round((asUtc - at.getTime()) / 60_000);
	if (offsets.size >= 65_536) offsets.clear();
	offsets.set(key, offset);
	return offset;
}

/** Every IANA zone this runtime knows, for a picker. Stable order, no duplicates. */
export function timezoneNames(): readonly string[] {
	const supported = Intl.supportedValuesOf?.('timeZone') ?? [];
	return [...new Set(supported)].toSorted();
}
