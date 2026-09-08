<script lang="ts">
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import {
		formatCalendarDate,
		formatNumeric,
		formatLeaveRange
	} from '../../lib/ui/display-formatters.js';
	import HalfDayRangePicker, {
		type HalfDayRange,
		type LeaveDayAvailability
	} from '../../lib/ui/leave/half-day-range-picker.svelte';
	import { todayKey } from '../../lib/ui/calendar.js';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';
	import { leaveWindowOf } from '../../lib/leave/entitlement.js';
	import { addDays } from '../../collections/payroll_runs/lib/dates.js';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import { defaultTimeOffEvent, type LeaveEvent } from './+definition.js';
	import { client } from '../../lib/workspace-client.js';
	import type { RemoteQuery } from '@norbital-ai/std/collection';
	import type {
		LeaveDayPreview,
		LeavePreview,
		PreviewLeaveInput
	} from '../../lib/leave/preview.js';
	import type { RendererProps } from './$types.js';
	import type { WorkspaceRow } from '$bolt/types.js';

	type Props = RendererProps & { readonly row?: Record<string, unknown> };
	let props: Props = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const scope = hrCreateScope();
	const selfService = $derived(scope?.employmentId != null);
	const disabled = $derived(props.mode !== 'edit' || props.disabled);
	const current = $derived<LeaveEvent>(props.value ?? defaultTimeOffEvent(todayKey()));
	const employmentId = $derived(
		typeof props.row?.employment_id === 'string' ? props.row.employment_id : null
	);
	const catalogueId = $derived(
		typeof props.row?.leave_catalogue_id === 'string' ? props.row.leave_catalogue_id : null
	);
	const entryId = $derived(typeof props.row?.id === 'string' ? props.row.id : null);
	let calendarMonth = $state(todayKey().slice(0, 7));
	const kinds = $derived(
		(['TIME_OFF', 'ENCASHMENT', 'CARRY_FORWARD', 'ADJUSTMENT', 'REVERSAL'] as const).map(
			(value) => ({ value, label: t(`leave.kind.${value}`) })
		)
	);
	const previewInput = $derived.by((): PreviewLeaveInput | null => {
		if (disabled || current.kind !== 'TIME_OFF' || employmentId == null || catalogueId == null)
			return null;
		return {
			employment_id: employmentId,
			leave_catalogue_id: catalogueId,
			calendar_month: calendarMonth,
			range: current.range,
			...(entryId == null ? {} : { exclude_entry_id: entryId })
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
		props.mode === 'edit' && current.kind === 'REVERSAL' && employmentId != null
			? client.db.leave_entries.findMany({
					where: {
						employment_id: { eq: employmentId },
						approval_id: { isNull: true },
						kind: { ne: 'REVERSAL' },
						...(disabled
							? { id: { eq: current.entry_id } }
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
					with: { leave_catalogue_settings: { columns: { currency: true } } }
				})
	);

	const catalogue = $derived(
		catalogueQuery?.current as
			| (WorkspaceRow<'leave_catalogue'> & {
					readonly leave_catalogue_settings?: Pick<
						WorkspaceRow<'jurisdiction_settings'>,
						'currency'
					> | null;
			  })
			| undefined
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
				return t('component.excluded_paid_payroll', { period: day.settled_period ?? '' });
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
	const summary = $derived.by(() => {
		if (props.value == null) return '—';
		const label = t(`leave.kind.${current.kind}`);
		if (current.kind === 'TIME_OFF')
			return `${label} · ${formatLeaveRange(current, t)}${current.chargeable_days == null ? '' : ` · ${formatNumeric(current.chargeable_days)} ${t('component.days')}`}`;
		return `${label} · ${formatCalendarDate(current.effective_on)}${current.days == null ? '' : ` · ${formatNumeric(current.days)} ${t('component.days')}`}`;
	});
	function emit(value: LeaveEvent): void {
		if (props.mode === 'edit') props.onValueChange(value);
	}
	function selectKind(kind: LeaveEvent['kind'] | null): void {
		if (!kind || kind === current.kind) return;
		const on = todayKey();
		const startMonth = catalogueQuery?.current?.entitlement.year_start_month ?? 1;
		const window = leaveWindowOf(on, startMonth);
		const common = { effective_on: on, reason: null };
		switch (kind) {
			case 'TIME_OFF':
				emit(defaultTimeOffEvent(on));
				break;
			case 'ENCASHMENT':
				emit({
					...common,
					kind,
					source_window: window,
					days: 0,
					gross_amount: {
						value: 0,
						currency: catalogue?.leave_catalogue_settings?.currency ?? ''
					},
					rate: null,
					due_on: on
				});
				break;
			case 'CARRY_FORWARD':
				emit({
					...common,
					kind,
					source_window: leaveWindowOf(addDays(window.start, -1), startMonth),
					destination_window: window,
					days: 0,
					available_from: window.start,
					expires_on: window.end
				});
				break;
			case 'ADJUSTMENT':
				emit({ ...common, kind, window, days: 0 });
				break;
			case 'REVERSAL':
				emit({ ...common, kind, entry_id: '', due_on: null, days: null, gross_amount: null });
				break;
		}
	}
	function setRange(range: HalfDayRange): void {
		if (current.kind === 'TIME_OFF') emit({ ...current, range, chargeable_days: null });
	}
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

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Grid gap="sm" minimum="compact">
		{#if !selfService}
			<Column span="all"
				><label class="text-sm font-medium"
					><Stack gap="xs">
						{t('leave.activity')}
						<Combobox
							options={kinds}
							value={current.kind}
							{disabled}
							searchable={false}
							onValueChange={selectKind}
						/>
					</Stack></label
				></Column
			>
		{/if}
		{#if current.kind === 'TIME_OFF'}
			<Column span="all">
				<HalfDayRangePicker
					value={current.range}
					{availability}
					maximumHalfDays={preview?.remaining_days == null
						? null
						: Math.max(0, Math.floor(preview.remaining_days * 2))}
					persistedChargeableDays={preview?.chargeable_days ?? current.chargeable_days}
					disabled={disabled || disabledReason != null}
					{disabledReason}
					bind:visibleMonth={calendarMonth}
					onValueChange={setRange}
				/>
				{#if preview?.issues[0]?.message}<p class="text-xs text-destructive" role="alert">
						{preview.issues[0].message}
					</p>{/if}
				{#if preview?.certificate_required}<p class="text-meta">
						{t('component.leave_certificate_required')}
					</p>{/if}
			</Column>
		{:else}
			{@render dateField(t('component.effective_date'), current.effective_on, (effective_on) => {
				emit({ ...current, effective_on });
			})}
			{#if current.kind === 'ENCASHMENT' || current.kind === 'CARRY_FORWARD'}
				{@render dateField(t('leave.source_start'), current.source_window.start, (start) => {
					if (current.kind === 'ENCASHMENT' || current.kind === 'CARRY_FORWARD')
						emit({ ...current, source_window: { ...current.source_window, start } });
				})}
				{@render dateField(t('leave.source_end'), current.source_window.end, (end) => {
					if (current.kind === 'ENCASHMENT' || current.kind === 'CARRY_FORWARD')
						emit({ ...current, source_window: { ...current.source_window, end } });
				})}
			{/if}
			{#if current.kind === 'CARRY_FORWARD'}
				{@render dateField(
					t('leave.destination_start'),
					current.destination_window.start,
					(start) => {
						if (current.kind === 'CARRY_FORWARD')
							emit({ ...current, destination_window: { ...current.destination_window, start } });
					}
				)}
				{@render dateField(t('leave.destination_end'), current.destination_window.end, (end) => {
					if (current.kind === 'CARRY_FORWARD')
						emit({ ...current, destination_window: { ...current.destination_window, end } });
				})}
				{@render dateField(t('leave.available_from'), current.available_from, (available_from) => {
					if (current.kind === 'CARRY_FORWARD') emit({ ...current, available_from });
				})}
				{@render dateField(t('component.expires'), current.expires_on, (expires_on) => {
					if (current.kind === 'CARRY_FORWARD') emit({ ...current, expires_on });
				})}
			{:else if current.kind === 'ADJUSTMENT'}
				{@render dateField(t('leave.window_start'), current.window.start, (start) => {
					if (current.kind === 'ADJUSTMENT')
						emit({ ...current, window: { ...current.window, start } });
				})}
				{@render dateField(t('leave.window_end'), current.window.end, (end) => {
					if (current.kind === 'ADJUSTMENT')
						emit({ ...current, window: { ...current.window, end } });
				})}
			{:else if current.kind === 'REVERSAL'}
				<label class="text-sm font-medium"
					><Stack gap="xs"
						>{t('leave.original_entry')}
						<Combobox
							options={originalOptions}
							value={current.entry_id || null}
							{disabled}
							onValueChange={(entry_id) => {
								if (entry_id && current.kind === 'REVERSAL') emit({ ...current, entry_id });
							}}
						/>
					</Stack></label
				>
				{#if originalsQuery?.error}<p class="text-sm text-destructive" role="alert">
						{originalsQuery.error.message}
					</p>{/if}
				<Column span="all"><p class="text-meta">{t('leave.reversal_hint')}</p></Column>
			{/if}
			{#if current.kind !== 'REVERSAL'}
				<label class="text-sm font-medium"
					><Stack gap="xs"
						>{t('component.days')}
						<Input
							type="number"
							step="0.5"
							min={current.kind === 'ADJUSTMENT' ? undefined : 0.5}
							value={current.days || ''}
							{disabled}
							oninput={(event) => {
								emit({ ...current, days: numberFrom(event.currentTarget.value, 0) });
							}}
						/>
					</Stack></label
				>
			{/if}
			{#if current.kind === 'ENCASHMENT' || current.kind === 'REVERSAL'}
				{@render dateField(t('leave.due_on'), current.due_on ?? '', (due_on) => {
					if (current.kind === 'ENCASHMENT') emit({ ...current, due_on });
					else if (current.kind === 'REVERSAL') emit({ ...current, due_on: due_on || null });
				})}
			{/if}
			{#if current.kind === 'ENCASHMENT'}
				<label class="text-sm font-medium"
					><Stack gap="xs"
						>{t('leave.agreed_gross')}
						<Input
							type="number"
							min="0"
							step="0.01"
							value={current.gross_amount.value}
							{disabled}
							oninput={(event) => {
								if (current.kind === 'ENCASHMENT')
									emit({
										...current,
										gross_amount: {
											...current.gross_amount,
											value: numberFrom(event.currentTarget.value, 0)
										}
									});
							}}
						/>
					</Stack></label
				>
				<label class="text-sm font-medium"
					><Stack gap="xs"
						>{t('component.currency')}
						<Input
							value={current.gross_amount.currency}
							maxlength={3}
							{disabled}
							oninput={(event) => {
								if (current.kind === 'ENCASHMENT')
									emit({
										...current,
										gross_amount: {
											...current.gross_amount,
											currency: event.currentTarget.value.toUpperCase()
										}
									});
							}}
						/>
					</Stack></label
				>
				<label class="text-sm font-medium"
					><Stack gap="xs"
						>{t('leave.agreed_rate')}
						<Input
							type="number"
							min="0"
							step="0.01"
							value={current.rate ?? ''}
							{disabled}
							oninput={(event) => {
								if (current.kind === 'ENCASHMENT')
									emit({
										...current,
										rate:
											event.currentTarget.value === ''
												? null
												: numberFrom(event.currentTarget.value, 0)
									});
							}}
						/>
					</Stack></label
				>
				<Column span="all"><p class="text-meta">{t('leave.encashment_hint')}</p></Column>
			{/if}
		{/if}
		<Column span="all"
			><label class="text-sm font-medium"
				><Stack gap="xs">
					{t('renderer.leave_event.reason')}
					<Input
						value={current.reason ?? ''}
						{disabled}
						oninput={(event) =>
							emit({ ...current, reason: event.currentTarget.value.trim() || null })}
					/>
				</Stack></label
			></Column
		>
	</Grid>
{/if}
