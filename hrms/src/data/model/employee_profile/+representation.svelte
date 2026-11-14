<script lang="ts">
	/**
	 * A person: one screen with a vertical rail. Profile holds the plain fields, edited in place; each dated family
	 * (Contract, Statutory, Family, Events) is its own tab, shown as a timeline, newest first.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Effect } from 'effect';
	import { fork } from '@norbital-ai/ui/effect';
	import {
		DescriptionHint,
		EmptyState,
		Form,
		Field,
		Icon,
		RecordShell,
		Section,
		Table,
		Tabs,
		Button,
		Sheet,
		toast,
		notify_outcome,
		open_record,
		type RecordView
	} from '@norbital-ai/ui';
	import { Columns, Stack, Cluster } from '@norbital-ai/ui/layout';
	import BalanceAdjustment from '../../../lib/ui/person/balance_adjustment.svelte';
	import BalanceLedger from '../../../lib/ui/person/balance_ledger.svelte';
	import BalanceOverview from '../../../lib/ui/person/balance_overview.svelte';
	import DatedFamily from '../../../lib/ui/person/dated_family.svelte';
	import FaceEnrollFlow from '../../../lib/ui/person/face_enroll_flow.svelte';
	import { personRead } from '../../../lib/ui/person/person_read.svelte.js';
	import ProfileContract from '../../../lib/ui/person/profile_contract.svelte';
	import ProfileEvents from '../../../lib/ui/person/profile_events.svelte';
	import ProfileFamily from '../../../lib/ui/person/profile_family.svelte';
	import { listedKindNames } from '../../../lib/ui/format/listed_kind_names.svelte.js';

	let { view, ctx }: { view: RecordView<'employee_profile'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const t: PageContext['t'] = (key, vars) => ctx.t(key, vars);
	const caseName = listedKindNames(ctx, 'case_kinds', () =>
		read.stints.flatMap((stint) => read.company(stint.entity_id)?.settings_code ?? [])
	);
	let enrolling = $state(false),
		adjusting = $state(false),
		saving = $state(false);
	function status(value: 'APPROVED' | 'NONE' | 'SUSPENDED') {
		if (record === null || saving) return;
		const target = { id: record.id, revision: record.revision };
		saving = true;
		fork(
			ctx
				.act({ 'employee_profile.update': [{ target, set: { face_enrollment_status: value } }] })
				.pipe(
					Effect.tap((outcome) => Effect.sync(() => notify_outcome(ctx, outcome))),
					Effect.catch((error) =>
						Effect.sync(() =>
							toast.error(error instanceof Error ? error.message : ctx.t('component.error'))
						)
					),
					Effect.ensuring(Effect.sync(() => (saving = false)))
				)
		);
	}
	const read = personRead(ctx, () => record?.id ?? null);
	const balance = $derived(
		record == null
			? null
			: ctx.query({
					employee_balance: {
						where: { employee_id: { eq: record.id } },
						fields: ['account'],
						limit: 1
					}
				})
	);
	const held = $derived(balance?.current?.employee_balance.rows[0]);
	const stintIds = $derived(read.stints.map((stint) => stint.id));
	const entityIds = $derived([...new Set(read.stints.map((stint) => stint.entity_id))]);
</script>

{#snippet general()}
	<Form
		{ctx}
		of="employee_profile"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		on_outcome={(outcome) => {
			if (outcome.kind !== 'committed' || record) return;
			const created = outcome.records.find((row) => row.model === 'employee_profile');
			if (created) open_record('employee_profile', created.id);
		}}
		>{#snippet children()}
			<Stack gap="md">
				<Section name="person_contact" title={t('person.section_contact')} first>
					<Columns count={2}>
						{#each ['name', 'email', 'phone', 'location', 'address'] as name (name)}<Field
								{ctx}
								{name}
							/>{/each}
					</Columns>
				</Section>
				<Section name="person_particulars" title={t('person.section_particulars')}>
					<Columns count={2}>
						{#each ['date_of_birth', 'identity_number', 'gender', 'birth_city', 'bank', 'cumulative_service'] as name (name)}<Field
								{ctx}
								{name}
							/>{/each}
					</Columns>
				</Section>
				<Section name="person_documents" title={t('person.section_documents')}>
					<Field {ctx} name="documents" />
				</Section>
				{#if record}{@render face()}{/if}
			</Stack>
		{/snippet}</Form
	>
{/snippet}
{#snippet contractTab()}{#if record}<ProfileContract
			{ctx}
			person={record.id}
			{read}
		/>{/if}{/snippet}
{#snippet statutoryTab()}<DatedFamily {ctx} of="statutory_parameters" {read} />{/snippet}
{#snippet familyTab()}{#if record}<ProfileFamily {ctx} person={record.id} {read} />{/if}{/snippet}
{#snippet eventsTab()}<ProfileEvents {ctx} {read} />{/snippet}
{#snippet loansTab()}{#if record}{#if stintIds.length === 0}<EmptyState
				title={t('models.loan_catalog_entry.label')}
			/>{:else}<Table
				{ctx}
				of="loan_catalog_entry"
				key="person-loans"
				where={{ employment_id: { in: stintIds } }}
				toolbar={{ new: false, title: t('models.loan_catalog_entry.label') }}
				columns={['catalog_code', 'quantity', 'repayment_period']}
			/>{/if}{/if}{/snippet}
{#snippet caseCell({ value }: { value: string | undefined })}<span>{caseName(value ?? '')}</span
	>{/snippet}
{#snippet casesTab()}{#if record}{#if entityIds.length === 0}<EmptyState
				title={t('app.cases.title')}
			/>{:else}<Stack size="fill" gap="sm"
				><DescriptionHint text={t('v2.cases_entity_scope')} /><Table
					{ctx}
					of="workplace_case_catalog_entry"
					key="person-workplace-cases"
					where={{ entity_id: { in: entityIds } }}
					order_by={{ opened_on: 'desc' }}
					toolbar={{ new: false, title: t('app.cases.title') }}
					columns={[{ field: 'kind', cell: caseCell }, 'entity_id', 'opened_on', 'closed_on']}
				/></Stack
			>{/if}{/if}{/snippet}
{#snippet overviewTab()}{#if held}<BalanceOverview {ctx} account={held.account} />{/if}{/snippet}
{#snippet ledgerTab()}{#if held}<BalanceLedger
			{ctx}
			balanceId={held.id}
			onadjust={() => (adjusting = true)}
		/>{/if}{/snippet}
{#snippet finances()}{#if record}{#if held === undefined}<EmptyState
				title={t('v2.balances')}
			/>{:else}<Tabs
				tabs={[
					{
						name: 'overview',
						title: t('balance.overview'),
						icon: 'lucide:scale',
						body: overviewTab
					},
					{ name: 'ledger', title: t('balance.ledger'), icon: 'lucide:list', body: ledgerTab }
				]}
			/>{/if}{/if}{/snippet}
{#snippet face()}{#if record}{@const faceStatus = record.face_enrollment_status ?? 'NONE'}<Cluster
			gap="sm"
			align="center"
			justify="between"
			class="rounded-lg border px-3 py-2"
		>
			<Cluster gap="sm" align="center">
				<Icon name="lucide:scan-face" class="size-4 text-muted-foreground" />
				<span class="text-sm"
					>{faceStatus === 'NONE'
						? ctx.t('face.empty_title')
						: `${ctx.t('v2.face_status')}: ${faceStatus}`}</span
				>
			</Cluster>
			<Cluster gap="xs">
				<Button
					variant="secondary"
					disabled={saving || faceStatus === 'PENDING' || faceStatus === 'SUSPENDED'}
					onclick={() => (enrolling = true)}
					>{faceStatus === 'NONE' ? ctx.t('face.enroll') : ctx.t('v2.update_face')}</Button
				>
				{#if faceStatus === 'PENDING'}<Button disabled={saving} onclick={() => status('APPROVED')}
						>{ctx.t('v2.approve_face')}</Button
					><Button variant="secondary" disabled={saving} onclick={() => status('NONE')}
						>{ctx.t('v2.reject_face')}</Button
					>{:else if faceStatus === 'APPROVED'}<Button
						variant="secondary"
						disabled={saving}
						onclick={() => status('SUSPENDED')}>{ctx.t('v2.suspend_face')}</Button
					>{:else if faceStatus === 'SUSPENDED'}<Button
						disabled={saving}
						onclick={() => status('APPROVED')}>{ctx.t('v2.reinstate_face')}</Button
					>{/if}
			</Cluster>
		</Cluster>{/if}{/snippet}
<RecordShell
	{ctx}
	of="employee_profile"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record === null}{@render general()}{:else}<Tabs
			orientation="vertical"
			tabs={[
				{ name: 'general', title: t('v2.profile'), icon: 'lucide:user-round', body: general },
				{
					name: 'contract',
					title: t('person.tab_contract'),
					icon: 'lucide:file-signature',
					body: contractTab
				},
				{
					name: 'statutory',
					title: t('models.statutory_parameters.label'),
					icon: 'lucide:landmark',
					body: statutoryTab
				},
				{ name: 'family', title: t('person.tab_family'), icon: 'lucide:users', body: familyTab },
				{
					name: 'events',
					title: t('person.tab_events'),
					icon: 'lucide:calendar-heart',
					body: eventsTab
				},
				{
					name: 'loans',
					title: ctx.t('models.loan_catalog_entry.label'),
					icon: 'lucide:banknote',
					body: loansTab
				},
				{
					name: 'cases',
					title: ctx.t('app.cases.title'),
					icon: 'lucide:briefcase-medical',
					body: casesTab
				},
				{ name: 'finances', title: ctx.t('v2.balances'), icon: 'lucide:scale', body: finances }
			]}
		/>{/if}
</RecordShell>
{#if adjusting && record && held}<BalanceAdjustment
		{ctx}
		employeeId={record.id}
		balanceId={held.id}
		onclose={() => (adjusting = false)}
	/>{/if}
{#if enrolling && record}<Sheet
		open
		on_open_change={(open) => !open && (enrolling = false)}
		title={ctx.t('face.enroll')}
		><FaceEnrollFlow
			{ctx}
			{record}
			onsaved={() => (enrolling = false)}
			onclose={() => (enrolling = false)}
		/></Sheet
	>{/if}
