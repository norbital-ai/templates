<script lang="ts" module>
	/** The references a form picks, each shown as `code · name` and ordered by its code, as the record views always did. */
	const REFS = {
		project: { of: 'projects', show: ['project_number', 'project_name'] },
		site: { of: 'site_locations', show: ['location_code', 'location_name'] },
		job: { of: 'jobs', show: ['job_title'] },
		worker: { of: 'workers', show: ['worker_number', 'worker_name'] },
		bim: { of: 'bim_reference_matrix', show: ['reference_name'] }
	} as const;
	export type Ref = keyof typeof REFS;
</script>

<script lang="ts">
	import { Field } from '@norbital-ai/ui';
	import { Picker } from '@norbital-ai/ui';

	let { name, ref }: { name: string; ref: Ref } = $props();
	const spec = $derived(REFS[ref]);
</script>

<Field {name}>
	{#snippet editor(field)}
		<Picker
			of={spec.of}
			label={spec.show}
			orderBy={spec.show[0]}
			limit={500}
			value={typeof field.value === 'string' ? field.value : null}
			onChange={field.onChange}
			disabled={field.disabled}
		/>
	{/snippet}
</Field>
