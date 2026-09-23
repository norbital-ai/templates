<script lang="ts">
	/**
	 * The employment record, two tabs. General is the stint itself (`ContractDetail` without its
	 * terms: person, entity, employee number, bank, dates, departure). Employment contracts is the
	 * timeline of the stint's terms rows — every contract the person has held under it, newest
	 * first, the one in force marked — and a tap opens that contract's own record. Off-boarding and
	 * Change terms open from here and nowhere else: both write the sealed stint's departure or its
	 * next contract, so they stay beside what they settle. A new employment is the same form, empty.
	 */
	import { useI18n, type UiKeys } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { Button } from '@norbital-ai/ui/button';
	import { readRange } from '../payroll_runs/lib/effective.js';
	import * as Dialog from '@norbital-ai/ui/dialog';
	import Icon from '@iconify/svelte';
	import OffboardingFlow from '../../lib/ui/offboarding/offboarding-flow.svelte';
	import ChangeTermsFlow from '../../lib/ui/offboarding/change-terms-flow.svelte';
	import ContractDetail from '../../lib/ui/contract/contract-detail.svelte';
	import { contractSeal } from '../../lib/ui/contract/contract-seal.svelte.js';
	import HireForm from '../../lib/ui/contract/hire-form.svelte';
	import { HR_CREATE_SCOPE, hrCreateScope, type HrCreateScope } from '../../lib/ui/create-scope.js';
	import { setContext } from 'svelte';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys | UiKeys>();
	/**
	 * The legal entity a contract belongs to is the one the page is scoped to. Offering the picker
	 * lets an operator file a contract into an entity the page is not showing — the table it lands
	 * in then does not contain it. Scoped, the entity is prefilled and not asked for; unscoped, the
	 * form keeps the picker so a contract can still be filed from a finder result or a link.
	 */
	const createScope = hrCreateScope();
	const scopedCompanyId = $derived(createScope?.companyId());
	/**
	 * The scope the forms this record opens read (a statutory fact from the table below): this
	 * contract, its person and its entity, and the lineage the page already resolved.
	 */
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		employmentId: () => record?.id,
		employeeId: () => record?.employee_id,
		companyId: () => record?.company_id ?? scopedCompanyId,
		settingsCode: () => createScope?.settingsCode()
	});
	let offboardOpen = $state(false);
	let changeTermsOpen = $state(false);
	/**
	 * Edit mode lives here because the record shell's header renders its toggle. Cancel remounts
	 * the detail from the stored rows, which is the same reset the form's own Cancel used to do.
	 */
	let editing = $state(false);
	let contractEpoch = $state(0);
	function cancelEdit(): void {
		editing = false;
		contractEpoch += 1;
	}
	/** A closed range is a departed contract: only comments stay writable, and the flows hide. */
	const departed = $derived(readRange(record?.effective_range)?.end != null);
	const rangeStart = $derived(readRange(record?.effective_range)?.start ?? '');
	/** The seal rides the sheet header beside the record label, as every sealed record's does. */
	const seal = contractSeal(() => record?.id ?? '');
	const sealed = $derived(record != null && seal.sealed);
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/record-media/employments-banner.svg"
	/>
</svelte:head>

{#snippet contractActions()}
	<div class="flex gap-2">
		{#if !departed}
			<Button variant="outline" size="sm" onclick={() => (changeTermsOpen = true)}>
				<Icon icon="lucide:file-signature" class="size-4" />
				{t('offboarding.change_terms')}
			</Button>
			<Button variant="destructive" size="sm" onclick={() => (offboardOpen = true)}>
				<Icon icon="lucide:log-out" class="size-4" />
				{t('offboarding.open')}
			</Button>
		{/if}
		{#if editing}
			<Button variant="outline" size="sm" onclick={cancelEdit}>{t('common.cancel')}</Button>
		{:else}
			<Button variant="outline" size="sm" onclick={() => (editing = true)}>
				<Icon icon="lucide:pencil" class="size-4" />
				{t('common.edit')}
			</Button>
		{/if}
	</div>
{/snippet}

{#snippet general()}
	<Stack gap="md">
		{#if record != null && !departed}
			<Dialog.Root bind:open={changeTermsOpen}>
				<Dialog.Content class="max-h-[90dvh] max-w-2xl overflow-y-auto">
					<Dialog.Header>
						<Dialog.Title>{t('offboarding.change_terms_title')}</Dialog.Title>
						<Dialog.Description>{t('offboarding.change_terms_description')}</Dialog.Description>
					</Dialog.Header>
					{#if changeTermsOpen}
						<ChangeTermsFlow
							employment={{ id: record.id, company_id: record.company_id }}
							onclose={() => {
								changeTermsOpen = false;
							}}
						/>
					{/if}
				</Dialog.Content>
			</Dialog.Root>
			<Dialog.Root bind:open={offboardOpen}>
				<Dialog.Content class="max-h-[90dvh] max-w-2xl overflow-y-auto">
					<Dialog.Header>
						<Dialog.Title>{t('offboarding.title')}</Dialog.Title>
						<Dialog.Description>{t('offboarding.description')}</Dialog.Description>
					</Dialog.Header>
					{#if offboardOpen}
						<OffboardingFlow
							employment={{
								id: record.id,
								range_start: rangeStart,
								company_id: record.company_id,
								employee_number: record.employee_number
							}}
							onclose={() => {
								offboardOpen = false;
							}}
						/>
					{/if}
				</Dialog.Content>
			</Dialog.Root>
		{/if}
		{#if record != null}
			{#key contractEpoch}
				<ContractDetail
					{record}
					{scopedCompanyId}
					contracts={false}
					sealNotice={false}
					bind:editing
				/>
			{/key}
		{:else}
			<HireForm onDone={close} />
		{/if}
	</Stack>
{/snippet}

<RecordShell
	kind={t('component.employment')}
	icon={sealed ? 'lucide:lock-keyhole' : undefined}
	badge={sealed ? t('component.settings_sealed_badge') : undefined}
	hint={sealed ? t('component.employment_sealed') : undefined}
	actions={record != null ? contractActions : undefined}
>
	{@render general()}
</RecordShell>
