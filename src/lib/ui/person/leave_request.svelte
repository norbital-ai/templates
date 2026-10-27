<script lang="ts">
	import { Effect } from 'effect';
	import { fork, observeOnce } from '@norbital-ai/ui/effect';
	/**
	 * A leave request as a month calendar: pick a class, the first and last day, half a day at either end if it is.
	 * What the range charges is the leave write's own count (`leaveDays`, `previewLeaveOn`) over this person's own plan, the
	 * published holidays and the class's unit; the grid marks the days that charge nothing and the form only shows it.
	 */
	import { bolt } from '$bolt';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { monthOf, PlainDate } from '@norbital-ai/std/date';
	import { Button, Combobox, TimeInput, Label, Sheet, notifyOutcome, toast } from '@norbital-ai/ui';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { datesBetween, weeksOf } from '../roster/month_board.js';
	import { todayKey } from '../format/calendar.js';
	import { leaveBalancesOn, leaveDays, pageRead, previewLeaveOn } from '../../leave_reads.js';
	let {
		employmentId,
		companyId,
		onsaved,
		onclose
	}: {
		employmentId: Id<'employment_contract'>;
		companyId: Id<'entity'>;
		onsaved: () => void;
		onclose: () => void;
	} = $props();
	const WEEKDAYS = [
		'component.weekday_sun_short',
		'component.weekday_mon_short',
		'component.weekday_tue_short',
		'component.weekday_wed_short',
		'component.weekday_thu_short',
		'component.weekday_fri_short',
		'component.weekday_sat_short'
	] as const;
	const clock = bolt.clock('day');
	let month = $state(todayKey().slice(0, 7));
	let from = $state<string | null>(null);
	let to = $state<string | null>(null);
	let halfStart = $state(false);
	let halfEnd = $state(false);
	let saving = $state(false);
	let note = $state('');
	let catalogId = $state<Id<'leave_catalog'> | null>(null);
	const first = $derived(`${month}-01`);
	const last = $derived(String(monthOf(first).to));
	const dates = $derived(datesBetween(first, last));
	const read = pageRead(bolt.query);
	const holidays = $derived.by(() =>
		bolt.query({
			holiday: {
				where: { company_id: { eq: companyId }, published_at: { isNull: false } },
				fields: ['date', 'name']
			}
		})
	);
	const taken = $derived.by(() =>
		bolt.query({
			leave_catalog_entry: {
				where: { employment_id: { eq: employmentId }, activity: { eq: 'TIME_OFF' } },
				fields: ['occurred_on', 'from', 'to']
			}
		})
	);
	const balances = observeOnce(() => leaveBalancesOn(read, employmentId, clock.today));
	/** The shown month as the chosen class counts it: the days that charge nothing. */
	const monthDays = observeOnce(() =>
		catalogId == null
			? null
			: leaveDays(read, {
					employment_id: employmentId,
					catalog_id: catalogId,
					from: PlainDate(first),
					to: PlainDate(last)
				})
	);
	/** The selection as the write charges it, and the balance after it. */
	const preview = observeOnce(() =>
		catalogId == null || from == null
			? null
			: previewLeaveOn(
					read,
					{
						employment_id: employmentId,
						catalog_id: catalogId,
						from: PlainDate(from),
						to: PlainDate(to ?? from),
						half_day_start: halfStart,
						half_day_end: halfEnd
					},
					clock.today
				)
	);
	const nonWorking = $derived(new Set(monthDays.current?.off ?? []));
	const chargeable = $derived(preview.current?.requested ?? 0);
	const unit = $derived(preview.current?.unit ?? monthDays.current?.unit ?? 'DAY');
	const takenOn = $derived(
		new Set(
			(taken.current?.leave_catalog_entry.rows ?? []).flatMap((row) => {
				const start = String(row.from ?? row.occurred_on ?? first).slice(0, 10);
				return datesBetween(start, String(row.to ?? start).slice(0, 10));
			})
		)
	);
	/** Every class of the version in force (its own view), metered or not. */
	const classBalances = $derived((balances.current ?? []).filter((row) => row.window_key === ''));
	const chosen = $derived(classBalances.find((row) => row.catalog_id === catalogId) ?? null);
	const remaining = $derived(chosen?.metered === true ? chosen.available : null);
	function select(date: string): void {
		if (from == null || to != null) {
			from = date;
			to = null;
			halfStart = false;
			halfEnd = false;
			return;
		}
		if (date < from) {
			from = date;
			return;
		}
		to = date;
	}
	function submit(): void {
		if (saving || from == null || catalogId == null || !(chargeable > 0)) return;
		saving = true;
		const payload: ActInput<'leave_catalog_entry.create'>[number] = {
			catalog_id: catalogId,
			employment_id: employmentId,
			occurred_on: PlainDate(from),
			activity: 'TIME_OFF',
			days: chargeable,
			from: PlainDate(from),
			to: PlainDate(to ?? from),
			...(halfStart ? { half_day_start: true } : {}),
			...(halfEnd ? { half_day_end: true } : {}),
			...(note.trim() === '' ? {} : { label: note.trim() })
		};
		fork(
			Effect.gen(function* () {
				// `days` is the server's count; the write counts it again and keeps its own.
				const outcome = yield* bolt.act('leave_catalog_entry.create', [payload]);
				// past the person-wait the write runs on: its run reports the outcome
				if (outcome.kind === 'running') notifyOutcome(bolt, outcome);
				else toast.success(bolt.t('leave.requested'));
				onsaved();
			}).pipe(
				Effect.catch((failure) =>
					Effect.sync(() => {
						toast.error(failure instanceof Error ? failure.message : bolt.t('component.error'));
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
</script>

<Sheet
	open
	title={bolt.t('leave.request_title')}
	onOpenChange={(open) => {
		if (!open) onclose();
	}}
>
	<Stack gap="md">
		<Cluster gap="sm">
			<Label>{bolt.t('leave.period')}</Label>
			<TimeInput
				of="date"
				precision="month"
				value={month + '-01'}
				onChange={(next: string | null) => {
					if (next != null) month = next.slice(0, 7);
				}}
			/>
		</Cluster>

		<Combobox
			class="w-full"
			aria-label={bolt.t('component.catalogue_leave')}
			options={classBalances.map((row) => ({ value: row.catalog_id, label: row.name }))}
			value={catalogId}
			disabled={classBalances.length === 0}
			onChange={(next) => (catalogId = next)}
		/>

		<Grid tracks="repeat(7, minmax(0, 1fr))" gap="xs">
			{#each WEEKDAYS as key (key)}
				<span class="text-meta text-center text-xs">{bolt.t(key)}</span>
			{/each}
			{#each weeksOf(dates) as week (week.join(','))}
				{#each week as date, cell (cell)}
					{#if date == null}
						<span></span>
					{:else}
						{@const holiday = (holidays.current?.holiday.rows ?? []).find(
							(row) => String(row.date ?? '').slice(0, 10) === date
						)}
						{@const off = nonWorking.has(date)}
						{@const selected = from != null && date >= from && date <= (to ?? from)}
						<!-- repository-health:allow UI27 -- calendar day cell stacks label and status -->
						<Button
							variant={selected ? 'default' : 'ghost'}
							size="sm"
							class="h-auto flex-col gap-0.5 py-1.5"
							onclick={() => select(date)}
							title={holiday?.name ?? (off ? bolt.t('leave.not_working') : date)}
						>
							<span class="text-xs font-medium">{date.slice(8)}</span>
							<span class="text-[10px] leading-none opacity-80">
								{holiday
									? bolt.t('leave.public_holiday')
									: off
										? bolt.t('leave.off_day')
										: takenOn.has(date)
											? bolt.t('leave.taken')
											: ''}
							</span>
						</Button>
					{/if}
				{/each}
			{/each}
		</Grid>

		<Cluster gap="md">
			<span class="text-sm">
				{bolt.t(unit === 'HOUR' ? 'leave.chargeable_hours' : 'leave.chargeable_days')}
				<strong>{chargeable === 0 ? '—' : chargeable}</strong>
			</span>
			{#if remaining != null}
				<span class="text-meta">{bolt.t('leave.remaining', { days: remaining })}</span>
			{/if}
			{#if from != null}
				<span class="text-meta">{from}{to == null ? ' → …' : ` → ${to}`}</span>
			{/if}
		</Cluster>

		{#if preview.error?.message != null}
			<p class="text-sm text-destructive">{preview.error.message}</p>
		{/if}

		<Cluster gap="md">
			<Button
				variant={halfStart ? 'default' : 'outline'}
				size="sm"
				disabled={from == null}
				onclick={() => (halfStart = !halfStart)}
			>
				{bolt.t('leave.half_day_start')}
			</Button>
			<Button
				variant={halfEnd ? 'default' : 'outline'}
				size="sm"
				disabled={from == null || to == null}
				onclick={() => (halfEnd = !halfEnd)}
			>
				{bolt.t('leave.half_day_end')}
			</Button>
		</Cluster>

		<input
			class="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm"
			placeholder={bolt.t('leave.note')}
			bind:value={note}
		/>

		<Cluster gap="sm">
			<Button onclick={submit} disabled={!(chargeable > 0) || catalogId == null || saving}
				>{bolt.t('leave.submit')}</Button
			>
			<Button variant="ghost" onclick={onclose}>{bolt.t('component.cancel')}</Button>
		</Cluster>
	</Stack>
</Sheet>
