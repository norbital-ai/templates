<script lang="ts">
	/**
	 * A new payroll run for one legal entity: the period and the kind, `REGULAR` or `OFF_CYCLE`. An `OFF_CYCLE` run pays
	 * only the approved, unpaid ad hoc and claim entries its people and components narrow to, and no salary; the run's
	 * own admission refuses anything else.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Combobox, Field, Form, Sheet } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { todayKey } from '../format/calendar.js';
	import { versionCalendar } from '../format/version_money.svelte.js';
	import { periodOptions } from './pay_periods.js';

	let { companyId, open = $bindable(false) }: { companyId: Id<'entity'>; open?: boolean } =
		$props();

	const entity = $derived.by(() =>
		bolt.query({
			entity: {
				where: { id: { eq: companyId } },
				fields: ['pay_frequency', 'pay_frequency_changes', 'settings_code'],
				limit: 1
			}
		})
	);
	const company = $derived(entity?.current?.entity.rows[0]);
	const calendar = versionCalendar(() => {
		const lineage = company?.settings_code;
		return lineage == null || lineage === '' ? null : { lineage };
	});
	const latest = $derived.by(() =>
		bolt.query({
			payroll_run: {
				where: { company_id: { eq: companyId } },
				fields: ['salary_from'],
				orderBy: { salary_from: 'desc' },
				limit: 1
			}
		})
	);
	/** The latest run's first day: an earlier period would rewrite the year to date of runs already made. */
	const since = $derived(
		String(latest?.current?.payroll_run.rows[0]?.salary_from ?? '').slice(0, 10)
	);
	/** The periods the entity's schedule offers, twelve months back from now (a daily entity: its days), each paid at
	 * the frequency in force on its days (`periodsIn`): a month that switches offers both frequencies' own. Periods
	 * ending before the latest run's start are left out; the run's admission refuses them. */
	const periods = $derived.by(() =>
		periodOptions(company ?? {}, calendar() ?? {}, todayKey())
			.filter((period) => period.to >= since)
			.map((period) => {
				const label = new Date(`${period.from}T00:00:00Z`).toLocaleDateString(undefined, {
					month: 'long',
					year: 'numeric',
					timeZone: 'UTC'
				});
				return {
					value: period.key,
					label: period.key.length === 7 ? label : `${label} · ${period.key.slice(8)}`,
					description: `${period.frequency} · ${period.from} – ${period.to}`
				};
			})
	);

	const open_entry = {
		where: { company_id: { eq: companyId }, payslip_id: { isNull: true } },
		fields: ['catalog_id', 'employment_id'],
		orderBy: { occurred_on: 'desc' }
	} as const;
	const open_entries = $derived.by(() =>
		open
			? bolt.query({
					adhoc_catalog_entry: open_entry,
					'adhoc_catalog_entry.catalog_id': { fields: ['name', 'code'] },
					'adhoc_catalog_entry.employment_id': { fields: ['employee_number'] },
					claim_catalog_entry: open_entry,
					'claim_catalog_entry.catalog_id': { fields: ['name', 'code'] },
					'claim_catalog_entry.employment_id': { fields: ['employee_number'] }
				})
			: null
	);
	const entries = $derived([
		...(open_entries?.current?.adhoc_catalog_entry.rows ?? []),
		...(open_entries?.current?.claim_catalog_entry.rows ?? [])
	]);

	const picked = (row: (typeof entries)[number]) => ({
		id: row.id,
		person: row.employment_id?.employee_number || '—',
		item: row.catalog_id?.name || row.catalog_id?.code || '—'
	});
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
	/** Keeps the run's `sources` on exactly the entries shown, as the filters and the open entries change. */
	function paySources(field: { value: unknown; onChange(next: string[]): void }) {
		const ids = shown.map((entry) => entry.id);
		const now = Array.isArray(field.value) ? field.value : [];
		if (now.length !== ids.length || ids.some((id, i) => now[i] !== id)) field.onChange(ids);
	}
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
							{#if entries.length === 0}
								<p class="text-meta">{bolt.t('app.payroll.no_adhoc_items')}</p>
							{:else}
								<!-- the run pays every open entry the people and components narrow to -->
								<div {@attach () => paySources(field)}>
									<Stack gap="sm">
										<Stack gap="xs">
											<span class="text-meta">{bolt.t('app.payroll.adhoc_people')}</span>
											<Combobox
												multiple
												class="w-full"
												options={people.map((person) => ({ value: person, label: person }))}
												value={onlyPeople}
												placeholder={bolt.t('app.payroll.adhoc_everyone')}
												disabled={field.disabled}
												onChange={(next) => (onlyPeople = [...next])}
											/>
										</Stack>
										<Stack gap="xs">
											<span class="text-meta">{bolt.t('component.component')}</span>
											<Combobox
												multiple
												class="w-full"
												options={items.map((item) => ({ value: item, label: item }))}
												value={onlyItems}
												placeholder={bolt.t('app.payroll.adhoc_every_component')}
												disabled={field.disabled}
												onChange={(next) => (onlyItems = [...next])}
											/>
										</Stack>
									</Stack>
								</div>
							{/if}
						{/snippet}
					</Field>
				{/if}
			</Stack>
		{/snippet}
	</Form>
</Sheet>
