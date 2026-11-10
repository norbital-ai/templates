<script lang="ts">
	/**
	 * A new payroll run for one pay group of the entity in scope. An on-cycle run names its group and cycle. An
	 * off-cycle run names who and what for: it pays the open ad hoc and claim entries those pick out, and no salary.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Button, Combobox, notifyOutcome, Sheet, Tabs, toast } from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Stack } from '@norbital-ai/ui/layout';
	import { addMonths } from '@norbital-ai/std/date';
	import { Effect } from 'effect';
	import { jsonObject } from '../../payroll_engine/foundation.js';
	import { cycleOn, cyclesIn } from '../../payroll_engine/pay_cycle.js';
	import { todayKey } from '../format/calendar.js';
	import { periodLabel } from './pay_periods.js';

	let { companyId, open = $bindable(false) }: { companyId: Id<'entity'>; open?: boolean } =
		$props();

	const today = String(todayKey());
	const known = $derived(
		bolt.query({
			pay_group: {
				where: { entity_id: { eq: companyId } },
				fields: ['name', 'payment_schedule'],
				orderBy: { name: 'asc' },
				limit: 100
			},
			entity_profile_version: {
				where: { entity_id: { eq: companyId }, status: { eq: 'SEALED' } },
				fields: ['effective_range'],
				orderBy: { created_at: 'desc' },
				limit: 100
			},
			payroll_run: {
				where: { entity_id: { eq: companyId }, kind: { eq: 'ON_CYCLE' } },
				fields: ['period', 'pay_group_id'],
				limit: 10000
			}
		})
	);
	const version = $derived(
		known?.current?.entity_profile_version.rows.find(
			({ effective_range: { from, to } }) => from <= today && (to === null || today <= to)
		)
	);
	// the run is for one pay group: the company's only one is chosen for HR, several are a choice
	const groups = $derived(known?.current?.pay_group.rows ?? []);
	let chosen = $state<Id<'pay_group'> | null>(null);
	const group = $derived(
		groups.find((row) => row.id === chosen) ?? (groups.length === 1 ? groups[0] : undefined)
	);
	const groupOptions = $derived(groups.map((row) => ({ value: row.id, label: row.name })));
	const schedule = $derived(jsonObject(group?.payment_schedule ?? {}));
	const runs = $derived(
		(known?.current?.payroll_run.rows ?? []).filter((run) => run.pay_group_id === group?.id)
	);
	/** An earlier cycle would rewrite the year to date of runs already made. */
	const latest = $derived(runs.map((run) => run.period).reduce((a, b) => (a > b ? a : b), ''));
	const cycles = $derived(
		Array.from({ length: 13 }, (_, back) =>
			String(addMonths(`${today.slice(0, 7)}-01`, -back)).slice(0, 7)
		)
			.flatMap((month) => cyclesIn(schedule, month).toReversed())
			.filter((cycle) => cycle.from <= today && cycle.key > latest)
			.map((cycle) => ({
				value: cycle.key,
				label: periodLabel(cycle.key, {
					first: bolt.t('app.payroll.first_half'),
					second: bolt.t('app.payroll.second_half')
				}),
				description: `${cycle.from} – ${cycle.to}`
			}))
	);
	let cycle = $state<string | null>(null);

	const openEntry = {
		where: { entity_id: { eq: companyId }, payroll_run_id: { isNull: true } },
		fields: ['catalog_id', 'employment_id', 'quantity'],
		limit: 10000
	} as const;
	const listed = $derived(
		open
			? bolt.query({
					adhoc_catalog_entry: openEntry,
					'adhoc_catalog_entry.catalog_id': { fields: ['code', 'off_cycle_eligible'] },
					'adhoc_catalog_entry.employment_id': {
						fields: ['employee_number', 'employee_id', 'effective_range']
					},
					'adhoc_catalog_entry.employment_id.employee_id': { fields: ['name'] }
				})
			: null
	);
	const entries = $derived(
		[
			...(listed?.current?.adhoc_catalog_entry.rows ?? []).map((row) => ({
				row,
				adhoc: [row.id],
				claim: []
			}))
		].flatMap(({ row, adhoc, claim }) => {
			const offCycle =
				row.catalog_id !== null &&
				'off_cycle_eligible' in row.catalog_id &&
				row.catalog_id.off_cycle_eligible === true;
			return row.employment_id != null && row.catalog_id !== null && offCycle
				? [
						{
							adhoc,
							claim,
							who: String(row.employment_id.id),
							employed: row.employment_id.effective_range,
							person: `${row.employment_id.employee_id?.name ?? ''} (${row.employment_id.employee_number})`,
							what: row.catalog_id.code
						}
					]
				: [];
		})
	);
	const unique = (values: readonly string[]) =>
		[...new Set(values)].toSorted().map((value) => ({ value, label: value }));
	let who = $state<string[]>([]);
	let what = $state<string[]>([]);
	const people = $derived(
		[...new Map(entries.map((entry) => [entry.who, entry.person]))].map(([value, label]) => ({
			value,
			label
		}))
	);
	const items = $derived(
		unique(entries.filter((row) => who.includes(row.who)).map((row) => row.what))
	);
	const paying = $derived(
		entries.filter((row) => who.includes(row.who) && what.includes(row.what))
	);

	let saving = $state(false);
	const create = (row: Parameters<typeof bolt.act<'payroll_run.create'>>[1][number]) => {
		saving = true;
		fork(
			bolt.act('payroll_run.create', [row]).pipe(
				Effect.tap((outcome) => Effect.sync(() => notifyOutcome(bolt, outcome))),
				Effect.tap((outcome) =>
					Effect.sync(() => {
						if (outcome.kind === 'committed') open = false;
					})
				),
				Effect.catch((error) =>
					Effect.sync(() =>
						toast.error(error instanceof Error ? error.message : bolt.t('component.error'))
					)
				),
				Effect.ensuring(Effect.sync(() => (saving = false)))
			)
		);
	};
	const runOnCycle = () => {
		if (cycle !== null && group !== undefined)
			create({ entity_id: companyId, pay_group_id: group.id, period: cycle, kind: 'ON_CYCLE' });
	};
	const runOffCycle = () => {
		// a run pays the contracts in its period: a leaver is paid on the period of their last day
		const day = [today, ...paying.flatMap((row) => row.employed.to ?? [])]
			.map(String)
			.toSorted()[0];
		if (day === undefined || paying.length === 0) return;
		if (paying.some((row) => String(row.employed.from) > day)) {
			toast.error(bolt.t('app.payroll.separate_runs'));
			return;
		}
		const period = cycleOn(schedule, day)?.key;
		if (period === undefined || group === undefined) return;
		create({
			entity_id: companyId,
			pay_group_id: group.id,
			period,
			kind: 'OFF_CYCLE',
			attaches: {
				adhoc: paying.flatMap((row) => row.adhoc),
				claim: paying.flatMap((row) => row.claim)
			}
		});
	};
</script>

{#snippet groupPicker()}
	{#if groups.length !== 1}
		<Combobox
			class="w-full"
			options={groupOptions}
			value={group?.id ?? null}
			placeholder={bolt.t('app.payroll.pay_group')}
			onChange={(next) => {
				chosen = next;
				cycle = null;
			}}
		/>
	{/if}
{/snippet}
{#snippet onCycle()}
	<Stack gap="sm">
		{@render groupPicker()}
		<Combobox
			class="w-full"
			options={cycles}
			value={cycle}
			placeholder={bolt.t('app.payroll.period')}
			onChange={(next) => (cycle = next)}
		/>
		<Button disabled={saving || cycle === null || group === undefined} onclick={runOnCycle}>
			{bolt.t('app.payroll.create_run')}
		</Button>
	</Stack>
{/snippet}
{#snippet offCycleForm()}
	<Stack gap="sm">
		{@render groupPicker()}
		{#if entries.length === 0}
			<p class="text-meta">{bolt.t('app.payroll.no_adhoc_items')}</p>
		{:else}
			<Combobox
				multiple
				class="w-full"
				options={people}
				value={who}
				placeholder={bolt.t('app.payroll.adhoc_people')}
				onChange={(next) => (who = [...next])}
			/>
			<Combobox
				multiple
				class="w-full"
				options={items}
				value={what}
				placeholder={bolt.t('app.payroll.adhoc_items')}
				onChange={(next) => (what = [...next])}
			/>
			<Button disabled={saving || paying.length === 0 || group === undefined} onclick={runOffCycle}>
				{bolt.t('app.payroll.create_run')}
			</Button>
		{/if}
	</Stack>
{/snippet}
<Sheet bind:open title={bolt.t('v2.create_run')}>
	<Tabs
		tabs={[
			{ name: 'on_cycle', title: bolt.t('v2.on_cycle'), body: onCycle },
			{ name: 'off_cycle', title: bolt.t('v2.off_cycle'), body: offCycleForm }
		]}
	/>
</Sheet>
