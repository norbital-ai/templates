<script lang="ts">
	/** One roster of record: the person and the calendar month. The days themselves are the Work board's. */
	import EmploymentField from '../../../lib/ui/EmploymentField.svelte';
	import { bolt } from '$bolt';
	import { Field, Form } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import { hrCreateScope } from '../../../lib/ui/create-scope.js';

	let { view }: { view: RecordView<'rosters'> } = $props();
	const scope = hrCreateScope();
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordShell of="rosters" mode={view.mode} {...record == null ? {} : { id: record.id }}>
	<Form of="rosters" mode={view.mode} {record} values={view.mode === 'create' ? view.values : {}}>
		<FormSection first title={bolt.t('component.roster')} hint={bolt.t('component.roster_hint')}>
			<Grid gap="sm" minimum="compact">
				<EmploymentField label={bolt.t('component.employment')} companyId={scope?.companyId()} />
				<Field name="period" label={bolt.t('component.month')} />
			</Grid>
		</FormSection>
	</Form>
</RecordShell>
