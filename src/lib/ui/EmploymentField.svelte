<script lang="ts">
	import type { Id } from '@norbital-ai/bolt';
	import { Field, Picker } from '@norbital-ai/ui';
	import { employmentPicker } from './create-scope.js';

	/** A form's `employment_id`, picked among the entity's own employments. */
	let { label, companyId }: { label: string; companyId: Id<'companies'> | undefined } = $props();
</script>

<Field name="employment_id" {label}>
	{#snippet editor(field)}
		<Picker
			{...employmentPicker(companyId)}
			value={typeof field.value === 'string' && field.value !== '' ? field.value : null}
			onChange={field.onChange}
			disabled={field.disabled}
		/>
	{/snippet}
</Field>
