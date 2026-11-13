<script lang="ts">
	/**
	 * A new payroll run for one pay group of the entity in scope. An on-cycle run names its group and cycle. An
	 * off-cycle run names who and what for: it pays the open ad hoc and claim entries those pick out, and no salary. It
	 * may also carry earlier periods that wait: the way someone no on-cycle run pays any more is paid what they are owed.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { Button, Combobox, format, notify_outcome, Sheet, Tabs, toast } from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Stack } from '@norbital-ai/ui/layout';
	import { DateTime, Effect } from 'effect';
	import { jsonObject } from '../../payroll_engine/foundation.js';
	import { cycleOn, cyclesIn } from '../../payroll_engine/pay_cycle.js';
	import { pageLaws } from '../law.svelte.js';

	let {
		ctx,
		companyId,
		open = $bindable(false)
	}: { ctx: PageContext; companyId: Id<'entity'>; open?: boolean } = $props();

	const today = ctx.clock().today;
	const known = $derived(
		ctx.query({
			pay_group: {
				where: { entity_id: { eq: companyId } },
				fields: ['name', 'payment_schedule'],
				order_by: { name: 'asc' },
				limit: 100
			},
			payroll_run: {
				where: { entity_id: { eq: companyId }, kind: { eq: 'ON_CYCLE' } },
				fields: ['period', 'pay_group_id'],
				limit: 10000
			},
			entity: { where: { id: { eq: companyId } }, fields: ['settings_code'], limit: 1 }
		})
	);
	const code = $derived(known?.current?.entity.rows[0]?.settings_code);
	const laws = pageLaws(ctx, () => (code === undefined ? [] : [code]));
	// the ad hoc rows of the company's law today that an off-cycle run may pay
	const offCycleCodes = $derived(
		new Set(
			(laws.on(code, String(today))?.rows.adhoc_catalog ?? []).flatMap((row) =>
				row.off_cycle_eligible === true ? [String(row.code)] : []
			)
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
			DateTime.formatIsoDateUtc(
				DateTime.subtract(DateTime.startOf(DateTime.makeUnsafe(today), 'month'), { months: back })
			).slice(0, 7)
		)
			.flatMap((month) => cyclesIn(schedule, month).toReversed())
			.filter((cycle) => cycle.from <= today && cycle.key > latest)
			.map((cycle) => ({
				value: cycle.key,
				label:
					cycle.key.length === 10
						? format({ kind: 'date' }, cycle.key, { locale: ctx.locale })
						: `${format({ kind: 'date', precision: 'month' }, `${cycle.key.slice(0, 7)}-01`, { locale: ctx.locale })}${
								cycle.key.length === 9
									? ` · ${ctx.t(cycle.key.endsWith('1') ? 'app.payroll.first_half' : 'app.payroll.second_half')}`
									: ''
							}`,
				description: format(
					{ kind: 'period', of: 'date' },
					{ from: cycle.from, to: cycle.to },
					{
						locale: ctx.locale
					}
				)
			}))
	);
	let cycle = $state<string | null>(null);

	const openEntry = {
		where: { entity_id: { eq: companyId }, payroll_run_id: { is_null: true } },
		fields: ['catalog_code', 'employment_id', 'quantity', 'revision'],
		limit: 10000
	} as const;
	const listed = $derived(
		open
			? ctx.query({
					adhoc_catalog_entry: {
						...openEntry,
						employment_id: {
							fields: ['employee_number', 'employee_id', 'effective_range'],
							employee_id: { fields: ['name'] }
						}
					}
				})
			: null
	);
	const entries = $derived(
		[
			...(listed?.current?.adhoc_catalog_entry.rows ?? []).map((row) => ({
				row,
				adhoc: [{ id: row.id, revision: row.revision }]
			}))
		].flatMap(({ row, adhoc }) => {
			return row.employment_id != null && offCycleCodes.has(row.catalog_code)
				? [
						{
							adhoc,
							who: String(row.employment_id.id),
							employed: row.employment_id.effective_range,
							person: `${row.employment_id.employee_id?.name ?? ''} (${row.employment_id.employee_number})`,
							what: row.catalog_code
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

	// paid periods corrected since and still waiting for a run: an off-cycle run carries the ones HR names
	const waitingRows = $derived(
		open && group !== undefined
			? ctx.query({
					pay_amendment: {
						where: { pay_group_id: { eq: group.id }, payroll_run_id: { is_null: true } },
						fields: ['period', 'revision'],
						order_by: { period: 'asc' },
						limit: 10000
					}
				})
			: null
	);
	const waiting = $derived(
		(waitingRows?.current?.pay_amendment.rows ?? []).map((row) => ({
			value: String(row.id),
			link: { id: row.id, revision: row.revision },
			label: row.$label ?? row.period
		}))
	);
	let carried = $state<string[]>([]);

	let saving = $state(false);
	const create = (row: ActInput<'payroll_run.create'>[number]) => {
		saving = true;
		fork(
			ctx.act({ 'payroll_run.create': [row] }).pipe(
				Effect.tap((outcome) => Effect.sync(() => notify_outcome(ctx, outcome))),
				Effect.tap((outcome) =>
					Effect.sync(() => {
						if (outcome.kind === 'committed') open = false;
					})
				),
				Effect.catch((error) =>
					Effect.sync(() =>
						toast.error(error instanceof Error ? error.message : ctx.t('component.error'))
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
		// a run pays the stints in its period: a leaver is paid on the period of their last day
		const day = [today, ...paying.flatMap((row) => row.employed.to ?? [])]
			.map(String)
			.toSorted()[0];
		if (day === undefined || (paying.length === 0 && carried.length === 0)) return;
		if (paying.some((row) => String(row.employed.from) > day)) {
			toast.error(ctx.t('app.payroll.separate_runs'));
			return;
		}
		const period = cycleOn(schedule, day)?.key;
		if (period === undefined || group === undefined) return;
		create({
			entity_id: companyId,
			pay_group_id: group.id,
			period,
			kind: 'OFF_CYCLE',
			// the run links what it pays and the amendment rows it carries, each at the revision read
			adhoc: paying.flatMap((row) => row.adhoc),
			amendments: waiting.flatMap((row) => (carried.includes(row.value) ? [row.link] : []))
		});
	};
</script>

{#snippet groupPicker()}
	{#if groups.length !== 1}
		<Combobox
			class="w-full"
			options={groupOptions}
			value={group?.id ?? null}
			placeholder={ctx.t('app.payroll.pay_group')}
			on_change={(next) => {
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
			placeholder={ctx.t('app.payroll.period')}
			on_change={(next) => (cycle = next)}
		/>
		<Button disabled={saving || cycle === null || group === undefined} onclick={runOnCycle}>
			{ctx.t('app.payroll.create_run')}
		</Button>
	</Stack>
{/snippet}
{#snippet offCycleForm()}
	<Stack gap="sm">
		{@render groupPicker()}
		{#if entries.length === 0 && waiting.length === 0}
			<p class="text-meta">{ctx.t('app.payroll.no_adhoc_items')}</p>
		{:else}
			{#if waiting.length > 0}
				<Combobox
					multiple
					class="w-full"
					options={waiting}
					value={carried}
					placeholder={ctx.t('app.payroll.amended_carry')}
					on_change={(next) => (carried = [...next])}
				/>
			{/if}
			<Combobox
				multiple
				class="w-full"
				options={people}
				value={who}
				placeholder={ctx.t('app.payroll.adhoc_people')}
				on_change={(next) => (who = [...next])}
			/>
			<Combobox
				multiple
				class="w-full"
				options={items}
				value={what}
				placeholder={ctx.t('app.payroll.adhoc_items')}
				on_change={(next) => (what = [...next])}
			/>
			<Button
				disabled={saving || (paying.length === 0 && carried.length === 0) || group === undefined}
				onclick={runOffCycle}
			>
				{ctx.t('app.payroll.create_run')}
			</Button>
		{/if}
	</Stack>
{/snippet}
<Sheet bind:open title={ctx.t('v2.create_run')}>
	<Tabs
		tabs={[
			{ name: 'on_cycle', title: ctx.t('v2.on_cycle'), body: onCycle },
			{ name: 'off_cycle', title: ctx.t('v2.off_cycle'), body: offCycleForm }
		]}
	/>
</Sheet>
