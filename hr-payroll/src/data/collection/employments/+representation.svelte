<script lang="ts">
	/**
	 * The employment record: the stint itself (`ContractDetail`: person, entity, employee number, bank, dates,
	 * departure, and its terms). Off-boarding and Change terms open from here and nowhere else: both write the sealed
	 * stint's departure or its next terms, so they stay beside what they settle. A new employment is the hire form.
	 */
	import { t } from '../../../lib/ui/t.js';
	import Icon from '@iconify/svelte';
	import { setContext } from 'svelte';
	import { Inline } from '@norbital-ai/ui/layout';
	import { Button } from '@norbital-ai/ui';
	import FlowDialog from '../../../lib/ui/FlowDialog.svelte';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import ContractDetail from '../../../lib/ui/contract/contract-detail.svelte';
	import { contractSeal } from '../../../lib/ui/contract/contract-seal.svelte.js';
	import HireForm from '../../../lib/ui/contract/hire-form.svelte';
	import {
		HR_CREATE_SCOPE,
		hrCreateScope,
		type HrCreateScope
	} from '../../../lib/ui/create-scope.js';
	import ChangeTermsFlow from '../../../lib/ui/offboarding/change-terms-flow.svelte';
	import OffboardingFlow from '../../../lib/ui/offboarding/offboarding-flow.svelte';

	let { view }: { view: RecordView<'employments'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	/**
	 * The entity a contract belongs to is the one the page is scoped to: scoped, it is prefilled and not asked for;
	 * unscoped, the form keeps the picker so a contract can still be filed from a finder result or a link.
	 */
	const createScope = hrCreateScope();
	const scopedCompanyId = $derived(createScope?.companyId());
	/** The scope the forms this record opens read: this contract, its person and entity, and the page's lineage. */
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		employmentId: () => record?.id,
		employeeId: () => record?.employee_id,
		companyId: () => record?.company_id ?? scopedCompanyId,
		settingsCode: () => createScope?.settingsCode()
	});
	let offboardOpen = $state(false);
	let changeTermsOpen = $state(false);
	/** A closed range is a departed contract: only its notes stay writable, and the flows hide. */
	const departed = $derived(record?.effective_range.to != null);
	const seal = contractSeal(() => record?.id);
	const sealed = $derived(record != null && seal.sealed);
</script>

{#snippet contractActions()}
	{#if !departed}
		<Inline gap="sm" align="stretch">
			<Button variant="outline" size="sm" onclick={() => (changeTermsOpen = true)}>
				<Icon icon="lucide:file-signature" class="size-4" />
				{t('offboarding.change_terms')}
			</Button>
			<Button variant="destructive" size="sm" onclick={() => (offboardOpen = true)}>
				<Icon icon="lucide:log-out" class="size-4" />
				{t('offboarding.open')}
			</Button>
		</Inline>
	{/if}
{/snippet}

<RecordShell
	of="employments"
	mode={view.mode}
	{...record == null ? {} : { id: record.id, actions: contractActions }}
	{...sealed
		? {
				icon: 'lucide:lock-keyhole',
				badge: t('component.settings_sealed_badge'),
				hint: t('component.employment_sealed')
			}
		: {}}
>
	{#if record != null}
		{#if !departed}
			<FlowDialog
				bind:open={changeTermsOpen}
				title={t('offboarding.change_terms_title')}
				description={t('offboarding.change_terms_description')}
			>
				<ChangeTermsFlow
					employment={{ id: record.id, company_id: record.company_id }}
					onclose={() => (changeTermsOpen = false)}
				/>
			</FlowDialog>
			<FlowDialog
				bind:open={offboardOpen}
				title={t('offboarding.title')}
				description={t('offboarding.description')}
			>
				<OffboardingFlow
					employment={{
						id: record.id,
						range_start: record.effective_range.from,
						company_id: record.company_id,
						employee_number: record.employee_number
					}}
					onclose={() => (offboardOpen = false)}
				/>
			</FlowDialog>
		{/if}
		<ContractDetail {record} {scopedCompanyId} sealNotice={false} />
	{:else}
		<HireForm />
	{/if}
</RecordShell>
