<!--
	One person-day as a standardized record-style sheet: what the calendar projects, what the roster plans and what
	the clock recorded. The actual section edits the worked intervals (`roster_entry.create`/`update`); a day settled
	on a payslip shows, never edits. The server is the judge: a refusal is its own sentence, in a toast.
-->
<script lang="ts">
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant, PlainDate } from '@norbital-ai/std/date';
	import { Button, Icon, Section, Sheet, TimeRangeInput, toast } from '@norbital-ai/ui';
	import { Cluster, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { t } from '../i18n/t.js';
	import { formatCalendarDate, formatDurationHours } from '../format/display_formatters.js';
	import {
		clocksOf,
		describeDay,
		intervalsFrom,
		isWeekend,
		workedMinutes,
		type Clock,
		type Day,
		type Interval
	} from './month_board.js';

	let {
		open,
		timeZone,
		onClose
	}: {
		/** The day being edited, or null when the dialog is closed. */
		open: {
			readonly employmentId: Id<'employment_contract'>;
			readonly person: string;
			readonly day: Day;
		} | null;
		timeZone: string;
		onClose: () => void;
	} = $props();

	// reassigned while editing; a new day resets it
	let clocks = $derived<Clock[]>(clocksOf(open?.day.intervals ?? null, timeZone));
	let saving = $state(false);

	const draft = $derived(open == null ? null : intervalsFrom(open.day.date, clocks, timeZone));
	const minutes = $derived(
		draft == null || !('intervals' in draft) ? null : workedMinutes(draft.intervals)
	);

	/** The calendar layer: the holiday or leave that governs the day, else its rest or work expectation. */
	const projectedOf = (day: Day): string =>
		day.holiday ??
		(day.leave == null ? null : day.leave.name) ??
		(isWeekend(day.date)
			? t('roster.rest_day')
			: new Date(`${day.date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'long' }));

	async function save(worked: readonly Interval[] | null): Promise<void> {
		if (open == null || open.day.locked) return;
		const set = {
			worked_intervals:
				worked == null
					? null
					: worked.map((interval) => ({
							start: Instant(interval.start),
							end: interval.end == null ? null : Instant(interval.end)
						}))
		};
		saving = true;
		try {
			const outcome =
				open.day.entryId == null
					? await bolt.act('roster_entry.create', {
							employment_id: open.employmentId,
							work_date: PlainDate(open.day.date),
							...set
						})
					: await bolt.act('roster_entry.update', { target: open.day.entryId, set });
			if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
				toast.success(
					t(
						outcome.kind === 'pendingApproval'
							? 'roster.day_sheet_pending_approval'
							: 'roster.day_sheet_recorded'
					)
				);
				onClose();
			} else
				toast.error(t('roster.day_sheet_save_failed'), {
					description: outcome.kind === 'refused' ? outcome.message : t('component.error')
				});
		} catch {
			toast.error(t('roster.day_sheet_save_failed'), { description: t('component.error') });
		} finally {
			saving = false;
		}
	}

	const saveDraft = () => {
		if (draft == null || !('intervals' in draft)) return;
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
						<dt class="text-meta">{t('component.shift')}</dt>
						<dd class="font-medium">{open.day.shift ?? '—'}</dd>
					</Stack>
					<Stack gap="none">
						<dt class="text-meta">{t('roster.day_sheet_approved_overtime')}</dt>
						<dd class="font-medium">{open.day.overtime ?? '—'}</dd>
					</Stack>
					<Stack gap="none">
						<dt class="text-meta">{t('roster.day_sheet_incentive_hours')}</dt>
						<dd class="font-medium">{open.day.incentive ?? '—'}</dd>
					</Stack>
				</Grid>
			</Section>
			<Section name="actual" title={t('component.work_day_actual')}>
				<Stack gap="sm">
					{#if clocks.length === 0}
						<p class="text-meta">{t('roster.day_sheet_unrecorded_attendance')}</p>
					{/if}
					{#each clocks as clock, index (index)}
						<Inline gap="xs">
							<TimeRangeInput
								value={clock}
								readonly={locked}
								disabled={saving}
								aria-label={t('roster.day_sheet_interval', { number: index + 1 })}
								onChange={(next) => (clocks = clocks.map((c, i) => (i === index ? next : c)))}
							/>
							{#if !locked}
								<Button
									variant="ghost"
									size="icon"
									disabled={saving}
									aria-label={t('roster.day_sheet_remove_interval', { number: index + 1 })}
									onclick={() => (clocks = clocks.filter((_, i) => i !== index))}
								>
									<Icon name="lucide:x" class="size-4" />
								</Button>
							{/if}
						</Inline>
					{/each}
					{#if locked}
						<p class="text-meta">{t('roster.lock_rung_consumed')}</p>
					{:else}
						<Cluster gap="sm">
							<Button
								variant="outline"
								size="sm"
								disabled={saving}
								onclick={() => (clocks = [...clocks, { start: null, end: null }])}
							>
								{t('roster.day_sheet_add_interval')}
							</Button>
						</Cluster>
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
				</Stack>
			</Section>
			{#if !locked}
				<Cluster gap="sm" justify="end">
					<Button variant="outline" disabled={saving} onclick={() => void save([])}>
						{t('roster.day_sheet_mark_absent')}
					</Button>
					<Button disabled={saving || draft == null || 'problem' in draft} onclick={saveDraft}>
						{t('roster.save_attendance')}
					</Button>
				</Cluster>
			{/if}
		</Stack>
	{/if}
</Sheet>
