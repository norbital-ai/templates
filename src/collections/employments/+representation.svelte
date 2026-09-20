<script lang="ts">
	/**
	 * The employment record, two tabs. General is the stint itself (`ContractDetail` without its
	 * terms: person, entity, employee number, bank, dates, departure). Employment contracts is the
	 * timeline of the stint's terms rows — every contract the person has held under it, newest
	 * first, the one in force marked — and a tap opens that contract's own record. Off-boarding and
	 * Change terms open from here and nowhere else: both write the sealed stint's departure or its
	 * next contract, so they stay beside what they settle. A new employment is the same form, empty.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n, type UiKeys } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { TabConfig } from '@norbital-ai/ui/tabs';
	import {
		createCollectionRouteKey,
		getCollectionNavigationContext
	} from '@norbital-ai/ui/collection-navigation';
	import { Button } from '@norbital-ai/ui/button';
	import * as Dialog from '@norbital-ai/ui/dialog';
	import Icon from '@iconify/svelte';
	import OffboardingFlow from '../../lib/ui/offboarding/offboarding-flow.svelte';
	import ChangeTermsFlow from '../../lib/ui/offboarding/change-terms-flow.svelte';
	import ContractDetail from '../../lib/ui/contract/contract-detail.svelte';
	import HireForm from '../../lib/ui/contract/hire-form.svelte';
	import { coversDate, readRange } from '../payroll_runs/lib/effective.js';
	import { HR_CREATE_SCOPE, hrCreateScope, type HrCreateScope } from '../../lib/ui/create-scope.js';
	import { setContext } from 'svelte';
	import { todayKey } from '../../lib/ui/calendar.js';
	import { formatTermsDates } from '../../lib/ui/display-formatters.js';

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
	/** A closed range is a departed contract: only comments stay writable, and the flows hide. */
	const departed = $derived(readRange(record?.effective_range)?.end != null);
	const rangeStart = $derived(readRange(record?.effective_range)?.start ?? '');

	/* ── the contracts: every terms row of this stint, newest first ─────────────────────────── */
	const today = todayKey();
	const contractsQuery = $derived(
		record == null
			? null
			: client.db.employment_terms.findMany({
					where: { employment_id: { eq: record.id }, approval_id: { isNull: true } },
					orderBy: { created_at: 'asc' },
					limit: 100
				})
	);
	const contracts = $derived(
		(contractsQuery?.current ?? []).toSorted((left, right) =>
			(readRange(right.effective_range)?.start ?? '').localeCompare(
				readRange(left.effective_range)?.start ?? ''
			)
		)
	);
	const detailNavigation = getCollectionNavigationContext();
	const contractRouteKey = createCollectionRouteKey({ view: 'employments:contracts' });
	function openContract(contractId: string): void {
		detailNavigation?.open({
			collectionName: 'employment_terms',
			recordId: contractId,
			routeKey: contractRouteKey
		});
	}
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/record-media/employments-banner.svg"
	/>
</svelte:head>

{#snippet contractActions()}
	{#if !departed}
		<div class="flex gap-2">
			<Button variant="outline" size="sm" onclick={() => (changeTermsOpen = true)}>
				<Icon icon="lucide:file-signature" class="size-4" />
				{t('offboarding.change_terms')}
			</Button>
			<Button variant="destructive" size="sm" onclick={() => (offboardOpen = true)}>
				<Icon icon="lucide:log-out" class="size-4" />
				{t('offboarding.open')}
			</Button>
		</div>
	{/if}
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
			<ContractDetail {record} {scopedCompanyId} contracts={false} />
		{:else}
			<HireForm onDone={close} />
		{/if}
	</Stack>
{/snippet}

<!--
	The contracts as a timeline: one entry per terms row, newest first, the one in force today
	marked. Each is a button into the contract's own record, where the terms show whole.
-->
{#snippet contractsTab()}
	{#if contractsQuery?.loading}
		<p class="text-meta">{t('component.loading')}</p>
	{:else if contracts.length === 0}
		<p class="text-meta">{t('component.timeline_no_terms')}</p>
	{:else}
		<ol class="ml-1 border-l border-border">
			{#each contracts as contract (contract.id)}
				{@const inForce = coversDate(contract.effective_range, today)}
				<li class="relative pb-5 pl-5 last:pb-0">
					<span
						class="absolute top-2 -left-[5px] size-2 rounded-full {inForce
							? 'bg-primary'
							: 'bg-muted-foreground'}"
					></span>
					<button
						type="button"
						class="w-full rounded-md border border-border px-3 py-2 text-left hover:bg-muted/40"
						onclick={() => openContract(contract.id)}
					>
						<Stack gap="xs">
							<Inline align="baseline" gap="sm" justify="between">
								<span class="text-sm font-medium">{contract.summary}</span>
								{#if inForce}
									<span class="text-meta">{t('component.timeline_active')}</span>
								{/if}
							</Inline>
							<span class="text-meta tabular-nums">{formatTermsDates(contract, t)}</span>
						</Stack>
					</button>
				</li>
			{/each}
		</ol>
	{/if}
{/snippet}

<RecordShell
	actions={record != null ? contractActions : undefined}
	tabs={[
		{ name: 'general', label: t('component.general'), icon: 'lucide:briefcase', content: general },
		...(record
			? [
					{
						name: 'contracts',
						label: t('component.employment_contracts'),
						icon: 'lucide:file-signature',
						content: contractsTab
					}
				]
			: [])
	] satisfies TabConfig[]}
/>
