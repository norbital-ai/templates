<script lang="ts">
	/**
	 * A person in three tabs: general identity and facts, their employment contracts (closed ones are
	 * the history), and face enrolment — the fields plus the guided capture flow that writes them.
	 */
	import { bolt } from '$bolt';
	import {
		Button,
		Field,
		Form,
		openRecord,
		RecordShell,
		Section,
		Tabs,
		type RecordView
	} from '@norbital-ai/ui';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { liveRows } from '../../../lib/ui/state/live.svelte.js';
	import { termsFromFacts } from '../../../lib/payroll_engine/contract_terms.js';
	import ChangeTerms from '../../../lib/ui/person/change_terms.svelte';
	import FaceEnrollFlow from '../../../lib/ui/person/face_enroll_flow.svelte';
	import Hire from '../../../lib/ui/person/hire.svelte';
	import Offboarding from '../../../lib/ui/person/offboarding.svelte';

	let { view }: { view: RecordView<'employment_profile'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;
	let tab = $state('general');
	let enrolling = $state(false);
	const contracts = liveRows(() =>
		record == null
			? null
			: bolt.read('employment_contract', {
					where: { employee_id: { eq: record.id } },
					select: {
						id: true,
						employee_number: true,
						effective_range: true,
						exit_ground: true,
						exit_facts: true,
						signed_contract_end: true,
						company_id: true,
						facts: true
					},
					all: true
				})
	);
	const ordered = $derived(
		(contracts.current ?? [])
			.map((row) => ({
				id: row.id,
				companyId: row.company_id,
				number: row.employee_number,
				from: String(row.effective_range?.from ?? ''),
				to: row.effective_range?.to == null ? null : String(row.effective_range.to),
				exit: row.exit_ground,
				exitFacts: row.exit_facts ?? null,
				plannedEnd: row.signed_contract_end == null ? null : String(row.signed_contract_end),
				terms: termsFromFacts(row.facts)
			}))
			.toSorted((left, right) => (right.from < left.from ? -1 : 1))
	);
	const today = $derived(new Date().toISOString().slice(0, 10));
</script>

{#snippet generalForm()}
	<Form
		of="employment_profile"
		mode={view.mode}
		{...record ? { id: record.id } : {}}
		{record}
		{values}
		onOutcome={(outcome) => {
			if (outcome.kind !== 'committed' || record) return;
			const mine = outcome.records.find((row) => row.collection === 'employment_profile');
			if (mine) openRecord('employment_profile', mine.id);
		}}
	>
		{#snippet children()}
			<Section first name="identity" title={t('section.identity')}>
				<Grid minimum="card">
					<Field name="name" />
					<Field name="date_of_birth" />
					<Field name="gender" />
					<Field name="nationality" />
					<Field name="identity_number" />
				</Grid>
			</Section>
			<Section name="personal" title={t('section.personal')}>
				<Grid minimum="card">
					<Field name="marital_status" />
					<Field name="spouse_status" />
					<Field name="solo_parent" />
					<Field name="disabled" />
					<Field name="receiving_pension" />
					<Field name="race" />
					<Field name="religion" />
				</Grid>
			</Section>
			<Section name="family" title={t('section.family')}>
				<Grid minimum="card">
					<Field name="children" />
					<Field name="dependents_count" />
				</Grid>
			</Section>
			<Section name="contact" title={t('section.contact')}>
				<Grid minimum="card">
					<Field name="email" />
					<Field name="phone" />
					<Field name="address" />
					<Field name="location" />
				</Grid>
			</Section>
			<Section name="facts" title={t('section.statutory_facts')}>
				<Field name="facts" />
			</Section>
		{/snippet}
	</Form>
{/snippet}

{#snippet contractsTab()}
	<Section name="contracts" title={t('section.employment_contracts')} defaultOpen={false}>
		{#if contracts.loading}
			<p class="text-meta">{t('component.loading')}</p>
		{:else if ordered.length === 0}
			<p class="text-meta">{t('section.no_employment_contracts')}</p>
		{:else}
			{#each ordered as contract (contract.id)}
				{@const current =
					contract.to == null || contract.to >= today
						? t('section.employment_current')
						: t('section.employment_ended', { date: contract.to })}
				{@const isCurrent = contract.to == null || contract.to >= today}
				<Stack gap="xs">
					<Button variant="ghost" onclick={() => openRecord('employment_contract', contract.id)}>
						<span class="w-full text-left">
							{contract.number} · {contract.from} → {contract.to ?? '…'} · {current}{contract.exit ==
							null
								? ''
								: ` · ${contract.exit}`}
						</span>
					</Button>
					{#if isCurrent || contract.exit != null}
						<Cluster gap="sm">
							<ChangeTerms
								id={contract.id}
								companyId={contract.companyId}
								terms={contract.terms}
								ended={!isCurrent}
							/>
							<Offboarding
								id={contract.id}
								companyId={contract.companyId}
								hireFrom={contract.from}
								lastDay={contract.to}
								exitGround={contract.exit ?? null}
								exitFacts={contract.exitFacts}
								plannedEnd={contract.plannedEnd}
							/>
						</Cluster>
					{/if}
				</Stack>
			{/each}
		{/if}
	</Section>
	{#if record && ordered.length > 0 && ordered.every((contract) => contract.to != null && contract.to < today)}
		<Section name="anonymise" title={t('person.anonymise_title')} defaultOpen={false}>
			{#if record.anonymised_at != null}
				<p class="text-meta">
					{t('person.anonymised', { date: String(record.anonymised_at).slice(0, 10) })}
				</p>
			{:else}
				<p class="text-meta">{t('person.anonymise_help')}</p>
				<Form
					of={{ action: 'employment_profile.anonymise' }}
					id={record.id}
					submit={t('person.anonymise')}
				/>
			{/if}
		</Section>
	{/if}
{/snippet}

{#snippet faceTab()}
	{#if record}
		{#if enrolling}
			<FaceEnrollFlow
				record={{ id: record.id, face_enrollment_status: record.face_enrollment_status }}
				onsaved={() => (enrolling = false)}
				onclose={() => (enrolling = false)}
			/>
		{:else}
			<Button variant="outline" onclick={() => (enrolling = true)}>
				{t(record.face_enrollment_status === 'APPROVED' ? 'face.re_enroll' : 'face.enroll')}
			</Button>
			<Form
				of="employment_profile"
				mode="update"
				id={record.id}
				{record}
				values={{}}
				onOutcome={() => {}}
			>
				{#snippet children()}
					<Section first name="face" title={t('section.face')}>
						<Grid minimum="card">
							<Field name="face_enrollment_status" />
							<Field name="face_enrolled_at" />
							<Field name="face_consent_at" />
							<Field name="face_last_match_at" />
							<Field name="face_match_count" />
							<Field name="face_photo" />
						</Grid>
					</Section>
				{/snippet}
			</Form>
		{/if}
	{/if}
{/snippet}

{#snippet actions()}
	{#if record}
		<Hire employeeId={record.id} name={String(record.name)} />
	{/if}
{/snippet}

<RecordShell
	of="employment_profile"
	mode={view.mode}
	{actions}
	{...record == null
		? { values: view.mode === 'create' ? view.values : {} }
		: { id: record.id, subtitle: ['email'] }}
>
	{#key record?.revision}
		{#if view.mode === 'create' || record == null}
			{@render generalForm()}
		{:else}
			<Tabs
				tabs={[
					{ name: 'general', title: t('person.tab_general'), body: generalForm },
					{ name: 'contracts', title: t('person.tab_contracts'), body: contractsTab },
					{ name: 'face', title: t('person.tab_face'), body: faceTab }
				]}
				bind:value={tab}
			/>
		{/if}
	{/key}
</RecordShell>
