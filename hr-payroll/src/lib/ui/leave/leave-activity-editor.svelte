<script lang="ts">
	/**
	 * One leave entry's activity, edited as flat fields.
	 *
	 * There is no activity discriminator on the row: which activity the entry is, is the presence
	 * of its fields. The picker below is therefore a control over the field set, and the classifier
	 * both this form and the approval flow read is `leaveActivityOf`.
	 */
	import Labelled from '../Labelled.svelte';
	import { t } from '../t.js';
	import { fromStore } from 'svelte/store';
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { PlainDate } from '@norbital-ai/std/date';
	import { Combobox, DateInput, Input } from '@norbital-ai/ui';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import HalfDayRangePicker, {
		type HalfDayRange,
		type LeaveDayAvailability
	} from '../../ui/leave/half-day-range-picker.svelte';
	import { todayKey } from '../../ui/calendar.js';
	import { leaveWindowOf } from '../../leave/entitlement.js';
	import { addDays } from '../../../lib/payroll/run/dates.js';
	import { numberFrom } from '../../ui/renderer-input.js';
	import { plain } from '../../wire.js';
	import type { LeaveDayPreview, LeavePreview } from '../../leave/preview.js';
	import {
		defaultTimeOffFields,
		emptyActivityFields,
		leaveActivityOf,
		normaliseLeaveDays,
		type LeaveActivityKind,
		type LeaveEntryActivity
	} from '../../leave/activity-fields.js';
	import { timeOffRangeOf } from '../../leave/activity.js';
	import * as Predicate from 'effect/Predicate';

	type Props = {
		readonly values: Readonly<Record<string, unknown>>;
		readonly onValuesChange: (patch: LeaveEntryActivity) => void;
		readonly disabled: boolean;
		readonly selfService: boolean;
		readonly employmentId: Id<'employments'> | null;
		readonly catalogueId: Id<'leave_catalogue'> | null;
	};
	let { values, onValuesChange, disabled, selfService, employmentId, catalogueId }: Props =
		$props();
	const fields = $derived(normaliseLeaveDays(values as LeaveEntryActivity));
	const activity = $derived(leaveActivityOf(fields));
	const range = $derived(timeOffRangeOf(fields));
	const kinds = $derived(
		(['TIME_OFF', 'ENCASHMENT', 'CARRY_FORWARD', 'ADJUSTMENT', 'REVERSAL'] as const).map(
			(value) => ({ value, label: t(`leave.kind.${value}`) })
		)
	);
	let calendarMonth = $state(todayKey().slice(0, 7));
	const previewInput = $derived.by(() => {
		if (disabled || activity !== 'TIME_OFF' || employmentId == null || catalogueId == null)
			return null;
		if (range == null) return null;
		return {
			employment_id: employmentId,
			catalogue_id: catalogueId,
			calendar_month: calendarMonth,
			range: {
				start: { ...range.start, date: PlainDate(range.start.date) },
				end: { ...range.end, date: PlainDate(range.end.date) }
			}
		};
	});
	const previewLive = $derived(
		previewInput == null
			? null
			: bolt.live(bolt.query('leave_entries.preview_leave', previewInput), {
					on: ['leave_entries', 'work_days', 'leave_catalogue']
				})
	);
	const previewStore = $derived(previewLive == null ? null : fromStore(previewLive));
	// The query answers `json`: its shape is `LeavePreview`, asserted where it enters.
	const preview = $derived(previewStore?.current as LeavePreview | undefined);
	const disabledReason = $derived.by(() => {
		if (disabled) return null;
		if (employmentId == null) return t('component.leave_picker_disabled_no_employment');
		if (catalogueId == null) return t('component.leave_picker_disabled_no_catalogue_leave');
		if (previewLive?.error) return previewLive.error.message;
		if (previewLive != null && preview == null) return t('component.leave_picker_loading_schedule');
		return null;
	});
	/** The reversed entry a held reversal names; the form's value is text, asserted where it enters. */
	const reversed = $derived(
		fields.reversal_of_id == null || fields.reversal_of_id === ''
			? null
			: (fields.reversal_of_id as Id<'leave_entries'>)
	);
	/**
	 * The entries a reversal may name: this person's own settled ones no settled reversal already undid. A locked
	 * reversal reads only the entry it names (none yet: nothing to read).
	 */
	const originalsLive = $derived(
		activity === 'REVERSAL' && employmentId != null && (!disabled || reversed != null)
			? bolt.live(
					bolt.read('leave_entries', {
						where: {
							employment_id: { eq: employmentId },
							approval_id: { isNull: true },
							as_adjustment_entry: { eq: false },
							...(disabled && reversed != null
								? { id: { eq: reversed } }
								: { reversals: { none: { approval_id: { isNull: true } } } })
						},
						select: { reference: true, leave_code: true, summary: true },
						orderBy: { effective_on: 'desc' },
						all: true
					})
				)
			: null
	);
	const originals = $derived(originalsLive == null ? null : fromStore(originalsLive));
	const catalogueStore = $derived(
		disabled || catalogueId == null
			? null
			: fromStore(
					bolt.live(
						bolt.get('leave_catalogue', catalogueId, {
							code: true,
							unit: true,
							entitlement: true
						})
					)
				)
	);
	const catalogue = $derived(
		catalogueStore?.current == null ? undefined : plain(catalogueStore.current)
	);
	const originalOptions = $derived(
		(originals?.current?.rows ?? [])
			.filter((row) => disabled || row.leave_code === catalogue?.code)
			.map((row) => ({ value: row.id, label: `${row.reference} · ${row.summary ?? ''}` }))
	);

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
		const period = catalogue?.entitlement ?? 1;
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
	const persistedDays = $derived(Predicate.isNumber(fields.days) ? fields.days : null);
</script>

{#snippet dateField(label: string, value: string, change: (value: string) => void)}
	<Labelled {label} class="text-sm font-medium">
		<DateInput value={value || null} {disabled} onChange={(next) => change(next ?? '')} />
	</Labelled>
{/snippet}

<Grid gap="sm" minimum="compact">
	{#if !selfService}
		<Column span="all">
			<Combobox
				class="w-full"
				options={kinds}
				value={activity}
				{disabled}
				aria-label={t('leave.activity')}
				onChange={selectKind}
			/>
		</Column>
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
		{#if catalogue?.unit === 'HOUR'}
			<Labelled label={t('leave.hours')} class="text-sm font-medium">
				<Input
					type="number"
					step="0.5"
					min="0.5"
					value={fields.hours ?? ''}
					{disabled}
					oninput={(event) => emit({ hours: numberFrom(event.currentTarget.value, 0) || null })}
				/>
			</Labelled>
		{/if}
		{#if catalogue?.entitlement?.availability === 'PER_EVENT'}
			<!-- A grant per event: what happened, to whom, which child, when — the bands read these. -->
			<Labelled label={t('leave.event_kind')} class="text-sm font-medium">
				<Input
					value={fields.event_kind ?? ''}
					{disabled}
					placeholder="BIRTH"
					oninput={(event) =>
						emit({ event_kind: event.currentTarget.value.trim().toUpperCase() || null })}
				/>
			</Labelled>
			<Labelled label={t('leave.event_relationship')} class="text-sm font-medium">
				<Input
					value={fields.event_relationship ?? ''}
					{disabled}
					placeholder="SPOUSE"
					oninput={(event) =>
						emit({ event_relationship: event.currentTarget.value.trim().toUpperCase() || null })}
				/>
			</Labelled>
			<Labelled label={t('leave.event_child_index')} class="text-sm font-medium">
				<Input
					type="number"
					step="1"
					min="1"
					value={fields.event_child_index ?? ''}
					{disabled}
					oninput={(event) =>
						emit({ event_child_index: numberFrom(event.currentTarget.value, 0) || null })}
				/>
			</Labelled>
			{@render dateField(t('leave.event_date'), fields.event_date ?? '', (event_date) => {
				emit({ event_date: event_date || null });
			})}
		{/if}
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
			<Labelled label={t('leave.original_entry')} class="text-sm font-medium">
				<Combobox
					class="w-full"
					placeholder="—"
					options={originalOptions}
					value={reversed}
					{disabled}
					onChange={(next) => next != null && emit({ reversal_of_id: next })}
				/>
			</Labelled>
			{#if originalsLive?.error}<p class="text-sm text-destructive" role="alert">
					{originalsLive.error.message}
				</p>{/if}
			<Column span="all"><p class="text-meta">{t('leave.reversal_hint')}</p></Column>
		{/if}
		{#if activity !== 'REVERSAL'}
			<Labelled label={t('component.days')} class="text-sm font-medium">
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
			</Labelled>
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
		><Labelled label={t('renderer.leave_activity.reason')} class="text-sm font-medium">
			<Input
				value={fields.reason ?? ''}
				{disabled}
				oninput={(event) => emit({ reason: event.currentTarget.value.trim() || null })}
			/>
		</Labelled></Column
	>
</Grid>
