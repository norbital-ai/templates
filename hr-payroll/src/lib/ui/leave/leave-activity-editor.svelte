<script lang="ts">
	/**
	 * One leave entry's activity, edited as flat fields.
	 *
	 * There is no activity discriminator on the row: which activity the entry is, is the presence
	 * of its fields. The picker below is therefore a control over the field set, and the classifier
	 * both this form and the approval flow read is `leaveActivityOf`.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { formatCalendarDate } from '../../ui/display-formatters.js';
	import HalfDayRangePicker, {
		type HalfDayRange,
		type LeaveDayAvailability
	} from '../../ui/leave/half-day-range-picker.svelte';
	import { todayKey } from '../../ui/calendar.js';
	import { leaveWindowOf } from '../../leave/entitlement.js';
	import { addDays } from '../../../collections/payroll_runs/lib/dates.js';
	import { numberFrom } from '../../ui/renderer-input.js';
	import { client } from '../../workspace-client.js';
	import type { RemoteQuery } from '@norbital-ai/std/collection';
	import type { LeaveDayPreview, LeavePreview, PreviewLeaveInput } from '../../leave/preview.js';
	import {
		defaultTimeOffFields,
		emptyActivityFields,
		leaveActivityOf,
		normaliseLeaveDays,
		type LeaveActivityKind,
		type LeaveEntryActivity
	} from '../../leave/activity-fields.js';
	import { timeOffRangeOf } from '../../leave/activity.js';

	type Props = {
		readonly values: Readonly<Record<string, unknown>>;
		readonly onValuesChange: (patch: LeaveEntryActivity) => void;
		readonly disabled: boolean;
		readonly selfService: boolean;
		readonly employmentId: string | null;
		readonly catalogueId: string | null;
	};
	let { values, onValuesChange, disabled, selfService, employmentId, catalogueId }: Props =
		$props();
	const { t } = useI18n<TenantI18nKeys>();
	const fields = $derived(normaliseLeaveDays(values as LeaveEntryActivity));
	const activity = $derived(leaveActivityOf(fields));
	const range = $derived(timeOffRangeOf(fields));
	const kinds = $derived(
		(['TIME_OFF', 'ENCASHMENT', 'CARRY_FORWARD', 'ADJUSTMENT', 'REVERSAL'] as const).map(
			(value) => ({ value, label: t(`leave.kind.${value}`) })
		)
	);
	let calendarMonth = $state(todayKey().slice(0, 7));
	const previewInput = $derived.by((): PreviewLeaveInput | null => {
		if (disabled || activity !== 'TIME_OFF' || employmentId == null || catalogueId == null)
			return null;
		if (range == null) return null;
		return {
			employment_id: employmentId,
			catalogue_id: catalogueId,
			calendar_month: calendarMonth,
			range
		};
	});
	const previewQuery = $derived(
		previewInput == null
			? null
			: (client.invoke.preview_leave(previewInput) as RemoteQuery<LeavePreview>)
	);
	const preview = $derived(previewQuery?.current);
	const disabledReason = $derived.by(() => {
		if (disabled) return null;
		if (employmentId == null) return t('component.leave_picker_disabled_no_employment');
		if (catalogueId == null) return t('component.leave_picker_disabled_no_catalogue_leave');
		if (previewQuery?.error) return previewQuery.error.message;
		if (previewQuery?.loading && preview == null)
			return t('component.leave_picker_loading_schedule');
		return null;
	});
	const originalsQuery = $derived(
		activity === 'REVERSAL' && employmentId != null
			? client.db.leave_entries.findMany({
					where: {
						employment_id: { eq: employmentId },
						approval_id: { isNull: true },
						as_adjustment_entry: { eq: false },
						...(disabled
							? { id: { eq: fields.reversal_of_id ?? '' } }
							: { leave_original_reversals: { none: { approval_id: { isNull: true } } } })
					},
					columns: { id: true, reference: true, leave_code: true, summary: true },
					orderBy: { effective_on: 'desc' },
					limit: 2_000
				})
			: null
	);
	const originalOptions = $derived(
		(originalsQuery?.current ?? [])
			.filter((row) => disabled || row.leave_code === catalogue?.code)
			.map((row) => ({ value: row.id, label: `${row.reference} · ${row.summary}` }))
	);
	const catalogueQuery = $derived(
		disabled || catalogueId == null
			? null
			: client.db.leave_catalogue.findFirst({
					where: { id: { eq: catalogueId } },
					with: { leave_catalogue_settings: { columns: { payroll: true } } }
				})
	);

	const catalogue = $derived(catalogueQuery?.current);

	function reasonCopy(day: LeaveDayPreview): string | undefined {
		switch (day.reason_code) {
			case undefined:
				return undefined;
			case 'HOLIDAY':
				return t('component.excluded_public_holiday');
			case 'REST_OR_OFF':
				return t('component.excluded_rest_or_off');
			case 'OTHER_LEAVE':
				return t('component.excluded_other_leave');
			case 'PAID_PAYROLL':
				return t('component.excluded_paid_payroll');
			case 'NO_SCHEDULE':
			case 'MISSING_ROSTER_CODE':
				return t('component.excluded_no_schedule');
			case 'INELIGIBLE':
				return t('component.leave_eligibility_not_met');
			case 'BEFORE_HIRE':
				return t('component.excluded_before_hire');
			case 'AFTER_EXIT':
				return t('component.excluded_after_exit');
		}
	}
	function availability(date: string): LeaveDayAvailability {
		const day = preview?.availability[date];
		if (!day) return { eligible: false, reason: disabledReason ?? undefined };
		return {
			eligible: day.eligible,
			firstHalfAvailable: day.first_half_available,
			secondHalfAvailable: day.second_half_available,
			reason: reasonCopy(day),
			reasonMark: day.reason_mark,
			shiftLabel: day.shift_label,
			firstHalfLabel: day.first_half_label,
			secondHalfLabel: day.second_half_label
		};
	}
	function emit(patch: LeaveEntryActivity): void {
		onValuesChange(patch);
	}
	function selectKind(kind: LeaveActivityKind | null): void {
		if (!kind || kind === activity) return;
		const on = todayKey();
		const period = catalogueQuery?.current?.entitlement ?? 1;
		const window = leaveWindowOf(on, period);
		const common = { effective_on: on, reason: null };
		switch (kind) {
			case 'TIME_OFF':
				emit({ ...emptyActivityFields(), ...defaultTimeOffFields(on) });
				break;
			case 'ENCASHMENT':
				emit({
					...emptyActivityFields(),
					...common,
					from_date: window.start,
					to_date: window.end,
					days: 0,
					encash_days: 0,
					due_on: on
				});
				break;
			case 'CARRY_FORWARD': {
				const source = leaveWindowOf(addDays(window.start, -1), period);
				emit({
					...emptyActivityFields(),
					...common,
					from_date: source.start,
					to_date: source.end,
					destination_from: window.start,
					destination_to: window.end,
					days: 0,
					available_from: window.start,
					expires_on: window.end
				});
				break;
			}
			case 'ADJUSTMENT':
				emit({
					...emptyActivityFields(),
					...common,
					from_date: window.start,
					to_date: window.end,
					days: 0
				});
				break;
			case 'REVERSAL':
				emit({
					...emptyActivityFields(),
					...common,
					as_adjustment_entry: true,
					reversal_of_id: '',
					due_on: null,
					days: null
				});
				break;
		}
	}
	function setRange(next: HalfDayRange): void {
		emit({
			from_date: next.start.date,
			to_date: next.end.date,
			half_day_start: next.start.half === 'SECOND',
			half_day_end: next.end.half === 'FIRST',
			days: null
		});
	}
	const persistedDays = $derived(typeof fields.days === 'number' ? fields.days : null);
</script>

{#snippet dateField(label: string, value: string, change: (value: string) => void)}
	<label class="text-sm font-medium"
		><Stack gap="xs"
			>{label}<Input
				type="date"
				{value}
				{disabled}
				oninput={(event) => change(event.currentTarget.value)}
			/></Stack
		></label
	>
{/snippet}

<Grid gap="sm" minimum="compact">
	{#if !selfService}
		<Column span="all"
			><Combobox
				options={kinds}
				value={activity}
				{disabled}
				searchable={false}
				onValueChange={selectKind}
			/></Column
		>
	{/if}
	{#if activity === 'TIME_OFF'}
		<Column span="all">
			{#if range != null}
				<HalfDayRangePicker
					value={range}
					{availability}
					maximumHalfDays={preview?.remaining_days == null
						? null
						: Math.max(0, Math.floor(preview.remaining_days * 2))}
					persistedChargeableDays={preview?.chargeable_days ?? persistedDays}
					disabled={disabled || disabledReason != null}
					{disabledReason}
					bind:visibleMonth={calendarMonth}
					onValueChange={setRange}
				/>
			{/if}
			{#if preview?.issues[0]?.message}<p class="text-xs text-destructive" role="alert">
					{preview.issues[0].message}
				</p>{/if}
			{#if preview?.certificate_required}<p class="text-meta">
					{t('component.leave_certificate_required')}
				</p>{/if}
		</Column>
	{:else}
		{@render dateField(t('component.effective_date'), fields.effective_on ?? '', (effective_on) => {
			emit({ effective_on });
		})}
		{#if activity === 'ENCASHMENT' || activity === 'CARRY_FORWARD'}
			{@render dateField(t('leave.source_start'), fields.from_date ?? '', (start) => {
				emit({ from_date: start });
			})}
			{@render dateField(t('leave.source_end'), fields.to_date ?? '', (end) => {
				emit({ to_date: end });
			})}
		{/if}
		{#if activity === 'CARRY_FORWARD'}
			{@render dateField(
				t('leave.destination_start'),
				fields.destination_from ?? '',
				(destination_from) => {
					emit({ destination_from });
				}
			)}
			{@render dateField(
				t('leave.destination_end'),
				fields.destination_to ?? '',
				(destination_to) => {
					emit({ destination_to });
				}
			)}
			{@render dateField(
				t('leave.available_from'),
				fields.available_from ?? '',
				(available_from) => {
					emit({ available_from });
				}
			)}
			{@render dateField(t('component.expires'), fields.expires_on ?? '', (expires_on) => {
				emit({ expires_on });
			})}
		{:else if activity === 'ADJUSTMENT'}
			{@render dateField(t('leave.window_start'), fields.from_date ?? '', (from_date) => {
				emit({ from_date });
			})}
			{@render dateField(t('leave.window_end'), fields.to_date ?? '', (to_date) => {
				emit({ to_date });
			})}
		{:else if activity === 'REVERSAL'}
			<label class="text-sm font-medium"
				><Stack gap="xs"
					>{t('leave.original_entry')}
					<Combobox
						options={originalOptions}
						value={fields.reversal_of_id || null}
						{disabled}
						onValueChange={(reversal_of_id) => {
							if (reversal_of_id) emit({ reversal_of_id });
						}}
					/>
				</Stack></label
			>
			{#if originalsQuery?.error}<p class="text-sm text-destructive" role="alert">
					{originalsQuery.error.message}
				</p>{/if}
			<Column span="all"><p class="text-meta">{t('leave.reversal_hint')}</p></Column>
		{/if}
		{#if activity !== 'REVERSAL'}
			<label class="text-sm font-medium"
				><Stack gap="xs"
					>{t('component.days')}
					<Input
						type="number"
						step="0.5"
						min={activity === 'ADJUSTMENT' ? undefined : 0.5}
						value={fields.days ?? ''}
						{disabled}
						oninput={(event) => {
							const days = numberFrom(event.currentTarget.value, 0);
							if (activity === 'ENCASHMENT') emit({ days, encash_days: days });
							else emit({ days });
						}}
					/>
				</Stack></label
			>
		{/if}
		{#if activity === 'ENCASHMENT' || activity === 'REVERSAL'}
			{@render dateField(t('leave.due_on'), fields.due_on ?? '', (due_on) => {
				emit({ due_on: due_on || null });
			})}
		{/if}
		{#if activity === 'ENCASHMENT'}
			<Column span="all"><p class="text-meta">{t('leave.encashment_hint')}</p></Column>
		{/if}
	{/if}
	<Column span="all"
		><label class="text-sm font-medium"
			><Stack gap="xs">
				{t('renderer.leave_activity.reason')}
				<Input
					value={fields.reason ?? ''}
					{disabled}
					oninput={(event) => emit({ reason: event.currentTarget.value.trim() || null })}
				/>
			</Stack></label
		></Column
	>
</Grid>
