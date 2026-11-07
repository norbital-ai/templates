<!--
@component
What a reversal undoes: a pick of the person's entries of the same catalog item that a run has sealed and nothing has
reversed yet. An entry no run has sealed is deleted, not reversed.
-->
<script lang="ts">
	import { bolt } from '$bolt';
	import { Combobox } from '@norbital-ai/ui';
	import { idOf } from '../../payroll_engine/reads.js';
	let {
		family,
		employment,
		catalog,
		value,
		onChange,
		id,
		disabled = false
	}: {
		family: 'leave' | 'claim' | 'adhoc';
		employment: unknown;
		catalog: unknown;
		value: unknown;
		onChange: (next: string | null) => void;
		id?: string;
		disabled?: boolean;
	} = $props();
	const owner = $derived(
		typeof employment === 'string'
			? bolt.query({
					employee_contract: {
						where: { id: { eq: idOf('employee_contract', employment) } },
						fields: ['employee_id'],
						limit: 1
					}
				})
			: null
	);
	const person = $derived(owner?.current?.employee_contract.rows[0]?.employee_id);
	const held = $derived(
		person == null || typeof catalog !== 'string'
			? null
			: bolt.query({
					leave_catalog_entry: {
						where: { employment_id: { is: { employee_id: { eq: person } } } },
						fields: ['days', 'payroll_run_id', 'is_reversal', 'reverses', 'catalog_id'],
						limit: 10000
					},
					'leave_catalog_entry.catalog_id': { fields: ['code'] },
					claim_catalog_entry: {
						where: { employment_id: { is: { employee_id: { eq: person } } } },
						fields: [
							'quantity',
							'incurred_on',
							'payroll_run_id',
							'is_reversal',
							'reverses',
							'catalog_id'
						],
						limit: 10000
					},
					'claim_catalog_entry.catalog_id': { fields: ['code'] },
					adhoc_catalog_entry: {
						where: { employment_id: { is: { employee_id: { eq: person } } } },
						fields: [
							'quantity',
							'incurred_on',
							'payroll_run_id',
							'is_reversal',
							'reverses',
							'catalog_id'
						],
						limit: 10000
					},
					'adhoc_catalog_entry.catalog_id': { fields: ['code'] },
					leave_catalog: {
						where: { id: { eq: idOf('leave_catalog', catalog) } },
						fields: ['code'],
						limit: 1
					},
					claim_catalog: {
						where: { id: { eq: idOf('claim_catalog', catalog) } },
						fields: ['code'],
						limit: 1
					},
					adhoc_catalog: {
						where: { id: { eq: idOf('adhoc_catalog', catalog) } },
						fields: ['code'],
						limit: 1
					}
				})
	);
	const code = $derived(held?.current?.[`${family}_catalog`].rows[0]?.code);
	const rows = $derived(
		family === 'leave'
			? (held?.current?.leave_catalog_entry.rows ?? []).map((row) => {
					const days = row.days.map((day) => String(day.date)).toSorted();
					return {
						...row,
						label: `${days[0]} – ${days.at(-1)} · ${days.length / 2} d`
					};
				})
			: (held?.current?.[`${family}_catalog_entry`].rows ?? []).map((row) => ({
					...row,
					label: `${String(row.incurred_on)} · ${String(row.quantity)}`
				}))
	);
	const reversed = $derived(new Set(rows.map((row) => row.reverses)));
	const options = $derived(
		rows
			.filter(
				(row) =>
					row.catalog_id?.code === code &&
					row.payroll_run_id != null &&
					row.is_reversal !== true &&
					!reversed.has(row.id)
			)
			.map((row) => ({ value: row.id, label: row.label }))
	);
</script>

<Combobox
	{...id === undefined ? {} : { id }}
	{disabled}
	value={typeof value === 'string' ? value : null}
	{options}
	aria-label="Entry reversed"
	{onChange}
/>
