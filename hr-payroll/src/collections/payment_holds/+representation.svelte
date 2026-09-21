<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { employmentRelationOptions, hrCreateScope } from '../../lib/ui/create-scope.js';
	import FormSection from '../../lib/ui/form-section.svelte';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const scopedEmploymentId = $derived(createScope?.employmentId?.());
	const scopedCompanyId = $derived(createScope?.companyId?.());
	const formValues = $derived(
		record ?? (scopedEmploymentId ? { employment_id: scopedEmploymentId } : undefined)
	);
</script>

{#snippet form()}
	<CollectionForm
		{client}
		collection="payment_holds"
		defaultValues={formValues}
		submitLabel={record ? t('component.save_payment_hold') : t('component.record_payment_hold')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.payment_hold')}
					hint={t('component.payment_hold_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field
							name="employment_id"
							label={t('component.person')}
							hidden={scopedEmploymentId != null}
							relationOptions={employmentRelationOptions(scopedCompanyId)}
						/>
						<Field name="category" label={t('component.hold_category')} />
						<Column span="all">
							<Field name="directive_reference" label={t('component.directive_reference')} />
						</Column>
						<Field name="amount" label={t('component.hold_amount')} />
						<Field name="held_on" label={t('component.hold_placed_on')} />
						<Field name="released_on" label={t('component.hold_released_on')} />
						<Field name="released_amount" label={t('component.released_amount')} />
						<Column span="all">
							<Field
								name="reconciliation_reference"
								label={t('component.reconciliation_reference')}
							/>
						</Column>
						<Column span="all">
							<Field name="evidence_file" label={t('component.evidence_file')} />
						</Column>
					</Grid>
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
{/snippet}

<RecordShell>{@render form()}</RecordShell>
