<script lang="ts">
	/**
	 * A new payroll run for one legal entity: the period and the kind, `REGULAR` or `OFF_CYCLE`. An `OFF_CYCLE` run pays
	 * only the approved, unpaid ad hoc and claim entries ticked here, and no salary; the run's own admission refuses
	 * anything else.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Button, Checkbox, Combobox, Field, Form, Sheet } from '@norbital-ai/ui';
	import { Cluster, Inline, Stack } from '@norbital-ai/ui/layout';
	import { live, liveRows } from '../state/live.svelte.js';
	import { todayKey } from '../format/calendar.js';
	import { formatNumeric } from '../format/display_formatters.js';
	import { moneyNumber } from '../../payroll_engine/foundation.js';
	import * as Predicate from 'effect/Predicate';

	let { companyId, open = $bindable(false) }: { companyId: Id<'entity'>; open?: boolean } =
		$props();

	const entity = live(() => bolt.get('entity', companyId, { pay_frequency: true }));
	/** The periods the entity's own projection offers, twelve back from now: its pay frequency decides the shape. */
	const periods = $derived.by(() => {
		const [year, month] = todayKey().split('-').map(Number);
		const frequency = entity.current?.pay_frequency ?? 'MONTHLY';
		const out: { value: string; label: string }[] = [];
		for (let back = 0; back < 12; back++) {
			const stamp = new Date(Date.UTC(year!, month! - 1 - back, 1));
			const key = `${stamp.getUTCFullYear()}-${String(stamp.getUTCMonth() + 1).padStart(2, '0')}`;
			const label = stamp.toLocaleDateString(undefined, {
				month: 'long',
				year: 'numeric',
				timeZone: 'UTC'
			});
			if (frequency === 'SEMI_MONTHLY')
				out.push(
					{ value: `${key}-1`, label: `${label} · 1` },
					{ value: `${key}-2`, label: `${label} · 2` }
				);
			else if (frequency === 'TEN_DAY')
				out.push(
					{ value: `${key}-1`, label: `${label} · 1` },
					{ value: `${key}-2`, label: `${label} · 2` },
					{ value: `${key}-3`, label: `${label} · 3` }
				);
			else out.push({ value: key, label });
		}
		return out;
	});

	const openEntryRead = () =>
		({
			where: {
				company_id: { eq: companyId },
				payslip_id: { isNull: true },
				approval_id: { isNull: true }
			},
			select: {
				id: true,
				occurred_on: true,
				amount: true,
				catalog_id: { select: { name: true, code: true } },
				employment_id: { select: { employee_number: true } }
			},
			orderBy: { occurred_on: 'desc' },
			all: true
		}) as const;
	const adhoc = liveRows(() => (open ? bolt.read('adhoc_catalog_entry', openEntryRead()) : null));
	const claims = liveRows(() => (open ? bolt.read('claim_catalog_entry', openEntryRead()) : null));
	const entries = $derived([...(adhoc.current ?? []), ...(claims.current ?? [])]);

	type Picked = {
		readonly id: string;
		readonly label: string;
		readonly person: string;
		readonly item: string;
	};
	type EntryRow =
		NonNullable<typeof adhoc.current>[number] | NonNullable<typeof claims.current>[number];
	const nestedString = (value: unknown, key: string): string | null => {
		if (!Predicate.isObjectOrArray(value) || Array.isArray(value)) return null;
		const raw = value[key];
		return Predicate.isString(raw) && raw !== '' ? raw : null;
	};
	const picked = (row: EntryRow): Picked => {
		const amount = moneyNumber(row.amount);
		const person = nestedString(row.employment_id, 'employee_number') ?? '—';
		const itemName =
			nestedString(row.catalog_id, 'name') ?? nestedString(row.catalog_id, 'code') ?? '—';
		return {
			id: row.id,
			person,
			item: itemName,
			label: [
				person,
				itemName,
				String(row.occurred_on),
				amount == null ? null : formatNumeric(amount)
			]
				.filter((part) => part != null && part !== '')
				.join(' · ')
		};
	};
	const all = $derived(entries.map(picked));
	const people = $derived([...new Set(all.map((entry) => entry.person))].toSorted());
	const items = $derived([...new Set(all.map((entry) => entry.item))].toSorted());
	/** The people and classes the list is narrowed to; empty means every one. */
	let onlyPeople = $state<string[]>([]);
	let onlyItems = $state<string[]>([]);
	const shown = $derived(
		all.filter(
			(entry) =>
				(onlyPeople.length === 0 || onlyPeople.includes(entry.person)) &&
				(onlyItems.length === 0 || onlyItems.includes(entry.item))
		)
	);
	const toggle = (list: string[], value: string, on: boolean) =>
		on ? [...list, value] : list.filter((v) => v !== value);
</script>

<Sheet bind:open title={bolt.t('app.payroll.create_run')}>
	<Form
		of="payroll_run"
		mode="create"
		values={{ company_id: companyId, kind: 'REGULAR' }}
		submit={bolt.t('app.payroll.create_run')}
		onOutcome={(outcome) => {
			if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') open = false;
		}}
	>
		{#snippet children(form)}
			<Stack gap="sm">
				<Field name="period" label={bolt.t('app.payroll.period')}>
					{#snippet editor(field)}
						<Combobox
							class="w-full"
							options={periods}
							value={typeof field.value === 'string' && field.value !== '' ? field.value : null}
							placeholder="YYYY-MM"
							onChange={(next) => next != null && field.onChange(next)}
						/>
					{/snippet}
				</Field>
				<Field name="kind" label={bolt.t('app.payroll.kind')} />
				{#if form.values.kind === 'OFF_CYCLE'}
					<Field name="sources" label={bolt.t('app.payroll.adhoc_items')}>
						{#snippet editor(field)}
							{@const chosen = new Set(
								Array.isArray(field.value)
									? field.value.filter((v): v is string => typeof v === 'string')
									: []
							)}
							{#if entries.length === 0}
								<p class="text-meta">{bolt.t('app.payroll.no_adhoc_items')}</p>
							{:else}
								<Stack gap="sm">
									<Stack gap="xs">
										<span class="text-meta">{bolt.t('app.payroll.adhoc_people')}</span>
										<Cluster gap="sm">
											{#each people as person (person)}
												<Inline as="label" gap="xs" align="center">
													<Checkbox
														checked={onlyPeople.includes(person)}
														onCheckedChange={(on) =>
															(onlyPeople = toggle(onlyPeople, person, on === true))}
													/>
													<span>{person}</span>
												</Inline>
											{/each}
										</Cluster>
									</Stack>
									<Stack gap="xs">
										<span class="text-meta">{bolt.t('component.component')}</span>
										<Cluster gap="sm">
											{#each items as item (item)}
												<Inline as="label" gap="xs" align="center">
													<Checkbox
														checked={onlyItems.includes(item)}
														onCheckedChange={(on) =>
															(onlyItems = toggle(onlyItems, item, on === true))}
													/>
													<span>{item}</span>
												</Inline>
											{/each}
										</Cluster>
									</Stack>
									<Button
										variant="outline"
										size="sm"
										class="w-fit"
										disabled={field.disabled || shown.length === 0}
										onclick={() =>
											field.onChange([...new Set([...chosen, ...shown.map((entry) => entry.id)])])}
									>
										{bolt.t('app.payroll.select_all_shown', { count: shown.length })}
									</Button>
									{#each shown as entry (entry.id)}
										<Inline as="label" gap="sm" align="center">
											<Checkbox
												checked={chosen.has(entry.id)}
												disabled={field.disabled}
												onCheckedChange={(on) =>
													field.onChange(
														on ? [...chosen, entry.id] : [...chosen].filter((id) => id !== entry.id)
													)}
											/>
											<span>{entry.label}</span>
										</Inline>
									{/each}
								</Stack>
							{/if}
						{/snippet}
					</Field>
				{/if}
			</Stack>
		{/snippet}
	</Form>
</Sheet>
