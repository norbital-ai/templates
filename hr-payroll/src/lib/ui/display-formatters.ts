/**
 * Read-only formatters for the values the app pages surface in table cells — the JSONB variants,
 * and every date this workspace prints.
 *
 * Every formatter parses defensively: a table cell must never throw on a row whose variant was
 * written by an older definition. There is no writing here — presentation only.
 */
import { Result, Schema } from 'effect';
import type { TenantI18nKeys } from '$bolt/i18n-keys';
import type { Translator } from './roster/roster-month.js';
import { PAYROLL_TIME_ZONE, calendarDateInTimeZone } from './calendar.js';
import { formatDateISO } from '@norbital-ai/std/date';
import { entryOriginSchema } from '../../datatypes/entry_origin/+definition.js';
import { holidayScopeSchema } from '../../datatypes/holiday_scope/+definition.js';
import { leaveAccrualSchema } from '../../datatypes/leave_accrual/+definition.js';
import { leavePayrollEffectSchema } from '../../datatypes/leave_payroll_effect/+definition.js';
import { rateAwardSchema } from '../../datatypes/rate_award/+definition.js';
import { rateSelectorSchema } from '../../datatypes/rate_selector/+definition.js';
import { repaymentScheduleSchema } from '../../datatypes/repayment_schedule/+definition.js';
import { statutoryFactStatusSchema } from '../../datatypes/statutory_fact_status/+definition.js';
import type { PayslipLineComponent } from '../../datatypes/payslip_line_component/+definition.js';

const DECIMAL = new Intl.NumberFormat(undefined, {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});

/** A `numeric()` column arrives as a string; render it without inventing precision. */
export function formatNumeric(value: unknown): string {
	if (value == null || value === '') return '—';
	const parsed = Number(value);
	return Number.isFinite(parsed) ? DECIMAL.format(parsed) : String(value);
}

const HOURS = new Intl.NumberFormat(undefined, {
	minimumFractionDigits: 0,
	maximumFractionDigits: 2
});

/**
 * An integer-minutes column presented as hours.
 *
 * The column stays minutes — minutes are the exact unit the overtime and export arithmetic measures
 * in, and every half-hour a rota actually uses is a whole number of them. Only the label the
 * operator reads changes, so no stored value is reinterpreted.
 *
 * Deliberately *not* rounded to the half hour: the half-hour step belongs to the input, which is
 * where the operator's intent is expressed. A row that already holds 45 minutes must read `0.75 h`
 * and not be quietly reported as `0.5 h` — display that disagrees with storage is how a payroll
 * dispute starts.
 */
export function formatDurationHours(value: unknown, t: Translator): string {
	if (value == null || value === '') return '—';
	const minutes = Number(value);
	if (!Number.isFinite(minutes)) return '—';
	return t('component.hours_short', { hours: HOURS.format(minutes / 60) });
}
const MONTH_NAMES = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
] as const;

/**
 * A `YYYY-MM-DD` calendar day from a `date()` column value, or `null` when there is not one.
 *
 * Local PGlite reads of a `date()` column yield a `Date` at UTC midnight; wire payloads yield the
 * calendar string, sometimes with the `T00:00:00.000Z` suffix still attached. Strings are read as
 * characters and never routed through `Date` — turning a calendar day into an instant and back is
 * exactly how `dates-and-time.md` says a birthday moves.
 */
function calendarDayFrom(value: unknown): string | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : formatDateISO(value);
	}
	if (typeof value !== 'string') return null;
	return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/**
 * The one date format this workspace prints: **`05 Aug 2026`** — day, month, year.
 *
 * Every on-screen date goes through here so the workspace never shows two shapes for the same
 * value. The month is a *name*, not a number, because this template serves Malaysian, Philippine
 * and Indonesian payroll in one interface: `05/08/2026` reads as 5 August to one operator and
 * 8 May to the next, and a misread pay date or work date is a real payroll error. The day is
 * zero-padded so the column stays a fixed width down a table.
 *
 * The month name is fixed, not locale-derived: `Intl` with the viewer's locale would put the month
 * first for a viewer in the United States, which is the ambiguity this format exists to remove.
 *
 * Takes a **calendar day**.
 */
export function formatCalendarDate(value: unknown): string {
	const day = calendarDayFrom(value);
	if (day === null) return '—';
	const month = MONTH_NAMES[Number(day.slice(5, 7)) - 1];
	if (month === undefined) return '—';
	return `${day.slice(8, 10)} ${month} ${day.slice(0, 4)}`;
}

/**
 * A `dateRange()` value `{ start, end }` of UTC ISO instants, as the two calendar days an operator
 * picked.
 *
 * The bound is an *instant*, so it is resolved through the payroll timezone rather than sliced.
 * `'2026-03-01'` picked in Kuala Lumpur is stored as `2026-02-28T16:00:00.000Z`; taking the first
 * ten characters of that would report the range as starting the day before it does, and effective
 * dating is what decides which rate row prices a run. This is the same resolution the
 * `entry_origin` renderer already performs.
 */
export function formatEffectiveRange(value: unknown): string {
	if (value == null || typeof value !== 'object') return '—';
	const bound = (instant: unknown, fallback: string) => {
		if (typeof instant !== 'string' || instant === '') return fallback;
		const at = new Date(instant);
		if (Number.isNaN(at.getTime())) return fallback;
		return formatCalendarDate(calendarDateInTimeZone(at, PAYROLL_TIME_ZONE));
	};
	return `${bound(Reflect.get(value, 'start'), '…')} → ${bound(Reflect.get(value, 'end'), '∞')}`;
}

export function formatEntryOrigin(value: unknown, t: Translator): string {
	const parsed = Schema.decodeUnknownResult(entryOriginSchema)(value, {
		onExcessProperty: 'error'
	});
	if (!Result.isSuccess(parsed)) return t('component.origin_invalid');
	const origin = parsed.success;
	switch (origin.kind) {
		case 'RECURRING':
			return t('component.origin_recurring', {
				range: formatEffectiveRange(origin.effective_range)
			});
		case 'ONE_OFF':
			return origin.note
				? t('component.origin_one_off_note', { note: origin.note })
				: t('component.origin_one_off');
		case 'CLAIM':
			return `${t('component.origin_claim', { date: formatCalendarDate(origin.incurred_on) })}${
				origin.evidence_file ? t('component.origin_evidence') : ''
			}`;
		case 'LOAN_INSTALMENT':
			return t('component.origin_instalment', {
				sequence: origin.sequence,
				of: origin.of
			});
		case 'REVERSAL':
			return t('component.origin_reversal', { reason: origin.reason });
		case 'ARREARS':
			return t('component.origin_arrears', { periods: origin.covers_periods.join(', ') });
		case 'MANUAL_ADJUSTMENT':
			return t('component.origin_manual_adjustment', { note: origin.note });
		default:
			return origin satisfies never;
	}
}

const DAY_TYPE_LABELS: Readonly<Record<string, TenantI18nKeys>> = {
	ORDINARY: 'component.overtime_day_ordinary',
	REST_DAY: 'component.overtime_day_rest',
	PUBLIC_HOLIDAY: 'component.overtime_day_holiday'
};

const MEASURE_LABELS: Readonly<Record<string, TenantI18nKeys>> = {
	BEYOND_NORMAL: 'component.overtime_measure_beyond',
	FROM_START_OF_DAY: 'component.overtime_measure_from_start'
};

/** One of the two derived-overtime arms of a payslip line: the band that priced it. */
type OvertimeLine = Extract<
	PayslipLineComponent,
	{ readonly kind: 'OVERTIME' | 'OVERTIME_EXCESS' }
>;

/**
 * What to call a derived overtime line.
 *
 * There is no pay component behind one, so nothing supplies a name; the statutory band that priced
 * it is its identity, and it is what an operator needs to see — which day, counted how, from where.
 */
export function formatOvertimeLineBand(line: OvertimeLine, t: Translator): string {
	return t(
		line.kind === 'OVERTIME_EXCESS' ? 'component.overtime_excess_line' : 'component.overtime_line',
		{
			day: labelOf(t, DAY_TYPE_LABELS, line.day_type),
			measure: labelOf(t, MEASURE_LABELS, line.measure),
			from: line.band_from
		}
	);
}

const ACCRUAL_KIND_LABELS: Readonly<Record<string, TenantI18nKeys>> = {
	MONTHLY: 'component.accrual_kind_monthly',
	UPFRONT: 'component.accrual_kind_upfront'
};

const SELECTOR_BY_LABELS: Readonly<Record<string, TenantI18nKeys>> = {
	WAGE: 'component.selector_wage',
	WAGE_AND_MARITAL: 'component.selector_wage_marital',
	HEADCOUNT: 'component.selector_headcount'
};

const AWARD_KIND_LABELS: Readonly<Record<string, TenantI18nKeys>> = {
	PERCENT: 'component.award_kind_percent',
	FIXED: 'component.award_kind_fixed'
};

/**
 * One of five density levels for a seasonality heatmap cell, driven by the count over the
 * maximum. The leave and pay-component seasonality panels draw their one heatmap with this, so
 * the two cannot drift apart on what "a bright cell" means.
 */
export function heatmapClass(count: number, maximum: number): string {
	if (count === 0 || maximum === 0) return 'bg-muted/35 text-muted-foreground';
	const level = Math.ceil((count / maximum) * 5);
	switch (level) {
		case 1:
			return 'bg-primary/10 text-foreground';
		case 2:
			return 'bg-primary/25 text-foreground';
		case 3:
			return 'bg-primary/45 text-primary-foreground';
		case 4:
			return 'bg-primary/70 text-primary-foreground';
		default:
			return 'bg-primary text-primary-foreground';
	}
}

function labelOf(
	t: Translator,
	map: Readonly<Record<string, TenantI18nKeys>>,
	code: string
): string {
	const key = map[code];
	return key === undefined ? code : t(key);
}

export function formatLeaveAccrual(value: unknown, t: Translator): string {
	const parsed = Schema.decodeUnknownResult(leaveAccrualSchema)(value);
	if (!Result.isSuccess(parsed)) return t('component.accrual_invalid');
	const accrual = parsed.success;
	if (accrual.kind === 'PER_EVENT') return t('component.accrual_per_event');
	const carry = accrual.carry
		? t('component.accrual_carry', {
				days: accrual.carry.limit_days,
				months: accrual.carry.expiry_months
			})
		: t('component.accrual_no_carry');
	return `${labelOf(t, ACCRUAL_KIND_LABELS, accrual.kind)}${carry}`;
}

export function formatLeavePayrollEffect(value: unknown, t: Translator): string {
	const parsed = Schema.decodeUnknownResult(leavePayrollEffectSchema)(value);
	if (!Result.isSuccess(parsed)) return t('component.effect_invalid');
	return parsed.success.kind === 'PAID' ? t('component.effect_paid') : t('component.effect_unpaid');
}

export function formatRepaymentSchedule(value: unknown, t: Translator): string {
	const parsed = Schema.decodeUnknownResult(repaymentScheduleSchema)(value);
	if (!Result.isSuccess(parsed)) return t('component.schedule_invalid');
	const schedule = parsed.success;
	const total = schedule.reduce((sum, entry) => sum + entry.amount, 0);
	return t('component.schedule_instalments', {
		count: schedule.length,
		s: schedule.length === 1 ? '' : 's',
		total: DECIMAL.format(total)
	});
}

export function formatHolidayScope(value: unknown, t: Translator): string {
	const parsed = Schema.decodeUnknownResult(holidayScopeSchema)(value);
	if (!Result.isSuccess(parsed)) return t('component.scope_invalid');
	return parsed.success.kind === 'NATIONAL'
		? t('component.scope_national')
		: t('component.scope_regional', { locations: parsed.success.location_codes.join(', ') });
}

export function formatRateSelector(value: unknown, t: Translator): string {
	const parsed = Schema.decodeUnknownResult(rateSelectorSchema)(value);
	if (!Result.isSuccess(parsed)) return t('component.selector_invalid');
	const selector = parsed.success;
	if (selector.by === 'RISK_CLASS')
		return t('component.selector_risk_class', { class: selector.class });
	const band = `${selector.from} → ${selector.to ?? '∞'}`;
	if (selector.by === 'WAGE_AND_AGE')
		return t('component.selector_wage_age', {
			range: band,
			from: selector.age_from,
			to: selector.age_to ?? '∞'
		});
	return `${labelOf(t, SELECTOR_BY_LABELS, selector.by)} ${band}`;
}

export function formatRateAward(value: unknown, t: Translator): string {
	const parsed = Schema.decodeUnknownResult(rateAwardSchema)(value);
	if (!Result.isSuccess(parsed)) return t('component.award_invalid');
	const award = parsed.success;
	if (award.kind === 'PROGRESSIVE')
		return t('component.award_progressive', {
			rate: award.rate,
			constant: DECIMAL.format(Math.abs(award.constant))
		});
	const unit = award.kind === 'PERCENT' ? '%' : '';
	return t('component.award_employee_employer', {
		kind: labelOf(t, AWARD_KIND_LABELS, award.kind),
		employee: award.employee,
		employer: award.employer,
		unit
	});
}

export function formatStatutoryFactStatus(value: unknown, t: Translator): string {
	const parsed = Schema.decodeUnknownResult(statutoryFactStatusSchema)(value);
	if (!Result.isSuccess(parsed)) return t('component.status_invalid');
	const status = parsed.success;
	return status.kind === 'REGISTERED'
		? `${t('component.status_registered', { reference: status.reference_number })}${
				status.rate_override == null
					? ''
					: t('component.status_override', { rate: status.rate_override })
			}`
		: t('component.status_not_registered', { reason: status.reason });
}
