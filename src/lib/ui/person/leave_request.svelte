<script lang="ts">
	/**
	 * A leave request as a month calendar: pick the first and last day, half a day at either end if it is, and the
	 * chargeable days fall out of it. The grid shows the days this person is not rostered to work that month — a
	 * shift cycle's rest and off days and the entity's published holidays — and the count skips them rather than
	 * the range, so a request spanning a week off still costs only the working days.
	 */
	import { bolt } from '$bolt';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { PlainDate } from '@norbital-ai/std/date';
	import { toast } from 'svelte-sonner';
	import { Button, Combobox, DateInput, Label, Sheet } from '@norbital-ai/ui';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { Schema } from 'effect';
	import { chargeableDays } from '../../../lib/payroll_engine/leave.js';
	import { cycleDayOn, cycleDays } from '../../payroll_engine/shift_pattern.js';
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

	const Variant = Schema.Struct({ day_type: Schema.optional(Schema.String) });
	const Range = Schema.Struct({ from: Schema.optional(Schema.String) });
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

	const lastDay = $derived(
		String(new Date(Date.parse(`${month}-01T00:00:00Z`) + 31 * 86400000).getUTCDate())
	);
	const first = $derived(`${month}-01`);
	const last = $derived(`${month}-${lastDay.padStart(2, '0')}`);
	const dates = $derived(datesBetween(first, last));

	const patterns = liveRows(() =>
		bolt.read('shift_pattern', {
			where: { company_id: { eq: companyId } },
			select: { id: true, pattern: true, effective_range: true },
			all: true
		})
	);
	const definitions = liveRows(() =>
		bolt.read('shift_definition', {
			where: { company_id: { eq: companyId } },
			select: { id: true, variant: true },
			all: true
		})
	);
	const holidays = liveRows(() =>
		bolt.read('holiday', {
			where: { company_id: { eq: companyId } },
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
	const balances = live(() =>
		bolt.query('leave_catalog_entry.leave_balances', { employment_id: employmentId })
	);

	/** Definition id → kind, so a cycle day reads as working, rest or off. */
	const kinds = $derived(
		new Map(
			(definitions.current ?? []).map((row) => [
				String(row.id),
				Schema.is(Variant)(row.variant) ? (row.variant.day_type ?? 'WORK') : 'WORK'
			])
		)
	);

	/** The dates this person is not rostered to work in the shown month. */
	const nonWorking = $derived.by((): ReadonlySet<string> => {
		const held = new Set<string>();
		for (const row of holidays.current ?? []) {
			const date = String(row.date ?? '').slice(0, 10);
			if (date >= first && date <= last) held.add(date);
		}
		for (const pattern of patterns.current ?? []) {
			const anchor = Schema.is(Range)(pattern.effective_range)
				? (pattern.effective_range.from ?? null)
				: null;
			if (anchor == null) continue;
			const days = cycleDays(pattern.pattern);
			for (const date of dates) {
				const rosterCodeId = cycleDayOn(days, anchor, date)?.roster_code_id;
				const kind =
					rosterCodeId != null && rosterCodeId !== '' ? kinds.get(String(rosterCodeId)) : undefined;
				if (kind === 'REST' || kind === 'OFF') held.add(date);
			}
		}
		return held;
	});

	const takenOn = $derived(
		new Set(
			(taken.current ?? []).flatMap((row) => {
				const start = String(row.from ?? row.occurred_on ?? first).slice(0, 10);
				return datesBetween(start, String(row.to ?? start).slice(0, 10));
			})
		)
	);

	const chargeable = $derived(
		from == null
			? 0
			: chargeableDays({
					from,
					to,
					half_day_start: halfStart,
					half_day_end: halfEnd,
					nonWorking: nonWorking
				})
	);
	const classBalances = $derived(
		(balances.current?.balances ?? []).filter((row) => row.metered && row.window_key === '')
	);
	let catalogId = $state<Id<'leave_catalog'> | null>(null);
	const chosen = $derived(
		classBalances.find((row) => row.catalog_id === catalogId) ?? classBalances[0]
	);
	const selectedCatalogId = $derived(chosen?.catalog_id ?? null);
	const remaining = $derived(chosen?.available ?? null);

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
		if (saving || from == null || selectedCatalogId == null || !(chargeable > 0)) return;
		saving = true;
		try {
			const payload: ActInput<'leave_catalog_entry.create'> = {
				catalog_id: selectedCatalogId,
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
			value={selectedCatalogId}
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
				{t('leave.chargeable_days')}
				<strong>{chargeable === 0 ? '—' : chargeable}</strong>
			</span>
			{#if remaining != null}
				<span class="text-meta">{t('leave.remaining', { days: remaining })}</span>
			{/if}
			{#if from != null}
				<span class="text-meta">{from}{to == null ? ' → …' : ` → ${to}`}</span>
			{/if}
		</Cluster>

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
			<Button onclick={submit} disabled={!(chargeable > 0) || selectedCatalogId == null || saving}
				>{t('leave.submit')}</Button
			>
			<Button variant="ghost" onclick={onclose}>{t('component.cancel')}</Button>
		</Cluster>
	</Stack>
</Sheet>
