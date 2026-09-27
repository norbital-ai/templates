<script lang="ts" module>
	/** The references a form picks, each shown as `code · name` and ordered by its code, as the record views always did. */
	const REFS = {
		project: {
			of: 'projects',
			show: ['project_number', 'project_name'],
			label: 'component.project'
		},
		site: {
			of: 'site_locations',
			show: ['location_code', 'location_name'],
			label: 'component.site_location'
		},
		job: { of: 'jobs', show: ['job_title'], label: 'component.job' },
		job_coded: { of: 'jobs', show: ['job_number', 'job_title'], label: 'component.job' },
		worker: { of: 'workers', show: ['worker_number', 'worker_name'], label: 'component.worker' },
		certification: {
			of: 'certification_types',
			show: ['certification_code', 'certification_name'],
			label: 'component.certification'
		},
		permit: { of: 'permits_to_work', show: ['permit_number'], label: 'component.permit_to_work' },
		bim: { of: 'bim_reference_matrix', show: ['reference_name'], label: 'component.bim_reference' }
	} as const;
	export type Ref = keyof typeof REFS;
</script>

<script lang="ts">
	import { bolt } from '$bolt';
	import { Field } from '@norbital-ai/ui';
	import { Picker } from '@norbital-ai/ui';

	let { name, ref, label }: { name: string; ref: Ref; label?: string } = $props();
	const spec = $derived(REFS[ref]);
</script>

<Field {name} label={label ?? bolt.t(spec.label)}>
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
