<script lang="ts">
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { PlainDate } from '@norbital-ai/std/date';
	import {
		Combobox,
		Field,
		Form,
		Sheet,
		notifyOutcome,
		toast,
		type FieldEditor
	} from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import CatalogueEditor from './catalogue_editor.svelte';
	let {
		employmentId: fixedEmployment = null,
		companyId,
		onsaved,
		onclose
	}: {
		employmentId?: Id<'employee_contract'> | null;
		companyId: Id<'entity'>;
		onsaved: () => void;
		onclose: () => void;
	} = $props();
	const clock = bolt.clock('day');
	let chosen = $state<Id<'employee_contract'> | null>(fixedEmployment);
	const contracts = $derived(
		fixedEmployment !== null
			? null
			: bolt.query({
					employee_contract: {
						where: { entity_id: { eq: companyId }, status: { eq: 'SEALED' } },
						fields: ['employee_number', 'employee_name'],
						orderBy: { employee_number: 'asc' },
						limit: 10000
					}
				})
	);
	const options = $derived(
		(contracts?.current?.employee_contract.rows ?? []).map((row) => ({
			value: row.id,
			label: `${row.employee_name} · ${row.employee_number}`
		}))
	);
</script>

{#snippet catalog(field: FieldEditor)}<CatalogueEditor family="claim_catalog" {field} />{/snippet}
<Sheet open title={bolt.t('claim.request_title')} onOpenChange={(open) => !open && onclose()}>
	<Form
		of="claim_catalog_entry"
		mode="create"
		values={{
			...(chosen === null ? {} : { employment_id: chosen }),
			entity_id: companyId,
			incurred_on: PlainDate(clock.today)
		}}
		submit={bolt.t('leave.submit')}
		onOutcome={(outcome) => {
			if (outcome.kind === 'committed') {
				toast.success(bolt.t('claim.requested'));
				onsaved();
			} else if (outcome.kind === 'pendingApproval') {
				notifyOutcome(bolt, outcome);
				onsaved();
			}
		}}
	>
		{#snippet children()}<Stack gap="md">
				{#if fixedEmployment === null}<Field name="employment_id">
						{#snippet editor(field)}
							<Combobox
								id={field.id}
								{options}
								value={chosen}
								placeholder="Select employment"
								aria-label="Employment"
								disabled={field.disabled}
								onChange={(value) => {
									chosen = value;
									field.onChange(value);
								}}
							/>
						{/snippet}
					</Field>{/if}
				<Field name="catalog_id" editor={catalog} />
				<Field name="incurred_on" />
				<Field name="quantity" />
				<Field name="evidence_file" />
			</Stack>{/snippet}
	</Form>
</Sheet>
