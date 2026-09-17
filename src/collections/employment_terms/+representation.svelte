<script lang="ts">
	/**
	 * One revision of a contract's terms, opened on its own (a finder result, a link). The contract
	 * record shows the same fields in place; this is the same composition with nothing left out.
	 * The employment picker is prefilled and hidden when the scope names the contract.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';
	import TermsFields from '../../lib/ui/contract/terms-fields.svelte';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const scopedEmploymentId = $derived(createScope?.employmentId?.());
	const scopedCompanyId = $derived(createScope?.companyId());
	const formValues = $derived(
		record ?? (scopedEmploymentId ? { employment_id: scopedEmploymentId } : undefined)
	);
</script>

<RecordShell>
	<CollectionForm
		{client}
		collection="employment_terms"
		defaultValues={formValues}
		submitLabel={record ? t('component.save_terms') : t('component.create_terms')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<TermsFields {Field} employmentScoped={scopedEmploymentId != null} {scopedCompanyId} />
		{/snippet}
	</CollectionForm>
</RecordShell>
