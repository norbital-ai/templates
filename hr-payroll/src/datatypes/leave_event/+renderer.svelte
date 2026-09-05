<script lang="ts">
	import { Result, Schema } from 'effect';
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
	 *
	 * Time-off remaining days, chargeable days and per-day eligibility come from `preview_leave`.
	 * The write hook runs the same function, so the numbers the picker shows are the numbers apply
	 * will accept or refuse.
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
	import { shiftDayKey, todayKey } from '../../lib/ui/calendar.js';
	import { defaultTimeOffEvent, leaveEventSchema, type LeaveEvent } from './+definition.js';
	import { getContext } from 'svelte';
	import {
		LEAVE_REQUEST_CREATE_SCOPE,
		type LeaveRequestCreateScope
	} from '../../lib/ui/leave-request-create-scope.js';
	import { client } from '../../lib/workspace-client.js';
	import type { RemoteQuery } from '@norbital-ai/std/collection';
	import type {
		LeaveDayPreview,
		LeavePreview,
		PreviewLeaveInput
	} from '../../lib/leave/preview.js';
	import type { RendererProps, Value } from './$types.js';
	type LeaveEventRendererProps = RendererProps & { readonly row?: Record<string, unknown> };

	const { t } = useI18n<TenantI18nKeys>();

	type EventKind = LeaveEvent['kind'];

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
	const createScope = getContext<LeaveRequestCreateScope | undefined>(LEAVE_REQUEST_CREATE_SCOPE);
	const timeOffOnly = createScope != null;
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
	let calendarMonth = $state(todayKey().slice(0, 7));

	const previewInput = $derived.by((): PreviewLeaveInput | null => {
		if (employmentId == null || leaveTypeId == null) return null;
		const range = current?.kind === 'TIME_OFF' ? current.range : undefined;
		return {
			employment_id: employmentId,
			leave_type_id: leaveTypeId,
			...(typeof props.row?.allocation_id === 'string'
				? { allocation_id: props.row.allocation_id }
				: {}),
			calendar_month: calendarMonth,
			...(range == null ? {} : { range }),
			...(requestId == null ? {} : { exclude_request_id: requestId })
		};
	});
	const previewQuery = $derived(
		previewInput == null
			? null
			: (client.invoke.preview_leave(previewInput) as RemoteQuery<LeavePreview>)
	);
	const preview = $derived(previewQuery?.current);
	const previewLoading = $derived(previewQuery != null && previewQuery.loading && preview == null);
	const pickerDisabledReason = $derived.by(() => {
		if (disabled) return null;
		if (employmentId == null) return t('component.leave_picker_disabled_no_employment');
		if (leaveTypeId == null) return t('component.leave_picker_disabled_no_leave_type');
		if (previewQuery?.error != null) return previewQuery.error.message;
		if (previewLoading) return t('component.leave_picker_loading_schedule');
		if (preview?.encashed) return t('component.leave_encashed_closed');
		if (preview?.issues[0]?.code === 'ALLOCATION_REQUIRED') return preview.issues[0].message;
		return null;
	});
	const pickerDisabled = $derived(disabled || pickerDisabledReason != null);
	const availableLeaveDays = $derived(
		preview == null || preview.remaining_days == null ? null : Math.max(0, preview.remaining_days)
	);
	const previewIssue = $derived(preview?.issues[0]?.message ?? null);

	function availabilityCopy(day: LeaveDayPreview): string | undefined {
		const code = day.reason_code;
		if (code == null) return undefined;
		switch (code) {
			case 'OUTSIDE_ALLOCATION':
				return t('component.outside_allocation');
			case 'HOLIDAY':
				return t('component.excluded_public_holiday');
			case 'REST_OR_OFF':
				return t('component.excluded_rest_or_off');
			case 'OTHER_LEAVE':
				return t('component.excluded_other_leave');
			case 'PAID_PAYROLL':
				return t('component.excluded_paid_payroll', { period: day.settled_period ?? '' });
			case 'NO_SCHEDULE':
				return t('component.excluded_no_schedule');
			case 'LEAVE_NOT_AVAILABLE':
				return t('component.excluded_leave_unavailable');
			case 'BEFORE_HIRE':
				return t('component.excluded_before_hire');
			case 'AFTER_EXIT':
				return t('component.excluded_after_exit');
			case 'MISSING_ROSTER_CODE':
				return t('component.excluded_no_schedule');
			default: {
				const _exhaustive: never = code;
				return _exhaustive;
			}
		}
	}

	function leaveDayAvailability(date: string): LeaveDayAvailability {
		if (employmentId == null || leaveTypeId == null || preview == null) {
			return { eligible: false, reason: pickerDisabledReason ?? undefined };
		}
		const day = preview.availability[date];
		if (day == null) {
			return { eligible: false, reason: t('component.leave_picker_loading_schedule') };
		}
		return {
			eligible: day.eligible,
			reason: availabilityCopy(day),
			reasonMark: day.reason_mark,
			shiftLabel: day.shift_label,
			firstHalfLabel: day.first_half_label,
			secondHalfLabel: day.second_half_label
		};
	}

	const summary = $derived.by(() => {
		if (current === null) return '—';
		if (current.kind === 'TIME_OFF')
			return `${formatCalendarDate(current.range.start.date)} → ${formatCalendarDate(current.range.end.date)}${current.chargeable_days == null ? '' : ` · ${current.chargeable_days}d`}`;
		if (current.kind === 'CARRY_FORWARD')
			return `${t('renderer.leave_event.kind_carry_forward')} · ${formatCalendarDate(current.effective_on)} · ${current.movement_days}d`;
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
		switch (kind) {
			case 'TIME_OFF':
				return defaultTimeOffEvent(defaultTimeOffDate());
			case 'ENCASHMENT':
				return {
					kind: 'ENCASHMENT',
					effective_on: today(),
					movement_days: 0,
					note: null,
					source_id: null
				};
			case 'BALANCE_ADJUSTMENT':
				return {
					kind: 'BALANCE_ADJUSTMENT',
					effective_on: today(),
					movement_days: 0,
					note: null,
					source_id: null
				};
			case 'CARRY_FORWARD': {
				throw new Error('Carry-forward rows are posted by process_leave_year, never entered here.');
			}
		}
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
		{#if !timeOffOnly}
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
		{/if}

		{#if current?.kind === 'TIME_OFF'}
			<div class="col-span-full min-w-0">
				<HalfDayRangePicker
					value={current.range}
					availability={leaveDayAvailability}
					maximumHalfDays={availableLeaveDays == null ? null : Math.floor(availableLeaveDays * 2)}
					persistedChargeableDays={preview?.chargeable_days ?? current.chargeable_days}
					disabled={pickerDisabled}
					disabledReason={pickerDisabledReason}
					bind:visibleMonth={calendarMonth}
					onValueChange={setTimeOffRange}
				/>
				{#if !pickerDisabled && previewIssue != null}
					<p class="text-xs text-destructive" role="alert">{previewIssue}</p>
				{/if}
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
		{:else if current?.kind === 'CARRY_FORWARD'}
			<!-- Posted once by process_leave_year: shown here, never entered or edited. -->
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('renderer.leave_event.movement_days')}
					<Input type="number" step="0.5" value={current.movement_days} disabled={true} />
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('renderer.leave_event.expires_on')}
					<Input type="date" value={current.expires_on ?? ''} disabled={true} />
				</Stack>
			</label>
			<label class="text-sm font-medium">
				<Stack gap="xs">
					{t('renderer.leave_event.forfeited_days')}
					<Input type="number" step="0.5" value={current.forfeited_days} disabled={true} />
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
