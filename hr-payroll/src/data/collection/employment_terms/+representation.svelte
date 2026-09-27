<script lang="ts">
	/**
	 * One revision of a contract's terms, opened on its own (a finder result, a link). The contract record shows the same
	 * fields in place; this is the same composition. The contract is prefilled and not offered when the scope names it.
	 */
	import { bolt } from '$bolt';
	import { Form } from '@norbital-ai/ui';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import { createValues, hrCreateScope } from '../../../lib/ui/create-scope.js';
	import TermsFields from '../../../lib/ui/contract/terms-fields.svelte';

	let { view }: { view: RecordView<'employment_terms'> } = $props();
	const scope = hrCreateScope();
	const scopedEmploymentId = $derived(scope?.employmentId?.());
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(createValues(view, { employment_id: scopedEmploymentId }));
</script>

<RecordShell of="employment_terms" {...record == null ? {} : { id: record.id }} mode={view.mode}>
	<Form
		of="employment_terms"
		mode={view.mode}
		{record}
		{values}
		submit={record ? bolt.t('component.save_terms') : bolt.t('component.create_terms')}
	>
		<TermsFields
			employmentScoped={record != null || scopedEmploymentId != null}
			scopedCompanyId={scope?.companyId()}
		/>
	</Form>
</RecordShell>
