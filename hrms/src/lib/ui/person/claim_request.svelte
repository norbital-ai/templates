<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { Id } from '@norbital-ai/bolt';
	import {
		Field,
		Form,
		Picker,
		Sheet,
		notify_outcome,
		toast,
		type FieldEditor
	} from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import CatalogueEditor from './catalogue_editor.svelte';
	let {
		ctx,
		employmentId: fixedEmployment = null,
		companyId,
		onsaved,
		onclose
	}: {
		ctx: PageContext;
		employmentId?: Id<'employee_contract'> | null;
		companyId: Id<'entity'>;
		onsaved: () => void;
		onclose: () => void;
	} = $props();
	const clock = ctx.clock('day');
	let chosen = $state<Id<'employee_contract'> | null>(fixedEmployment);
</script>

{#snippet catalog(field: FieldEditor)}<CatalogueEditor
		{ctx}
		family="claim_catalog"
		{field}
	/>{/snippet}
<Sheet open title={ctx.t('claim.request_title')} on_open_change={(open) => !open && onclose()}>
	<Form
		{ctx}
		of="claim_catalog_entry"
		mode="create"
		values={{
			...(chosen === null ? {} : { employment_id: chosen }),
			entity_id: companyId,
			incurred_on: clock.today
		}}
		submit={ctx.t('leave.submit')}
		on_outcome={(outcome) => {
			if (outcome.kind === 'committed') {
				toast.success(ctx.t('claim.requested'));
				onsaved();
			} else if (outcome.kind === 'pending_approval') {
				notify_outcome(ctx, outcome);
				onsaved();
			}
		}}
	>
		{#snippet children()}<Stack gap="md">
				{#if fixedEmployment === null}<Field {ctx} name="employment_id">
						{#snippet editor(field)}
							<Picker
								{ctx}
								of="employee_contract"
								id={field.id}
								where={{ entity_id: { eq: companyId }, status: { eq: 'SEALED' } }}
								value={chosen}
								disabled={field.disabled}
								on_change={(value) => {
									chosen = value;
									field.on_change(value);
								}}
							/>
						{/snippet}
					</Field>{/if}
				<Field {ctx} name="catalog_code" editor={catalog} />
				<Field {ctx} name="incurred_on" />
				<Field {ctx} name="quantity" />
				<Field {ctx} name="evidence_file" />
			</Stack>{/snippet}
	</Form>
</Sheet>
