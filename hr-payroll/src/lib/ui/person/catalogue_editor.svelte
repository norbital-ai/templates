<script lang="ts">
	import { bolt } from '$bolt';
	import { Combobox, useForm, type FieldEditor } from '@norbital-ai/ui';
	import { idOf } from '../../payroll_engine/reads.js';
	let {
		family,
		field
	}: {
		family: 'leave_catalog' | 'claim_catalog' | 'adhoc_catalog' | 'loan_catalog';
		field: FieldEditor;
	} = $props();
	const form = useForm();
	const selected = $derived(form?.get('catalog_id'));
	const catalogId = $derived(typeof selected === 'string' ? selected : null);
	const companyId = $derived(form?.get('entity_id'));
	const employmentId = $derived(form?.get('employment_id'));
	const incurredOn = $derived(form?.get('incurred_on'));
	const claims = $derived(
		family !== 'claim_catalog' || typeof employmentId !== 'string'
			? null
			: bolt.query({
					claim_catalog_entry: {
						where: { employment_id: { eq: idOf('employee_contract', employmentId) } },
						fields: ['catalog_id', 'quantity', 'incurred_on', 'reverses'],
						limit: 10000
					}
				})
	);
	const company = $derived(
		typeof companyId === 'string'
			? bolt.query({
					entity: {
						output: 'self_service',
						where: { id: { eq: idOf('entity', companyId) } },
						fields: ['settings_code'],
						limit: 1
					}
				})
			: null
	);
	const catalogs = bolt.query({
		leave_catalog: { limit: 10000 },
		'leave_catalog.settings_id': { fields: ['code', 'status', 'effective_range'] },
		claim_catalog: { limit: 10000 },
		'claim_catalog.settings_id': { fields: ['code', 'status', 'effective_range'] },
		adhoc_catalog: { limit: 10000 },
		'adhoc_catalog.settings_id': { fields: ['code', 'status', 'effective_range'] },
		loan_catalog: { limit: 10000 },
		'loan_catalog.settings_id': { fields: ['code', 'status', 'effective_range'] }
	});
	const year = $derived(
		typeof incurredOn === 'string'
			? incurredOn.slice(0, 4)
			: String(bolt.clock('day').today).slice(0, 4)
	);
	const usedFor = (catalogId: string) =>
		(claims?.current?.claim_catalog_entry.rows ?? []).reduce(
			(total, row) =>
				row.catalog_id === catalogId &&
				row.reverses == null &&
				String(row.incurred_on).startsWith(year)
					? total + Number(row.quantity ?? 0)
					: total,
			0
		);
	const remainingFor = (row: { readonly id: string; readonly lookup?: unknown }) => {
		const limit = Number(
			(row.lookup as { readonly annual_limit?: number } | undefined)?.annual_limit
		);
		return Number.isFinite(limit) && limit > 0 ? limit - usedFor(row.id) : null;
	};
	const choices = $derived(
		(catalogs.current?.[family].rows ?? [])
			.filter(
				(c) =>
					c.settings_id?.status === 'SEALED' &&
					(company?.current?.entity.rows[0]?.settings_code === undefined ||
						c.settings_id.code === company?.current?.entity.rows[0]?.settings_code)
			)
			.filter((c) => family !== 'claim_catalog' || remainingFor(c) !== 0)
	);
</script>

<Combobox
	id={field.id}
	disabled={field.disabled}
	value={catalogId}
	options={choices.map((c) => ({
		value: c.id,
		label: `${c.code} · ${c.name}`,
		description:
			c.settings_id === null
				? ''
				: `${c.settings_id.effective_range.from} – ${c.settings_id.effective_range.to ?? '…'}`,
		...(family === 'claim_catalog' && remainingFor(c) != null
			? { suffix: `${remainingFor(c)} left` }
			: {})
	}))}
	onChange={(value) => field.onChange(value)}
/>
