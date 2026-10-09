<script lang="ts">
	/**
	 * A leave request as a month calendar: pick a class, the first and last day, half a day at either end if it is.
	 * What the range charges is the server's count (`leave_days`, `preview_leave`) over this person's own plan, the
	 * published holidays and the class's unit; the grid marks the days that charge nothing and the form only shows it.
	 */
	import { bolt } from '$bolt';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { monthOf, PlainDate } from '@norbital-ai/std/date';
	import { Button, Combobox, DateInput, Label, Sheet, toast } from '@norbital-ai/ui';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { datesBetween, weeksOf } from '../roster/month_board.js';
	import { live, liveRows } from '../state/live.svelte.js';
	import { t } from '../i18n/t.js';
	import { todayKey } from '../format/calendar.js';

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

	let month = $state(todayKey().slice(0, 7));
	let from = $state<string | null>(null);
	let to = $state<string | null>(null);
	let halfStart = $state(false);
	let halfEnd = $state(false);
	let saving = $state(false);
	let note = $state('');
	let catalogId = $state<Id<'leave_catalog'> | null>(null);
	/** What the server's counts read: a change to any re-counts. */
	const READS = ['leave_catalog_entry', 'roster_entry', 'holiday', 'employment_contract'] as const;

	const first = $derived(`${month}-01`);
	const last = $derived(String(monthOf(first).to));
	const dates = $derived(datesBetween(first, last));

	const holidays = liveRows(() =>
		bolt.read('holiday', {
			where: { company_id: { eq: companyId }, published_at: { isNull: false } },
			select: { date: true, name: true },
			all: true
		})
	);
	const taken = liveRows(() =>
		bolt.read('leave_catalog_entry', {
			where: { employment_id: { eq: employmentId }, activity: { eq: 'TIME_OFF' } },
			select: { occurred_on: true, from: true, to: true },
			all: true
		})
	);
	const balances = live(
		() => bolt.query('leave_catalog_entry.leave_balances', { employment_id: employmentId }),
		READS
	);
	/** The shown month as the chosen class counts it: the days that charge nothing. */
	const monthDays = live(
		() =>
			catalogId == null
				? null
				: bolt.query('leave_catalog_entry.leave_days', {
						employment_id: employmentId,
						catalog_id: catalogId,
						from: PlainDate(first),
						to: PlainDate(last)
					}),
		READS
	);
	/** The selection as the server charges it, and the balance after it. */
	const preview = live(
		() =>
			catalogId == null || from == null
				? null
				: bolt.query('leave_catalog_entry.preview_leave', {
						employment_id: employmentId,
						catalog_id: catalogId,
						from: PlainDate(from),
						to: PlainDate(to ?? from),
						half_day_start: halfStart,
						half_day_end: halfEnd
					}),
		READS
	);
	const nonWorking = $derived(new Set(monthDays.current?.off ?? []));
	const chargeable = $derived(preview.current?.requested ?? 0);
	const unit = $derived(preview.current?.unit ?? monthDays.current?.unit ?? 'DAY');

	const takenOn = $derived(
		new Set(
			(taken.current ?? []).flatMap((row) => {
				const start = String(row.from ?? row.occurred_on ?? first).slice(0, 10);
				return datesBetween(start, String(row.to ?? start).slice(0, 10));
			})
		)
	);

	/** Every class of the version in force (its own view), metered or not. */
	const classBalances = $derived(
		(balances.current?.balances ?? []).filter((row) => row.window_key === '')
	);
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

	async function submit(): Promise<void> {
		if (saving || from == null || catalogId == null || !(chargeable > 0)) return;
		saving = true;
		try {
			// `days` is the server's count; the write counts it again and keeps its own.
			const payload: ActInput<'leave_catalog_entry.create'> = {
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
			const outcome = await bolt.act('leave_catalog_entry.create', payload);
			if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
				toast.success(t('leave.requested'));
				onsaved();
			} else {
				toast.error(
					outcome.kind === 'refused'
						? (outcome.message ?? t('component.error'))
						: t('component.error')
				);
			}
		} finally {
			saving = false;
		}
	}
</script>

<Sheet
	open
	title={t('leave.request_title')}
	onOpenChange={(open) => {
		if (!open) onclose();
	}}
>
	<Stack gap="md">
		<Cluster gap="sm">
			<Label>{t('leave.period')}</Label>
			<DateInput
				of="month"
				value={month}
				onChange={(next) => {
					if (next != null) month = next;
				}}
			/>
		</Cluster>

		<Combobox
			class="w-full"
			aria-label={t('component.catalogue_leave')}
			options={classBalances.map((row) => ({ value: row.catalog_id, label: row.name }))}
			value={catalogId}
			disabled={classBalances.length === 0}
			onChange={(next) => (catalogId = next)}
		/>

		<Grid tracks="repeat(7, minmax(0, 1fr))" gap="xs">
			{#each WEEKDAYS as key (key)}
				<span class="text-meta text-center text-xs">{t(key)}</span>
			{/each}
			{#each weeksOf(dates) as week (week.join(','))}
				{#each week as date, cell (cell)}
					{#if date == null}
						<span></span>
					{:else}
						{@const holiday = (holidays.current ?? []).find(
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
							title={holiday?.name ?? (off ? t('leave.not_working') : date)}
						>
							<span class="text-xs font-medium">{date.slice(8)}</span>
							<span class="text-[10px] leading-none opacity-80">
								{holiday
									? t('leave.public_holiday')
									: off
										? t('leave.off_day')
										: takenOn.has(date)
											? t('leave.taken')
											: ''}
							</span>
						</Button>
					{/if}
				{/each}
			{/each}
		</Grid>

		<Cluster gap="md">
			<span class="text-sm">
				{t(unit === 'HOUR' ? 'leave.chargeable_hours' : 'leave.chargeable_days')}
				<strong>{chargeable === 0 ? '—' : chargeable}</strong>
			</span>
			{#if remaining != null}
				<span class="text-meta">{t('leave.remaining', { days: remaining })}</span>
			{/if}
			{#if from != null}
				<span class="text-meta">{from}{to == null ? ' → …' : ` → ${to}`}</span>
			{/if}
		</Cluster>

		{#if preview.error != null}
			<p class="text-sm text-destructive">{preview.error}</p>
		{/if}

		<Cluster gap="md">
			<Button
				variant={halfStart ? 'default' : 'outline'}
				size="sm"
				disabled={from == null}
				onclick={() => (halfStart = !halfStart)}
			>
				{t('leave.half_day_start')}
			</Button>
			<Button
				variant={halfEnd ? 'default' : 'outline'}
				size="sm"
				disabled={from == null || to == null}
				onclick={() => (halfEnd = !halfEnd)}
			>
				{t('leave.half_day_end')}
			</Button>
		</Cluster>

		<input
			class="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm"
			placeholder={t('leave.note')}
			bind:value={note}
		/>

		<Cluster gap="sm">
			<Button onclick={submit} disabled={!(chargeable > 0) || catalogId == null || saving}
				>{t('leave.submit')}</Button
			>
			<Button variant="ghost" onclick={onclose}>{t('component.cancel')}</Button>
		</Cluster>
	</Stack>
</Sheet>
