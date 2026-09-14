<script lang="ts">
	import { resolveEmployment } from '../../lib/employment-contract.js';
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	/**
	 * One person's whole file: who they are, the engagements they hold, the terms of each engagement
	 * and where each stands with the statutory schemes.
	 *
	 * These were four sibling tabs in the People app, which meant reading one person required knowing
	 * their employee number and then filtering three unrelated tables by it. They are all facts about
	 * one human being, so they are read from that human being's record.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps, WorkspaceRow } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { getDataRendererRuntimeContext } from '@norbital-ai/ui/data-renderer';
	import { Column, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import {
		createCollectionRouteKey,
		getCollectionNavigationContext
	} from '@norbital-ai/ui/collection-navigation';
	import type { TabConfig } from '@norbital-ai/ui/tabs';
	import FormSection from '../../lib/ui/form-section.svelte';
	import { readRange } from '../payroll_runs/lib/effective.js';
	import {
		formatCalendarDate,
		formatStatutoryFactStatus
	} from '../../lib/ui/display-formatters.js';
	import { calendarDateInTimeZone, PAYROLL_TIME_ZONE } from '../../lib/ui/calendar.js';
	import { Button } from '@norbital-ai/ui/button';
	import * as Dialog from '@norbital-ai/ui/dialog';
	import Icon from '@iconify/svelte';
	import FaceEnrollFlow from './face-enroll-flow.svelte';
	import { setContext } from 'svelte';
	import { HR_CREATE_SCOPE, type HrCreateScope } from '../../lib/ui/create-scope.js';

	/** Terms as the profile reads them: the pointer, and the named pattern riding the `with`. */
	type EmploymentTerm = Pick<
		WorkspaceRow<'employment_terms'>,
		'employment_id' | 'effective_range' | 'shift_pattern_id' | 'summary'
	> & {
		readonly term_shift_pattern?: Pick<
			WorkspaceRow<'shift_patterns'>,
			'id' | 'code' | 'name' | 'pattern'
		> | null;
	};

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const fileRuntime = getDataRendererRuntimeContext();
	/**
	 * Face enrollment opens from here and nowhere else: the kiosk on the wall only clocks. The
	 * flow mounts with the dialog and releases the camera when it closes.
	 */
	let enrollOpen = $state(false);
	let justSavedUrl = $state<string | null>(null);

	const approved = { approval_id: { isNull: true } } as const;

	const employmentsQuery = $derived(
		record == null
			? null
			: client.db.employments.findMany({
					where: { ...approved, employee_id: { eq: record.id } },
					columns: {
						id: true,
						company_id: true,
						employee_number: true,
						effective_range: true
					},
					orderBy: { employee_number: 'asc' },
					limit: 100
				})
	);
	const employments = $derived((employmentsQuery?.current ?? []).map(resolveEmployment));
	/**
	 * The scope the profile hands to the forms its tables open (terms, statutory facts). A person
	 * with one contract has it prefilled and hidden; with several, the picker offers the entity's
	 * own people, and with none the form is unnarrowed rather than empty. Statutory facts name
	 * the person directly, so the profile always hands its own id for those forms.
	 */
	const scopedEmployment = $derived(employments.length === 1 ? employments[0] : undefined);
	// The entity's lineage rides a second read: `with` joins are untyped on the browser client,
	// so the scope resolves the company row itself rather than joining it into the employments.
	const scopedCompanyQuery = $derived(
		scopedEmployment == null
			? null
			: client.db.companies.findFirst({
					where: { id: { eq: scopedEmployment.company_id } },
					columns: { settings_code: true }
				})
	);
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		employmentId: () => scopedEmployment?.id,
		employeeId: () => record?.id,
		companyId: () => scopedEmployment?.company_id,
		settingsCode: () => scopedCompanyQuery?.current?.settings_code ?? undefined
	});
	const subtitle = $derived(
		record == null
			? undefined
			: `${record.email ?? t('component.no_email_recorded')} · ${record.nationality ?? t('component.nationality_not_recorded')}`
	);
	// Terms are read only while the Employments tab is open. One employee-scoped query feeds every
	// row, so opening a profile does not mount a table or lookup per employment.
	const employmentTermsQuery = $derived(
		record == null
			? null
			: client.db.employment_terms.findMany({
					where: {
						approval_id: { isNull: true },
						// A relation only enters a predicate under a quantifier. Naming the related
						// column directly reads as a field of `employment_terms`, and the grammar
						// refuses it — "term_employment has unsupported operator employee_id" — which
						// reached the browser as an uncaught SchemaError on every profile opened.
						term_employment: { some: { employee_id: { eq: record.id } } }
					},
					// The named pattern rides the terms read; no second query per employment.
					with: {
						term_shift_pattern: { columns: { id: true, code: true, name: true, pattern: true } }
					},
					limit: 500
				})
	);
	const termsByEmployment = $derived.by(() => {
		const terms = new Map<string, EmploymentTerm[]>();
		for (const term of employmentTermsQuery?.current ?? []) {
			if (typeof term.employment_id !== 'string') continue;
			const bucket = terms.get(term.employment_id);
			if (bucket) bucket.push(term);
			else terms.set(term.employment_id, [term]);
		}
		return terms;
	});

	/** A stored day-precision instant as a `YYYY-MM-DD` key in the payroll timezone. */
	function timelineDayKey(value: unknown): string | null {
		if (value == null) return null;
		const instant = value instanceof Date ? value : new Date(String(value));
		if (Number.isNaN(instant.getTime())) return null;
		return calendarDateInTimeZone(instant, PAYROLL_TIME_ZONE);
	}

	type TimelineEvent = {
		readonly id: string;
		readonly dateKey: string;
		readonly kind: 'HIRED' | 'CHANGED' | 'EXITED';
		readonly detail: string | null;
	};

	type TimelineContract = {
		readonly id: string;
		readonly employeeNumber: string;
		readonly active: boolean;
		readonly events: readonly TimelineEvent[];
	};

	type TimelineColumn = {
		readonly companyId: string;
		readonly companyName: string;
		readonly contracts: readonly TimelineContract[];
	};

	// Company names for the timeline columns; the employments read carries only the id.
	const timelineCompanyIds = $derived([
		...new Set(employments.map((employment) => employment.company_id))
	]);
	const timelineCompaniesQuery = $derived(
		record == null || timelineCompanyIds.length === 0
			? null
			: client.db.companies.findMany({
					where: { id: { in: timelineCompanyIds } },
					columns: { id: true, name: true },
					limit: 50
				})
	);
	const timelineCompanyNames = $derived(
		new Map(
			(timelineCompaniesQuery?.current ?? []).map((company) => [
				String(company.id),
				company.name == null || company.name === '' ? String(company.id) : String(company.name)
			])
		)
	);

	/**
	 * One rail per legal entity, newest event first: joined, every change of terms that followed,
	 * and the exit when there is one. A promotion, a demotion, a new contract or a return all read
	 * as one line — the terms summary states what changed — so the record is a history rather than
	 * a set of bars whose overlap proves a hook. Each contract's number opens the contract itself.
	 */
	const timeline = $derived.by(() => {
		const byCompany = new Map<string, TimelineContract[]>();
		for (const employment of employments) {
			if (typeof employment.id !== 'string' || typeof employment.company_id !== 'string') continue;
			const number = employment.employee_number == null ? '—' : String(employment.employee_number);
			const range = readRange(employment.effective_range);
			if (range == null) continue;
			const hireKey = timelineDayKey(range.start);
			if (hireKey == null) continue;
			const endKey = range.end == null ? null : timelineDayKey(range.end);
			const terms = (termsByEmployment.get(employment.id) ?? [])
				.flatMap((term) => {
					const termRange = readRange(term.effective_range);
					const key = termRange == null ? null : timelineDayKey(termRange.start);
					if (key == null) return [];
					const summary =
						typeof term.summary === 'string' && term.summary !== '' ? term.summary : null;
					return [{ key, summary }];
				})
				.toSorted((left, right) => left.key.localeCompare(right.key));
			const events: TimelineEvent[] = [
				{
					id: `${employment.id}:hired`,
					dateKey: hireKey,
					kind: 'HIRED',
					detail: terms[0]?.summary ?? null
				}
			];
			for (const [index, term] of terms.entries())
				if (index > 0 && term.key > hireKey)
					events.push({
						id: `${employment.id}:term:${index}:${term.key}`,
						dateKey: term.key,
						kind: 'CHANGED',
						detail: term.summary
					});
			if (endKey != null)
				events.push({
					id: `${employment.id}:exit`,
					dateKey: endKey,
					kind: 'EXITED',
					detail: null
				});
			const contract: TimelineContract = {
				id: employment.id,
				employeeNumber: number,
				active: endKey == null,
				events: events.toSorted((left, right) => right.dateKey.localeCompare(left.dateKey))
			};
			const bucket = byCompany.get(employment.company_id) ?? [];
			bucket.push(contract);
			byCompany.set(employment.company_id, bucket);
		}
		const columns: TimelineColumn[] = [...byCompany]
			.map(([companyId, contracts]) => ({
				companyId,
				companyName: timelineCompanyNames.get(companyId) ?? companyId,
				contracts: contracts.toSorted((left, right) =>
					left.employeeNumber.localeCompare(right.employeeNumber)
				)
			}))
			.toSorted((left, right) => left.companyName.localeCompare(right.companyName));
		return { columns };
	});
	const detailNavigation = getCollectionNavigationContext();
	const contractRouteKey = createCollectionRouteKey({ view: 'employees:employments' });
	function openContract(contractId: string): void {
		detailNavigation?.open({
			collectionName: 'employments',
			recordId: contractId,
			routeKey: contractRouteKey
		});
	}

	const EVENT_LABEL_KEYS = {
		HIRED: 'component.timeline_hired',
		CHANGED: 'component.timeline_changed',
		EXITED: 'component.timeline_exited'
	} as const satisfies Record<TimelineEvent['kind'], TenantI18nKeys>;

	const storedPhotoKey = $derived.by(() => {
		if (record === null || typeof record.face_photo !== 'object' || record.face_photo === null)
			return null;
		const key = (record.face_photo as { readonly storage_key?: unknown }).storage_key;
		return typeof key === 'string' ? key : null;
	});
	const photoHref = $derived(
		justSavedUrl ??
			(storedPhotoKey === null ? null : (fileRuntime?.fileUrl(storedPhotoKey) ?? null))
	);
	const displayFaceStatus = $derived(
		justSavedUrl !== null && record?.face_enrollment_status === 'NONE'
			? 'APPROVED'
			: (record?.face_enrollment_status ?? 'NONE')
	);
	const FACE_STATUS_KEYS: Readonly<Record<string, TenantI18nKeys>> = {
		NONE: 'face.status_none',
		PENDING: 'face.status_pending',
		APPROVED: 'face.status_approved',
		SUSPENDED: 'face.status_suspended'
	};
</script>

{#snippet person()}
	<CollectionForm
		{client}
		collection="employees"
		defaultValues={record ?? undefined}
		submitLabel={record ? t('component.save_person') : t('component.add_person')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<!-- Written by the enrolment flow and the kiosk functions only; never offered. -->
			<Field name="user_id" hidden />
			<Field name="face_embedding" hidden />
			<Field name="face_photo" hidden />
			<Field name="face_enrollment_status" hidden />
			<Field name="face_consent_at" hidden />
			<Field name="face_enrolled_at" hidden />
			<Field name="face_last_match_at" hidden />
			<Field name="face_match_count" hidden />
			<Stack gap="lg">
				<FormSection first title={t('component.person')} hint={t('component.person_section_hint')}>
					<Grid gap="sm" minimum="compact">
						<Field name="name" />
						<Field name="gender" />
						<Field name="date_of_birth" label={t('component.date_of_birth')} />
						<Field name="nationality" />
						<Field name="identity_number" label={t('component.identity_number')} />
						<Field name="email" />
						<Field name="phone" />
						<Column span="all"><Field name="address" /></Column>
					</Grid>
				</FormSection>
				<FormSection title={t('component.standing')} hint={t('component.standing_hint')}>
					<Grid gap="sm" minimum="compact">
						<Field name="marital_status" label={t('component.marital_status')} />
						<Field name="solo_parent" label={t('component.solo_parent')} />
						<Field
							name="race"
							label={t('component.race')}
							description={t('component.race_religion_hint')}
						/>
						<Field
							name="religion"
							label={t('component.religion')}
							description={t('component.race_religion_hint')}
						/>
					</Grid>
				</FormSection>
				<FormSection
					title={t('component.family_section')}
					hint={t('component.family_section_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field name="spouse_status" label={t('component.spouse')} />
						<Field name="dependents_count" label={t('component.dependents')} />
						<Column span="all"
							><Field name="children" label={t('employee_children.title')} /></Column
						>
					</Grid>
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
{/snippet}

{#snippet engagements()}
	{#if record}
		<Stack gap="lg">
			{#if timeline.columns.length > 0}
				<FormSection
					first
					title={t('component.timeline_title')}
					hint={t('component.timeline_hint')}
				>
					<Stack gap="lg">
						{#each timeline.columns as column (column.companyId)}
							<Stack gap="sm">
								<h4 class="text-sm font-semibold">{column.companyName}</h4>
								{#each column.contracts as contract (contract.id)}
									<Stack gap="xs">
										<Inline align="baseline" gap="sm">
											<button
												type="button"
												class="text-sm font-medium text-primary underline-offset-4 hover:underline"
												onclick={() => openContract(contract.id)}
											>
												{contract.employeeNumber}
											</button>
											<span class="text-meta">
												{#if contract.active}
													{t('component.timeline_active')}
												{:else}
													{t('component.timeline_last_ended', {
														date: formatCalendarDate(
															contract.events.find((event) => event.kind === 'EXITED')?.dateKey ??
																''
														)
													})}
												{/if}
											</span>
										</Inline>
										<ol class="ml-1 border-l border-border">
											{#each contract.events as event (event.id)}
												<li class="relative pb-5 pl-5 last:pb-0">
													<span
														class="absolute top-1.5 -left-[5px] size-2 rounded-full {event.kind ===
														'EXITED'
															? 'bg-muted-foreground'
															: event.kind === 'HIRED'
																? 'bg-primary'
																: 'bg-brand'}"
													></span>
													<Stack gap="xs">
														<Inline align="baseline" gap="sm">
															<span class="text-sm font-medium">
																{t(EVENT_LABEL_KEYS[event.kind])}
															</span>
															<span class="text-meta tabular-nums">
																{formatCalendarDate(event.dateKey)}
															</span>
														</Inline>
														<span class="text-sm">
															{event.detail ?? t('component.timeline_no_terms')}
														</span>
													</Stack>
												</li>
											{/each}
										</ol>
									</Stack>
								{/each}
							</Stack>
						{/each}
					</Stack>
				</FormSection>
			{/if}
		</Stack>
	{/if}
{/snippet}

{#snippet statutoryFacts()}
	<CollectionTable
		{client}
		collection="employment_statutory_facts"
		view="employees:statutory-facts"
		title={t('component.statutory_registrations')}
		description={t('component.statutory_registrations_description')}
		query={{
			where:
				record == null
					? { id: { in: [] } }
					: // Facts name the person directly; every row on this tab is this person.
						{ employee_id: { eq: record.id } },
			orderBy: { created_at: 'desc' }
		}}
	>
		{#snippet columns({ Column: TableColumn })}
			<TableColumn
				name="statutory_contribution_id"
				label={t('component.contribution')}
				card="title"
			/>
			<TableColumn
				name="status"
				label={t('component.registration')}
				renderer={FormattedValueRenderer}
				rendererProps={{ format: ({ value }) => formatStatutoryFactStatus(value, t) }}
			/>
			<TableColumn name="effective_range" label={t('component.effective')} />
		{/snippet}
	</CollectionTable>
{/snippet}

{#snippet faceIdentity()}
	{#if record}
		<Stack gap="sm">
			{#if photoHref !== null}
				<img class="w-40 rounded-lg" src={photoHref} alt={t('face.enrolled_photo')} />
			{:else}
				<p class="text-sm text-muted-foreground">{t('face.no_photo')}</p>
			{/if}
			<p class="text-sm">
				{t(FACE_STATUS_KEYS[displayFaceStatus])}
				{#if record.face_match_count > 0}
					· {t('face.matches', { count: record.face_match_count })}
				{/if}
			</p>
			<div>
				<Button
					variant="secondary"
					data-face-enroll-action
					onclick={() => {
						enrollOpen = true;
					}}
				>
					<Icon icon="lucide:scan-face" class="size-4" />
					{displayFaceStatus === 'NONE' ? t('face.enroll') : t('face.re_enroll')}
				</Button>
			</div>
		</Stack>
		<Dialog.Root bind:open={enrollOpen}>
			<Dialog.Content class="max-w-2xl">
				<Dialog.Header>
					<Dialog.Title>{t('face.title')}</Dialog.Title>
					<Dialog.Description>{t('face.description', { name: record.name })}</Dialog.Description>
				</Dialog.Header>
				{#if enrollOpen}
					<FaceEnrollFlow
						{record}
						onsaved={(previewUrl) => {
							justSavedUrl = previewUrl;
						}}
						onclose={() => {
							enrollOpen = false;
						}}
					/>
				{/if}
			</Dialog.Content>
		</Dialog.Root>
	{/if}
{/snippet}

<!-- Tab content must be snippets (TabConfig.content); the shell always renders tabs so no snippet is ever render-called elsewhere. -->
<RecordShell
	{subtitle}
	tabs={[
		{ name: 'person', label: t('component.person'), icon: 'lucide:user', content: person },
		...(record
			? [
					{
						name: 'employments',
						label: t('component.employments'),
						icon: 'lucide:briefcase',
						content: engagements
					},
					{
						name: 'statutory-facts',
						label: t('component.statutory_facts'),
						icon: 'lucide:id-card',
						content: statutoryFacts
					},
					{
						name: 'face',
						label: t('face.tab'),
						icon: 'lucide:scan-face',
						content: faceIdentity
					}
				]
			: [])
	] satisfies TabConfig[]}
/>
