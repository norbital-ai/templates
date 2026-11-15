<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { Id } from '@norbital-ai/bolt';
	import { Field, Form, Picker, RecordShell, Sheet, type FieldEditor } from '@norbital-ai/ui';
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
		employmentId?: Id<'employment'> | null;
		companyId: Id<'entity'>;
		onsaved: () => void;
		onclose: () => void;
	} = $props();
	const clock = ctx.clock('day');
	let chosen = $state<Id<'employment'> | null>(fixedEmployment);
</script>

{#snippet catalog(field: FieldEditor)}<CatalogueEditor
		{ctx}
		family="claim_catalog"
		{field}
	/>{/snippet}
<Sheet open title={ctx.t('claim.request_title')} on_open_change={(open) => !open && onclose()}>
	<RecordShell {ctx} of="claim_catalog_entry" mode="create" on_done={onsaved}>
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
		>
			{#snippet children()}<Stack gap="md">
					{#if fixedEmployment === null}<Field {ctx} name="employment_id">
							{#snippet editor(field)}
								<Picker
									{ctx}
									of="employment"
									id={field.id}
									where={{ entity_id: { eq: companyId } }}
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
	</RecordShell>
</Sheet>
