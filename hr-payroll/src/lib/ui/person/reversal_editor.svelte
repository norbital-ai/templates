<!--
@component
What an ad hoc reversal undoes: a pick of the person's entries of the same catalog item that a run has sealed and nothing
has reversed yet. An entry no run has sealed is deleted, not reversed.
-->
<script lang="ts">
	import { bolt } from '$bolt';
	import { Combobox } from '@norbital-ai/ui';
	import { idOf } from '../../payroll_engine/reads.js';
	let {
		employment,
		catalog,
		value,
		onChange,
		id,
		disabled = false
	}: {
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
					adhoc_catalog_entry: {
						where: { employment_id: { is: { employee_id: { eq: person } } } },
						fields: ['quantity', 'incurred_on', 'payroll_run_id', 'reverses', 'catalog_id'],
						limit: 10000
					},
					'adhoc_catalog_entry.catalog_id': { fields: ['code'] },
					adhoc_catalog: {
						where: { id: { eq: idOf('adhoc_catalog', catalog) } },
						fields: ['code'],
						limit: 1
					}
				})
	);
	const code = $derived(held?.current?.adhoc_catalog.rows[0]?.code);
	const rows = $derived(held?.current?.adhoc_catalog_entry.rows ?? []);
	const reversed = $derived(new Set(rows.map((row) => row.reverses)));
	const options = $derived(
		rows
			.filter(
				(row) =>
					row.catalog_id?.code === code &&
					row.payroll_run_id != null &&
					row.reverses == null &&
					!reversed.has(row.id)
			)
			.map((row) => ({
				value: row.id,
				label: `${String(row.incurred_on)} · ${String(row.quantity)}`
			}))
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
