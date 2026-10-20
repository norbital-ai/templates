<!--
	One person-day as a standardized record-style sheet: what the calendar projects, what the roster plans and what
	the clock recorded. The actual section edits the worked intervals (`roster_entry.create`/`update`); a day settled
	on a payslip shows, never edits. The server is the judge: a refusal is its own sentence, in a toast.
-->
<script lang="ts">
	import { Effect } from 'effect';
	import { fork } from '@norbital-ai/ui/effect';
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { PlainDate } from '@norbital-ai/std/date';
	import { Button, Input, Label, Picker, Section, Sheet, toast } from '@norbital-ai/ui';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { t } from '../i18n/t.js';
	import { formatCalendarDate, formatDurationHours } from '../format/display_formatters.js';
	import { parseAmount } from '../../payroll_engine/contract_terms.js';
	import { plannedShift } from '../../payroll_engine/shift_pattern.js';
	import {
		clocksOf,
		clockStampOf,
		completionOf,
		dayEdit,
		describeDay,
		hoursLabel,
		intervalsFrom,
		workedMinutes,
		type Clock,
		type Day,
		type Interval
	} from './month_board.js';
	let {
		open,
		companyId,
		definitions,
		timeZone,
		onClose
	}: {
		/** The day being edited, or null when the dialog is closed. */
		open: {
			readonly employmentId: Id<'employment_contract'>;
			readonly person: string;
			readonly day: Day;
		} | null;
		companyId: Id<'entity'>;
		definitions: readonly {
			readonly id: Id<'shift_definition'>;
			readonly code?: string | null;
			readonly variant?: unknown;
		}[];
		timeZone: string;
		onClose: () => void;
	} = $props();
	// reassigned while editing; a new day resets it
	const originalClocks = $derived(clocksOf(open?.day.intervals ?? null, timeZone));
	let clocks = $derived<Clock[]>(clocksOf(open?.day.intervals ?? null, timeZone));
	const clocksChanged = $derived(JSON.stringify(clocks) !== JSON.stringify(originalClocks));
	let shiftId = $derived(open?.day.shiftId ?? null);
	let plannedOvertime = $derived(
		open?.day.plannedOvertime == null ? '' : String(open.day.plannedOvertime)
	);
	const definition = $derived(definitions.find((row) => row.id === shiftId));
	const planned = $derived(
		shiftId == null
			? (open?.day.pattern ?? null)
			: definition == null
				? null
				: plannedShift(definition)
	);
	const plannedHours = $derived(
		plannedOvertime.trim() === '' ? null : parseAmount(plannedOvertime)
	);
	const invalidPlan = $derived(
		(shiftId != null && definition == null) ||
			(plannedOvertime.trim() !== '' &&
				(plannedHours == null || !Number.isFinite(plannedHours) || definition == null))
	);
	let saving = $state(false);
	function changeClock(index: number, edge: 'start' | 'end', value: string): void {
		clocks = clocks.map((clock, at) =>
			at === index ? { ...clock, [edge]: value === '' ? null : value } : clock
		);
	}
	const draft = $derived(
		open == null
			? null
			: !clocksChanged && open.day.intervals != null
				? { intervals: open.day.intervals }
				: intervalsFrom(clocks, timeZone)
	);
	const minutes = $derived(
		draft == null || !('intervals' in draft) ? null : workedMinutes(draft.intervals)
	);
	const completion = $derived(
		open == null || draft == null || !('intervals' in draft)
			? null
			: completionOf(
					draft.intervals,
					planned,
					open.day.date,
					timeZone,
					shiftId == null ? 0 : plannedHours,
					open.day.approvedOvertimeIntervals
				)
	);
	const overtime = $derived(completion?.overtime_hours ?? null);
	/** The calendar layer: the holiday or leave that governs the day, else its rest or work expectation. */
	const projectedOf = (day: Day): string => {
		const labels = [
			shiftId == null ? (day.pattern?.code ?? null) : null,
			day.leave == null
				? null
				: `${day.leave.name}${day.leave.half ? ` (${t('roster.half_day')})` : ''}`,
			day.holiday
		].filter((label) => label != null);
		return labels.length === 0 ? '—' : labels.join(' · ');
	};
	function save(worked: readonly Interval[] | null): void {
		if (open == null || open.day.locked || invalidPlan) return;
		const set = dayEdit(open.day, definition?.id ?? null, plannedHours, worked);
		const selected = open;
		saving = true;
		fork(
			Effect.gen(function* () {
				const outcome =
					selected.day.entryId == null
						? yield* bolt.act('roster_entry.create', {
								employment_id: selected.employmentId,
								work_date: PlainDate(selected.day.date),
								...set
							})
						: yield* bolt.act('roster_entry.update', { target: selected.day.entryId, set });
				{
					toast.success(
						t(
							outcome.kind === 'pendingApproval'
								? 'roster.day_sheet_pending_approval'
								: 'roster.day_sheet_recorded'
						)
					);
					onClose();
				}
			}).pipe(
				Effect.catch((failure) =>
					Effect.sync(() => {
						toast.error(t('roster.day_sheet_save_failed'), {
							description: failure instanceof Error ? failure.message : t('component.error')
						});
					})
				),
				Effect.ensuring(
					Effect.sync(() => {
						saving = false;
					})
				)
			)
		);
	}
	const saveDraft = () => {
		if (draft == null || !('intervals' in draft)) return;
		if (!clocksChanged && open != null) {
			void save(open.day.intervals);
			return;
		}
		// no interval is no attendance recorded; "Mark absent" is the reviewed empty day
		void save(draft.intervals.length === 0 ? null : draft.intervals);
	};
</script>

{#snippet sheetHeader()}
	{#if open != null}
		<Stack gap="none">
			<h2 class="text-heading truncate">
				{open.person} · {formatCalendarDate(open.day.date)}
			</h2>
			<p class="text-sm text-muted-foreground">
				{describeDay(open.day, formatCalendarDate(open.day.date), timeZone)}
			</p>
		</Stack>
	{/if}
{/snippet}

<Sheet open={open != null} onOpenChange={(next) => !next && onClose()} header={sheetHeader}>
	{#if open != null}
		{@const locked = open.day.locked}
		<Stack gap="md">
			<Section first name="projected" title={t('roster.plan_projected')}>
				<Grid as="dl" gap="sm" minimum="compact" class="text-sm">
					<Stack gap="none">
						<dt class="text-meta">{t('roster.day_sheet_calendar')}</dt>
						<dd class="font-medium">{projectedOf(open.day)}</dd>
					</Stack>
					<Stack gap="none">
						<dt class="text-meta">{t('roster.day_sheet_employment')}</dt>
						<dd class="font-medium">
							{open.day.employed ? '—' : t('roster.before_employment')}
						</dd>
					</Stack>
				</Grid>
			</Section>
			<Section name="planned" title={t('roster.plan_recorded')}>
				<Grid as="dl" gap="sm" minimum="compact" class="text-sm">
					<Stack gap="none">
						<dt><Label for="work-day-shift">{t('component.shift')}</Label></dt>
						<dd>
							<Picker
								of="shift_definition"
								id="work-day-shift"
								where={{ company_id: { eq: companyId } }}
								value={shiftId}
								readonly={locked}
								disabled={saving}
								onChange={(next) => (shiftId = next)}
							/>
						</dd>
					</Stack>
					<Stack gap="none">
						<dt><Label for="work-day-planned-ot">{t('roster.planned_overtime')}</Label></dt>
						<dd>
							<Input
								id="work-day-planned-ot"
								type="number"
								min="0"
								step="0.5"
								value={plannedOvertime}
								readonly={locked}
								disabled={saving}
								aria-invalid={invalidPlan}
								onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
									(plannedOvertime = event.currentTarget.value)}
							/>
						</dd>
					</Stack>
				</Grid>
				{#if invalidPlan}<p class="text-sm text-destructive">
						{t('roster.planned_overtime_invalid')}
					</p>{/if}
			</Section>
			<Section name="actual" title={t('component.work_day_actual')}>
				<Stack gap="sm">
					{#if open.day.approvedOvertimeIntervals != null && open.day.approvedOvertimeIntervals.length > 0}
						<Stack gap="xs">
							<span class="text-meta">{t('roster.approved_overtime_times')}</span>
							{#each open.day.approvedOvertimeIntervals as interval}
								<p class="text-sm tabular-nums">
									<time datetime={interval.start}>{clockStampOf(interval.start, timeZone)}</time> –
									<time datetime={interval.end}>{clockStampOf(interval.end, timeZone)}</time
									>{#if interval.break_minutes != null && interval.break_minutes > 0}<span
											class="text-muted-foreground"
										>
											· {t('roster.approved_break', { minutes: interval.break_minutes })}</span
										>{/if}
								</p>
							{/each}
						</Stack>
					{/if}
					{#if open.day.intervals != null && open.day.intervals.length > 0}
						<Stack gap="xs">
							<span class="text-meta">{t('roster.recorded_clocks')}</span>
							{#each open.day.intervals as interval}
								<p class="text-sm tabular-nums">
									<time datetime={interval.start}>{clockStampOf(interval.start, timeZone)}</time>
									– {#if interval.end != null}<time datetime={interval.end}
											>{clockStampOf(interval.end, timeZone)}</time
										>{:else}{t('roster.progress_open')}{/if}
								</p>
							{/each}
						</Stack>
					{/if}
					{#if clocks.length === 0 && open.day.intervals == null}
						<p class="text-meta">{t('roster.day_sheet_unrecorded_attendance')}</p>
					{/if}
					{#if !locked}
						<p class="text-meta">{t('roster.clock_zone', { zone: timeZone })}</p>
						{#each clocks as clock, index (index)}
							<Stack gap="xs">
								<Grid gap="sm" minimum="compact">
									<Stack gap="xs">
										<Label for={`work-clock-in-${index}`}>{t('roster.clock_in')}</Label>
										<Input
											id={`work-clock-in-${index}`}
											type="datetime-local"
											step="0.001"
											value={clock.start ?? ''}
											disabled={saving}
											onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
												changeClock(index, 'start', event.currentTarget.value)}
										/>
									</Stack>
									<Stack gap="xs">
										<Label for={`work-clock-out-${index}`}>{t('roster.clock_out')}</Label>
										<Input
											id={`work-clock-out-${index}`}
											type="datetime-local"
											step="0.001"
											value={clock.end ?? ''}
											disabled={saving}
											onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
												changeClock(index, 'end', event.currentTarget.value)}
										/>
									</Stack>
								</Grid>
								<Cluster justify="end"
									><Button
										size="sm"
										variant="ghost"
										disabled={saving}
										onclick={() => (clocks = clocks.filter((_, at) => at !== index))}
										>{t('roster.remove_clock_pair')}</Button
									></Cluster
								>
							</Stack>
						{/each}
						<Button
							size="sm"
							variant="outline"
							disabled={saving}
							onclick={() => (clocks = [...clocks, { start: null, end: null }])}
							>{t('roster.add_clock_pair')}</Button
						>
					{/if}
					{#if locked}
						<p class="text-meta">{t('roster.lock_rung_consumed')}</p>
					{:else}
						{#if draft != null && 'problem' in draft}
							<p class="text-sm text-destructive">{t(draft.problem)}</p>
						{:else if minutes != null && minutes > 0}
							<p class="text-meta">
								{t('app.hr_employee.report_punch_preview_worked', {
									hours: formatDurationHours(minutes, t)
								})}
							</p>
						{/if}
					{/if}
					<p class="text-meta">
						{t('roster.actual_overtime')}: {overtime == null
							? '—'
							: formatDurationHours(overtime * 60, t)}
					</p>
					{#if completion?.percent != null}
						<p class="text-meta">
							{t(shiftId == null ? 'roster.projected_progress' : 'roster.actual_progress')}: {t(
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
			{#if !locked}
				<Cluster gap="sm" justify="end">
					<Button variant="outline" disabled={saving || invalidPlan} onclick={() => void save([])}>
						{t('roster.day_sheet_mark_absent')}
					</Button>
					<Button
						disabled={saving || invalidPlan || draft == null || 'problem' in draft}
						onclick={saveDraft}
					>
						{t('roster.save_attendance')}
					</Button>
				</Cluster>
			{/if}
		</Stack>
	{/if}
</Sheet>
