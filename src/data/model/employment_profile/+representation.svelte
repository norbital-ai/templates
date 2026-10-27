<script lang="ts">
	/**
	 * A person in three tabs: general identity and facts, their employment contracts as one table (closed ones are
	 * the history), and face enrolment — the fields plus the guided capture flow that writes them.
	 */
	import { bolt } from '$bolt';
	import {
		Button,
		EmptyState,
		Field,
		Form,
		StructuredData,
		openRecord,
		RecordShell,
		Section,
		Table,
		Tabs,
		type RecordView
	} from '@norbital-ai/ui';
	import { Cluster, Grid } from '@norbital-ai/ui/layout';
	import {
		formatCalendarDate,
		formatTermsDates
	} from '../../../lib/ui/format/display_formatters.js';
	import { listedKindNames } from '../../../lib/ui/format/listed_kind_names.svelte.js';
	import { termsFromFacts } from '../../../lib/payroll_engine/contract_terms.js';
	import ChangeTerms from '../../../lib/ui/person/change_terms.svelte';
	import FaceEnrollFlow from '../../../lib/ui/person/face_enroll_flow.svelte';
	import { governingVersion } from '../../../lib/ui/person/governing_version.svelte.js';
	import { profileFactsSchema } from '../../../lib/ui/person/form_schema.js';
	import Hire from '../../../lib/ui/person/hire.svelte';
	import Offboarding from '../../../lib/ui/person/offboarding.svelte';

	let { view }: { view: RecordView<'employment_profile'> } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;
	let tab = $state('general');
	let enrolling = $state(false);
	const contracts = $derived.by(() =>
		record == null
			? null
			: bolt.query({
					employment_contract: {
						where: { employee_id: { eq: record.id } },
						fields: [
							'employee_number',
							'effective_range',
							'exit_ground',
							'exit_facts',
							'signed_contract_end',
							'company_id',
							'facts'
						]
					},
					'employment_contract.company_id': { fields: ['name'] }
				})
	);
	const today = $derived(new Date().toISOString().slice(0, 10));
	const exitName = listedKindNames('exit_grounds');
	const ordered = $derived(
		(contracts?.current?.employment_contract.rows ?? [])
			.flatMap((row) => {
				// an employment whose entity the viewer cannot read is not listed
				const company = row.company_id;
				if (company == null) return [];
				const to = row.effective_range?.to == null ? null : String(row.effective_range.to);
				const current = to == null || to >= today;
				const exit = row.exit_ground ?? null;
				return [
					{
						id: row.id,
						companyId: company.id,
						number: row.employee_number,
						entity: company.name,
						period: formatTermsDates(row, t),
						from: String(row.effective_range?.from ?? ''),
						to,
						current,
						status: current
							? t('section.employment_current')
							: t('section.employment_ended', { date: formatCalendarDate(to) }),
						exit,
						exitLabel: exit == null || exit === '' ? '—' : exitName(exit),
						exitFacts: row.exit_facts ?? null,
						plannedEnd: row.signed_contract_end == null ? null : String(row.signed_contract_end),
						terms: termsFromFacts(row.facts)
					}
				];
			})
			.toSorted((left, right) => (right.from < left.from ? -1 : 1))
	);
	/** The facts the version governing the latest contract's entity today declares; null when it declares none. */
	const version = governingVersion(
		() => ordered[0]?.companyId ?? null,
		() => today
	);
	const factsSchema = $derived(profileFactsSchema(version.schema));
</script>

{#snippet generalForm()}
	<Form
		of="employment_profile"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record ? { id: record.id } : {}}
		{record}
		{values}
		onOutcome={(outcome) => {
			if (outcome.kind !== 'committed' || record) return;
			const mine = outcome.records.find((row) => row.model === 'employment_profile');
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
			<Section name="personal" title={t('section.personal_and_family')}>
				<Grid minimum="card">
					<Field name="marital_status" />
					<Field name="children" />
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
				{#if version.loading}
					<p class="text-meta">{t('component.loading')}</p>
				{:else if factsSchema == null}
					<EmptyState title={t('person.no_statutory_facts')} />
				{:else}
					<Field name="facts" label="">
						{#snippet editor(field)}
							<StructuredData
								mode="edit"
								schema={factsSchema}
								value={field.value}
								onChange={field.onChange}
								name={field.name}
								id={field.id}
								disabled={field.disabled}
							/>
						{/snippet}
						{#snippet view(field)}
							<StructuredData
								mode="view"
								schema={factsSchema}
								value={field.value}
								onChange={() => {}}
								name={field.name}
								id={field.id}
								readonly
							/>
						{/snippet}
					</Field>
				{/if}
			</Section>
		{/snippet}
	</Form>
{/snippet}

{#snippet contractActions({ row }: { row: (typeof ordered)[number] })}
	{#if row.current || row.exit != null}
		<Cluster gap="sm">
			<ChangeTerms id={row.id} companyId={row.companyId} terms={row.terms} ended={!row.current} />
			<Offboarding
				id={row.id}
				companyId={row.companyId}
				hireFrom={row.from}
				lastDay={row.to}
				exitGround={row.exit}
				exitFacts={row.exitFacts}
				plannedEnd={row.plannedEnd}
			/>
		</Cluster>
	{/if}
{/snippet}

{#snippet contractsTab()}
	<Section name="contracts" title={t('section.employment_contracts')}>
		{#if contracts?.loading}
			<p class="text-meta">{t('component.loading')}</p>
		{:else if ordered.length === 0}
			<EmptyState title={t('section.no_employment_contracts')} />
		{:else}
			<Table
				of={ordered}
				key="person-contracts"
				columns={[
					{ field: 'number', label: t('component.employee_number') },
					{ field: 'entity', label: t('models.entity.singular') },
					{ field: 'period', label: t('component.effective_period') },
					{ field: 'status', label: t('component.status') },
					{ field: 'exitLabel', label: t('offboarding.ground') },
					{ field: 'id', label: t('person.contract_actions'), cell: contractActions }
				]}
				toolbar={{
					new: false,
					actions: false,
					search: false,
					filter: false,
					export: false,
					delete: false,
					select: false
				}}
				onOpen={(row) => openRecord('employment_contract', row.id)}
			/>
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
					of={{ automation: 'employment_profile_anonymise' }}
					values={{ employee: record.id }}
					fields={[]}
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
