<!--
	One person-day inside its `roster_entry` Form: what the calendar projects, what the roster plans and what the clock
	recorded. The plan and the clocks write the form's own fields; Save is the record's, and the model's transform
	stays the judge. A day settled on a payslip arrives as a readonly form: it shows, never edits.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import * as Predicate from 'effect/Predicate';
	import type { Id } from '@norbital-ai/bolt';
	import {
		Button,
		Field,
		Input,
		Label,
		Picker,
		Section,
		useControls,
		type FormState
	} from '@norbital-ai/ui';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { bolt } from '$bolt';
	import { formatDurationHours } from '../format/display_formatters.js';
	import type { PlannedShift } from '../../payroll_engine/shift_pattern.js';
	import type { AttendancePolicy } from '../../payroll_engine/payslip/context.js';
	import {
		approvedWindowText,
		clocksOf,
		clockStampOf,
		completionOf,
		hoursLabel,
		intervalsFrom,
		intervalsOf,
		numberOrNull,
		workedMinutes,
		type Clock,
		type Day
	} from './month_board.js';

	let {
		form,
		day,
		companyId,
		timeZone,
		policy,
		planOf
	}: {
		form: FormState;
		/** The stored day as the board projects it: calendar, leave, employment and lock. */
		day: Day;
		companyId: Id<'entity'>;
		timeZone: string;
		/** The governing version's attendance terms (`payroll.attendance`): the board's credit, as payroll's. */
		policy: AttendancePolicy | null;
		/** The day's planned shift for a rostered definition, else the pattern's; null when none. */
		planOf: (shiftId: string | null) => PlannedShift | null;
	} = $props();
	const controls = useControls();
	const stored = () => clocksOf(intervalsOf(form.base['worked_intervals'] ?? null), timeZone);
	// edited locally (a half-typed pair is no interval yet); a reset or another zone starts over from the stored clocks
	let clocks = $derived<Clock[]>(stored());
	const draft = $derived(intervalsFrom(clocks, timeZone));
	const editable = $derived(!controls.readonly && !form.locked('worked_intervals'));
	const disabled = $derived(controls.disabled || form.pending);

	onMount(() => {
		const rule = form.addValidation(() =>
			'problem' in draft ? [{ field: 'worked_intervals', message: bolt.t(draft.problem) }] : []
		);
		const reset = form.onReset(() => (clocks = stored()));
		return () => {
			rule();
			reset();
		};
	});

	/** A complete set of clocks is the draft's attendance; no interval is no attendance recorded. */
	function edit(next: Clock[]): void {
		clocks = next;
		const parsed = intervalsFrom(next, timeZone);
		if ('intervals' in parsed)
			form.set('worked_intervals', parsed.intervals.length === 0 ? null : parsed.intervals);
	}
	const changeClock = (index: number, edge: 'start' | 'end', value: string) =>
		edit(
			clocks.map((clock, at) =>
				at === index ? { ...clock, [edge]: value === '' ? null : value } : clock
			)
		);
	/** The reviewed empty day: attendance recorded, nothing worked. */
	function markAbsent(): void {
		clocks = [];
		form.set('worked_intervals', []);
	}

	const shiftId = $derived(form.id<'shift_definition'>('shift_definition_id'));
	const plannedHours = $derived(numberOrNull(form.get('planned_overtime_hours')));
	const worked = $derived(intervalsOf(form.get('worked_intervals')));
	const minutes = $derived(worked == null ? null : workedMinutes(worked));
	const completion = $derived(
		completionOf(
			worked,
			planOf(shiftId),
			day.date,
			timeZone,
			policy,
			shiftId == null ? 0 : plannedHours,
			day.approvedOvertimeIntervals
		)
	);
	const overtime = $derived(completion?.overtime_hours ?? null);
	/** The calendar layer: the holiday or leave that governs the day, else its rest or work expectation. */
	const projected = $derived(
		[
			shiftId == null ? (day.pattern?.code ?? null) : null,
			day.leave == null
				? null
				: `${day.leave.name}${day.leave.half ? ` (${bolt.t('roster.half_day')})` : ''}`,
			day.holiday
		]
			.filter((label) => label != null)
			.join(' · ') || '—'
	);
</script>

<Stack gap="md">
	<Section first name="projected" title={bolt.t('roster.plan_projected')}>
		<Grid as="dl" gap="sm" minimum="compact" class="text-sm">
			<Stack gap="none">
				<dt class="text-meta">{bolt.t('roster.day_sheet_calendar')}</dt>
				<dd class="font-medium">{projected}</dd>
			</Stack>
			<Stack gap="none">
				<dt class="text-meta">{bolt.t('roster.day_sheet_employment')}</dt>
				<dd class="font-medium">{day.employed ? '—' : bolt.t('roster.before_employment')}</dd>
			</Stack>
		</Grid>
	</Section>
	<Section name="planned" title={bolt.t('roster.plan_recorded')}>
		<Grid gap="sm" minimum="compact">
			<Field name="shift_definition_id" label={bolt.t('component.shift')}>
				{#snippet editor(field)}
					<Picker
						of="shift_definition"
						id={field.id}
						where={{ company_id: { eq: companyId } }}
						value={Predicate.isString(field.value) ? field.value : null}
						disabled={field.disabled}
						onChange={field.onChange}
					/>
				{/snippet}
			</Field>
			<Field name="planned_overtime_hours" label={bolt.t('roster.planned_overtime')} />
		</Grid>
		{#if day.approvedOvertimeIntervals != null && day.approvedOvertimeIntervals.length > 0}
			<Stack gap="xs">
				<span class="text-meta">{bolt.t('roster.approved_overtime_times')}</span>
				{#each day.approvedOvertimeIntervals as interval}
					<p class="text-sm tabular-nums">{approvedWindowText(interval, timeZone)}</p>
				{/each}
			</Stack>
		{/if}
	</Section>
	<Section name="actual" title={bolt.t('component.work_day_actual')}>
		<Stack gap="sm">
			{#if editable}
				<p class="text-meta">{bolt.t('roster.clock_zone', { zone: timeZone })}</p>
				{#each clocks as clock, index (index)}
					<Stack gap="xs">
						<Grid gap="sm" minimum="compact">
							<Stack gap="xs">
								<Label for={`work-clock-in-${index}`}>{bolt.t('roster.clock_in')}</Label>
								<Input
									id={`work-clock-in-${index}`}
									type="datetime-local"
									step="0.001"
									value={clock.start ?? ''}
									{disabled}
									onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
										changeClock(index, 'start', event.currentTarget.value)}
								/>
							</Stack>
							<Stack gap="xs">
								<Label for={`work-clock-out-${index}`}>{bolt.t('roster.clock_out')}</Label>
								<Input
									id={`work-clock-out-${index}`}
									type="datetime-local"
									step="0.001"
									value={clock.end ?? ''}
									{disabled}
									onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
										changeClock(index, 'end', event.currentTarget.value)}
								/>
							</Stack>
						</Grid>
						<Cluster justify="end">
							<Button
								size="sm"
								variant="ghost"
								{disabled}
								onclick={() => edit(clocks.filter((_, at) => at !== index))}
								>{bolt.t('roster.remove_clock_pair')}</Button
							>
						</Cluster>
					</Stack>
				{/each}
				<Cluster gap="sm">
					<Button
						size="sm"
						variant="outline"
						{disabled}
						onclick={() => (clocks = [...clocks, { start: null, end: null }])}
						>{bolt.t('roster.add_clock_pair')}</Button
					>
					<Button size="sm" variant="outline" {disabled} onclick={markAbsent}
						>{bolt.t('roster.day_sheet_mark_absent')}</Button
					>
				</Cluster>
				{#if 'problem' in draft}
					<p class="text-sm text-destructive">{bolt.t(draft.problem)}</p>
				{:else if minutes != null && minutes > 0}
					<p class="text-meta">
						{bolt.t('app.hr_employee.report_punch_preview_worked', {
							hours: formatDurationHours(minutes, bolt.t)
						})}
					</p>
				{/if}
			{:else if worked != null && worked.length > 0}
				<Stack gap="xs">
					<span class="text-meta">{bolt.t('roster.recorded_clocks')}</span>
					{#each worked as interval}
						<p class="text-sm tabular-nums">
							<time datetime={interval.start}>{clockStampOf(interval.start, timeZone)}</time>
							– {#if interval.end != null}<time datetime={interval.end}
									>{clockStampOf(interval.end, timeZone)}</time
								>{:else}{bolt.t('roster.progress_open')}{/if}
						</p>
					{/each}
				</Stack>
			{:else if worked == null}
				<p class="text-meta">{bolt.t('roster.day_sheet_unrecorded_attendance')}</p>
			{/if}
			{#if day.locked}<p class="text-meta">{bolt.t('roster.lock_rung_consumed')}</p>{/if}
			<p class="text-meta">
				{bolt.t('roster.actual_overtime')}: {overtime == null
					? '—'
					: formatDurationHours(overtime * 60, bolt.t)}
			</p>
			{#if completion?.percent != null}
				<p class="text-meta">
					{bolt.t(shiftId == null ? 'roster.projected_progress' : 'roster.actual_progress')}: {bolt.t(
						'roster.completion_details',
						{
							percent: Math.floor(completion.percent),
							credited: hoursLabel(completion.credited_hours * 60),
							target: hoursLabel(completion.target_hours * 60)
						}
					)}
				</p>
			{/if}
		</Stack>
	</Section>
</Stack>
