<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { formatCalendarDate } from '../../lib/ui/display-formatters.js';
	import HalfDayRangePicker, {
		type HalfDayRange,
		type LeaveDayAvailability
	} from '../../lib/ui/leave/half-day-range-picker.svelte';
	import { todayKey } from '../../lib/ui/calendar.js';
	import { leaveEventSchema } from './+definition.js';
	import { client } from '../../lib/workspace-client.js';
	import type { RemoteQuery } from '@norbital-ai/std/collection';
	import type {
		LeaveDayPreview,
		LeavePreview,
		PreviewLeaveInput
	} from '../../lib/leave/preview.js';
	import type { RendererProps, Value } from './$types.js';

	type Props = RendererProps & { readonly row?: Record<string, unknown> };
	const { t } = useI18n<TenantI18nKeys>();
	let props: Props = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(Schema.decodeUnknownResult(leaveEventSchema)(props.value));
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
	const employmentId = $derived(
		typeof props.row?.employment_id === 'string' ? props.row.employment_id : null
	);
	const leaveTypeId = $derived(
		typeof props.row?.leave_type_id === 'string' ? props.row.leave_type_id : null
	);
	const accountId = $derived(
		typeof props.row?.leave_account_id === 'string' ? props.row.leave_account_id : null
	);
	const requestId = $derived(typeof props.row?.id === 'string' ? props.row.id : null);
	let calendarMonth = $state(todayKey().slice(0, 7));

	const previewInput = $derived.by((): PreviewLeaveInput | null => {
		if (employmentId == null || leaveTypeId == null) return null;
		return {
			employment_id: employmentId,
			leave_type_id: leaveTypeId,
			...(accountId == null ? {} : { leave_account_id: accountId }),
			calendar_month: calendarMonth,
			...(current == null ? {} : { range: current.range }),
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
	const disabledReason = $derived.by(() => {
		if (disabled) return null;
		if (employmentId == null) return t('component.leave_picker_disabled_no_employment');
		if (leaveTypeId == null) return t('component.leave_picker_disabled_no_leave_type');
		if (previewQuery?.error != null) return previewQuery.error.message;
		if (previewLoading) return t('component.leave_picker_loading_schedule');
		return preview?.issues.find((issue) => issue.code === 'ACCOUNT_REQUIRED')?.message ?? null;
	});
	const availableDays = $derived(
		preview == null || preview.remaining_days == null ? null : Math.max(0, preview.remaining_days)
	);

	function copy(day: LeaveDayPreview): string | undefined {
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
			case 'LEAVE_NOT_AVAILABLE':
				return t('component.excluded_leave_unavailable');
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
		if (day == null) return { eligible: false, reason: disabledReason ?? undefined };
		return {
			eligible: day.eligible,
			reason: copy(day),
			reasonMark: day.reason_mark,
			shiftLabel: day.shift_label,
			firstHalfLabel: day.first_half_label,
			secondHalfLabel: day.second_half_label
		};
	}

	const summary = $derived(
		current == null
			? '—'
			: `${formatCalendarDate(current.range.start.date)} → ${formatCalendarDate(current.range.end.date)}${current.chargeable_days == null ? '' : ` · ${current.chargeable_days}d`}`
	);

	function emit(next: Value | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	function setRange(range: HalfDayRange): void {
		if (current == null) return;
		emit({ ...current, range, chargeable_days: null });
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else if current != null}
	<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
		<div class="col-span-full min-w-0">
			<HalfDayRangePicker
				value={current.range}
				{availability}
				maximumHalfDays={availableDays == null ? null : Math.floor(availableDays * 2)}
				persistedChargeableDays={preview?.chargeable_days ?? current.chargeable_days}
				disabled={disabled || disabledReason != null}
				{disabledReason}
				bind:visibleMonth={calendarMonth}
				onValueChange={setRange}
			/>
			{#if preview?.issues[0]?.message != null && disabledReason == null}
				<p class="text-xs text-destructive" role="alert">{preview.issues[0].message}</p>
			{/if}
			{#if preview?.certificate_required}
				<p class="text-xs text-muted-foreground">{t('component.leave_certificate_required')}</p>
			{/if}
		</div>
		<label class="text-sm font-medium">
			<Stack gap="xs">
				{t('renderer.leave_event.reason')}
				<Input
					value={current.reason ?? ''}
					{disabled}
					placeholder={t('component.blank_none_stated')}
					oninput={(event) =>
						emit({
							...current,
							reason: event.currentTarget.value.trim() === '' ? null : event.currentTarget.value
						})}
				/>
			</Stack>
		</label>
	</Grid>
{/if}
