<script lang="ts">
	import { Effect, Result, Schema } from 'effect';
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	/**
	 * The leave event is the core of the leave request, so this is its event editor.
	 *
	 * Every other event-derived column on `leave_requests` — `kind`, `from_date`, `to_date`, `days`,
	 * the two half-day flags and `reason` — is `generatedAlwaysAs` over this value:
	 * read-only projections the database computes so the row can be indexed, filtered and listed.
	 * Painting them beside this editor showed the operator the same event facts twice, once as raw
	 * JSON and once as fields that could not be typed into. The request is entered here, once, and
	 * the projections follow from it.
	 *
	 * `source_id` is provenance the migration wrote and is carried through an edit untouched. A
	 * certificate is an ordinary `leave_requests.certificate_file` column rendered by the collection
	 * form beside this event editor, so it is no longer hidden inside this JSON value.
	 */
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import { formatCalendarDate } from '../../lib/ui/display-formatters.js';
	import HalfDayRangePicker, {
		type HalfDayRange,
		type LeaveDayAvailability
	} from '../../lib/ui/leave/half-day-range-picker.svelte';
	import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
	import { leaveBalance, resolveEntitlement } from '../../collections/payroll_runs/lib/leave.js';
	import { sealedProfileCovering } from '../../lib/statutory_profile.js';
	import { completedMonths } from '../../collections/payroll_runs/lib/dates.js';
	import { payrollWindows, windowForDate } from '../../lib/scheduling/lock.js';
	import { patternRosterCodeId } from '../../lib/scheduling/work-pattern.js';
	import { rosterCodeKind, workWindowHalves } from '../../lib/scheduling/roster-code.js';
	import { shiftDayKey, todayKey } from '../../lib/ui/calendar.js';
	import { formatDateISO } from '@norbital-ai/std/date';
	import { leaveEventSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';
	type LeaveEventRendererProps = RendererProps & { readonly row?: Record<string, unknown> };

	const { t } = useI18n<TenantI18nKeys>();

	type EventKind = Value['kind'];

	const KIND_OPTIONS = $derived<{ value: EventKind; label: string; description: string }[]>([
		{
			value: 'TIME_OFF',
			label: t('renderer.leave_event.kind_time_off'),
			description: t('renderer.leave_event.kind_time_off_desc')
		},
		{
			value: 'BALANCE_ADJUSTMENT',
			label: t('renderer.leave_event.kind_balance_adjustment'),
			description: t('renderer.leave_event.kind_balance_adjustment_desc')
		},
		{
			value: 'ENCASHMENT',
			label: t('renderer.leave_event.kind_encashment'),
			description: t('renderer.leave_event.kind_encashment_desc')
		}
	]);

	let props: LeaveEventRendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(leaveEventSchema)(props.value));
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
	const employmentId = $derived(
		typeof props.row?.employment_id === 'string' ? props.row.employment_id : null
	);
	const leaveTypeId = $derived(
		typeof props.row?.leave_type_id === 'string' ? props.row.leave_type_id : null
	);
	const requestId = $derived(typeof props.row?.id === 'string' ? props.row.id : null);
	const employmentQuery = $derived(
		employmentId == null
			? null
			: client.db.employments.findFirst({ where: { id: { eq: employmentId } } })
	);
	const employment = $derived(employmentQuery?.current ?? null);
	const termsQuery = $derived(
		employmentId == null
			? null
			: client.db.employment_terms.findMany({
					where: { employment_id: { eq: employmentId } },
					limit: 100
				})
	);
	const rosterQuery = $derived(
		employmentId == null
			? null
			: client.db.work_days.findMany({
					where: { employment_id: { eq: employmentId } },
					limit: 20_000
				})
	);
	const holidaysQuery = $derived(
		employment == null
			? null
			: client.db.company_holidays.findMany({
					where: { company_id: { eq: employment.company_id } },
					limit: 2_000
				})
	);
	/**
	 * Paid payroll windows: a day a PAID run settled is not a day leave can be moved across.
	 * The picker draws it struck; the leave hook refuses it at submit.
	 */
	const settledRunsQuery = $derived(
		employment == null
			? null
			: client.db.payroll_runs.findMany({
					where: { company_id: { eq: employment.company_id }, lifecycle: { eq: 'PAID' } },
					columns: { period: true, attendance_from: true, attendance_to: true },
					limit: 500
				})
	);
	const settledWindows = $derived(payrollWindows(settledRunsQuery?.current ?? []));
	const rosterCodesQuery = $derived(
		employment == null
			? null
			: client.db.shift_definitions.findMany({
					where: { company_id: { eq: employment.company_id } },
					limit: 2_000
				})
	);
	const companyQuery = $derived(
		employment == null
			? null
			: client.db.companies.findFirst({ where: { id: { eq: employment.company_id } } })
	);
	/** The governing profile: the SEALED version of the company's law family covering today. */
	const profileAnchorQuery = $derived(
		companyQuery?.current?.jurisdiction_id == null
			? null
			: client.db.jurisdictions.findFirst({
					where: { id: { eq: companyQuery.current.jurisdiction_id } },
					columns: { code: true }
				})
	);
	const profileQuery = $derived.by(() => {
		const anchor = profileAnchorQuery?.current;
		if (anchor == null) return null;
		return client.db.jurisdictions.findMany({
			where: { code: { eq: anchor.code }, lifecycle: { eq: 'SEALED' } },
			limit: 100
		});
	});
	const governingProfile = $derived.by(() => {
		const rows = profileQuery?.current;
		if (rows == null || rows.length === 0) return null;
		const today = formatDateISO(new Date());
		return sealedProfileCovering(rows, rows[0]?.code ?? '', today);
	});
	const childFactsQuery = $derived(
		employmentId == null
			? null
			: client.db.employee_children.findMany({
					where: { employment_id: { eq: employmentId } },
					limit: 200
				})
	);
	const leaveTypeQuery = $derived(
		leaveTypeId == null
			? null
			: client.db.leave_types.findFirst({ where: { id: { eq: leaveTypeId } } })
	);
	const leaveLedgerQuery = $derived(
		employmentId == null || leaveTypeId == null
			? null
			: client.db.leave_requests.findMany({
					where: { employment_id: { eq: employmentId }, leave_type_id: { eq: leaveTypeId } },
					limit: 20_000
				})
	);
	const rosterByDate = $derived(
		new Map((rosterQuery?.current ?? []).map((entry) => [formatDateISO(entry.work_date), entry]))
	);
	const holidayDates = $derived(
		new Set((holidaysQuery?.current ?? []).map((holiday) => formatDateISO(holiday.date)))
	);
	const rosterCodeById = $derived(
		new Map((rosterCodesQuery?.current ?? []).map((code) => [code.id, code]))
	);
	const scheduleUnknown = $derived(
		employmentId != null &&
			(termsQuery?.current === undefined ||
				rosterQuery?.current === undefined ||
				(employment != null &&
					(holidaysQuery?.current === undefined || rosterCodesQuery?.current === undefined)))
	);
	const pickerDisabledReason = $derived.by(() => {
		if (disabled) return null;
		if (employmentId == null) return t('component.leave_picker_disabled_no_employment');
		if (leaveTypeId == null) return t('component.leave_picker_disabled_no_leave_type');
		if (scheduleUnknown) return t('component.leave_picker_loading_schedule');
		return null;
	});
	const pickerDisabled = $derived(disabled || pickerDisabledReason != null);
	const availableLeaveDays = $derived.by(() => {
		if (
			current?.kind !== 'TIME_OFF' ||
			employment == null ||
			employmentId == null ||
			leaveTypeId == null
		)
			return null;
		const company = companyQuery?.current;
		const leaveType = leaveTypeQuery?.current;
		if (company == null || leaveType == null || leaveType.accrual?.kind === 'PER_EVENT')
			return null;
		const asOf = current.range.end.date;
		const hireDate = formatDateISO(employment.hire_date);
		const ledger = (leaveLedgerQuery?.current ?? [])
			.filter((row) => row.id !== requestId && row.from_date != null)
			.map((row) => ({
				id: row.id,
				leave_type_id: row.leave_type_id,
				entry_date: row.from_date!,
				kind: row.kind,
				days: row.kind === 'TIME_OFF' ? -Math.abs(Number(row.days)) : Number(row.days),
				source_id: null,
				approval_id: row.approval_id
			}));
		const profile = governingProfile;
		if (profile == null) return null;
		const childFacts = childFactsQuery?.current ?? [];
		const entitlementAt = (serviceMonths: number, asOfDate: string) =>
			resolveEntitlement({
				leaveType,
				profile,
				children: childFacts,
				serviceMonths,
				employmentId,
				asOf: asOfDate
			});
		// Resolve once so a malformed entitlement layer is shown before submit, not after the drag.
		entitlementAt(completedMonths(hireDate, asOf), asOf);
		return Math.max(
			0,
			leaveBalance(
				{
					leaveType,
					entitlementAt,
					hireDate,
					exitDate: employment.exit_date == null ? null : formatDateISO(employment.exit_date),
					leaveYearStartMonth: Number(company.leave_year_start_month),
					ledger,
					basis: 'PROJECTED'
				},
				asOf
			)
		);
	});

	function leaveDayAvailability(date: string): LeaveDayAvailability {
		if (employmentId == null || leaveTypeId == null || scheduleUnknown) {
			return { eligible: false, reason: pickerDisabledReason ?? undefined };
		}
		const settled = windowForDate(settledWindows, date);
		if (settled != null) {
			return {
				eligible: false,
				reasonMark: '🔒',
				reason: t('component.excluded_paid_payroll', { period: settled.period })
			};
		}
		if (holidayDates.has(date)) {
			return { eligible: false, reasonMark: 'H', reason: t('component.excluded_public_holiday') };
		}
		const coveredByOtherRequest = (leaveLedgerQuery?.current ?? []).some(
			(row) =>
				row.id !== requestId &&
				row.kind === 'TIME_OFF' &&
				row.from_date != null &&
				row.to_date != null &&
				date >= String(row.from_date).slice(0, 10) &&
				date <= String(row.to_date).slice(0, 10)
		);
		if (coveredByOtherRequest) {
			return {
				eligible: false,
				reasonMark: 'L',
				reason: t('component.excluded_other_leave')
			};
		}
		const term = (termsQuery?.current ?? []).find((candidate) =>
			coversDate(candidate.effective_range, date)
		);
		if (term == null) return { eligible: false, reason: t('component.excluded_no_schedule') };
		let codeId = rosterByDate.get(date)?.shift_definition_id ?? null;
		if (codeId == null) {
			const projected = Effect.runSync(
				Effect.orElseSucceed(
					Effect.try(() => patternRosterCodeId(term.work_pattern, date)),
					() => null
				)
			);
			if (projected == null)
				return { eligible: false, reason: t('component.excluded_no_schedule') };
			codeId = projected;
		}
		if (codeId == null) {
			if (term.work_pattern?.type === 'ROSTERED') return { eligible: true };
			return { eligible: false, reasonMark: 'O', reason: t('component.excluded_rest_or_off') };
		}
		const code = rosterCodeById.get(codeId);
		if (code != null && rosterCodeKind(code.variant) !== 'WORK') {
			return { eligible: false, reasonMark: 'R', reason: t('component.excluded_rest_or_off') };
		}
		const halves = code == null ? null : workWindowHalves(code.variant);
		return {
			eligible: true,
			shiftLabel: halves?.span,
			firstHalfLabel: halves?.first,
			secondHalfLabel: halves?.second
		};
	}

	const summary = $derived.by(() => {
		if (current === null) return '—';
		if (current.kind === 'TIME_OFF')
			return `${formatCalendarDate(current.range.start.date)} → ${formatCalendarDate(current.range.end.date)}${current.chargeable_days == null ? '' : ` · ${current.chargeable_days}d`}`;
		return `${t(
			`renderer.leave_event.kind_${current.kind === 'ENCASHMENT' ? 'encashment' : 'balance_adjustment'}`
		)} · ${formatCalendarDate(current.effective_on)} · ${current.movement_days}d`;
	});

	function emit(next: Value | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	/** Today in the payroll timezone, so a new event opens on a real local date. */
	function today(): string {
		return todayKey();
	}

	function defaultTimeOffDate(): string {
		const on = today();
		for (let offset = 0; offset <= 42; offset += 1) {
			const date = shiftDayKey(on, offset);
			if (leaveDayAvailability(date).eligible) return date;
		}
		return on;
	}

	function defaultFor(kind: EventKind): Value {
		if (kind === 'TIME_OFF') {
			const on = defaultTimeOffDate();
			return {
				kind: 'TIME_OFF',
				range: {
					start: { date: on, half: 'FIRST' },
					end: { date: on, half: 'SECOND' }
				},
				chargeable_days: null,
				reason: null
			};
		}
		const on = today();
		return {
			kind: kind === 'ENCASHMENT' ? 'ENCASHMENT' : 'BALANCE_ADJUSTMENT',
			effective_on: on,
			movement_days: 0,
			note: null,
			source_id: null
		};
	}

	/*
	 * Every variant renderer needs this same guard, and every copy closes over its own file's
	 * `current`, `emit` and `defaultFor`. Sharing it would mean a generic taking three callbacks —
	 * `controller-surfaces.md` §2 calls that a wrapper thinner than the thing it wraps.
	 */
	// repository-health:allow D1 -- closes over this file's current/emit/defaultFor; see the note above.
	function selectKind(kind: EventKind | null): void {
		if (kind === null) {
			emit(null);
			return;
		}
		if (current !== null && current.kind === kind) return;
		emit(defaultFor(kind));
	}

	/** A blank text field means "not stated", which is what `null` means in the schema. */
	function textOrNull(raw: string): string | null {
		return raw.trim().length === 0 ? null : raw;
	}

	function setTimeOffRange(range: HalfDayRange): void {
		if (current?.kind !== 'TIME_OFF') return;
		emit({
			...current,
			range,
			chargeable_days: null
		});
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
		<label class="text-sm font-medium">
			<Stack gap="xs">
				{t('renderer.leave_event.event')}
				<Combobox
					ariaLabel={t('renderer.leave_event.event')}
					options={KIND_OPTIONS}
					value={current?.kind ?? null}
					{disabled}
					searchable={false}
					emptyPlaceholder={t('renderer.leave_event.select_kind')}
					onValueChange={(value) => selectKind(value)}
				/>
			</Stack>
		</label>

		{#if current?.kind === 'TIME_OFF'}
			<div class="col-span-full min-w-0">
				<HalfDayRangePicker
					value={current.range}
					availability={leaveDayAvailability}
					maximumHalfDays={availableLeaveDays == null ? null : Math.floor(availableLeaveDays * 2)}
					persistedChargeableDays={current.chargeable_days}
					disabled={pickerDisabled}
					disabledReason={pickerDisabledReason}
					onValueChange={setTimeOffRange}
				/>
			</div>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('renderer.leave_event.reason')}
					<Input
						value={current.reason ?? ''}
						{disabled}
						placeholder={t('component.blank_none_stated')}
						oninput={(event) => emit({ ...current, reason: textOrNull(event.currentTarget.value) })}
					/>
				</Stack>
			</label>
		{:else if current !== null}
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('renderer.leave_event.effective_on')}
					<Input
						type="date"
						value={current.effective_on}
						{disabled}
						oninput={(event) => emit({ ...current, effective_on: event.currentTarget.value })}
					/>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('renderer.leave_event.movement_days')}
					<Input
						type="number"
						step="0.5"
						value={current.movement_days}
						{disabled}
						oninput={(event) =>
							emit({ ...current, movement_days: numberFrom(event.currentTarget.value, 0) })}
					/>
					<span class="text-xs font-normal text-muted-foreground">
						{t('renderer.leave_event.movement_hint')}
					</span>
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('component.note')}
					<Input
						value={current.note ?? ''}
						{disabled}
						placeholder={t('component.blank_none_stated')}
						oninput={(event) => emit({ ...current, note: textOrNull(event.currentTarget.value) })}
					/>
				</Stack>
			</label>
		{/if}
	</Grid>
{/if}
