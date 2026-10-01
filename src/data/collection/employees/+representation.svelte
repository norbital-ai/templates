<script lang="ts">
	import { t, type MessageKey } from '../../../lib/ui/t.js';
	import { everyField } from '../../../lib/every-field.js';
	/**
	 * One person's whole file: who they are, the engagements they hold (a timeline per entity, each contract opening its
	 * own record, and the hire), their events family by family scoped to their contracts and the entity's pay period,
	 * where they stand with each statutory scheme, and their kiosk face. They are all facts about one human being, so
	 * they are read from that human being's record.
	 */
	import { bolt } from '$bolt';
	import Icon from '@iconify/svelte';
	import { setContext } from 'svelte';
	import { Field, Form } from '@norbital-ai/ui';
	import { Column, Grid, Imposter, Inline, Stack } from '@norbital-ai/ui/layout';
	import { Button, Tabs } from '@norbital-ai/ui';
	import FlowDialog from '../../../lib/ui/FlowDialog.svelte';
	import { RecordShell, Table, openRecord, type RecordView } from '@norbital-ai/ui';
	import { coversDate } from '../../../lib/payroll/run/effective.js';
	import { leavePeriodWhere } from '../../../lib/leave/activity-fields.js';
	import { todayKey } from '../../../lib/ui/calendar.js';
	import HireForm from '../../../lib/ui/contract/hire-form.svelte';
	import StatutoryFacts from '../../../lib/ui/contract/statutory-facts.svelte';
	import {
		createValues,
		HR_CREATE_SCOPE,
		type HrCreateScope
	} from '../../../lib/ui/create-scope.js';
	import { formatCalendarDate } from '../../../lib/ui/display-formatters.js';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import MonthPeriodPicker from '../../../lib/ui/month-period-picker.svelte';
	import { createPayPeriodScope } from '../../../lib/ui/pay-period-scope.svelte.js';
	import EmploymentMonth from '../../../lib/ui/roster/employment-month.svelte';
	import FaceEnrollFlow from './face-enroll-flow.svelte';
	import CodeSelect from '../../../lib/ui/code-select.svelte';
	import { CODED_FIELDS } from '../../../lib/coded-fields.js';

	let { view }: { view: RecordView<'employees'> } = $props();
	const today = todayKey();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const personId = $derived(record?.id ?? null);

	const employmentRows = liveRows(() =>
		personId == null
			? null
			: bolt.read('employments', {
					select: everyField('employments'),
					where: { employee_id: { eq: personId }, approval_id: { isNull: true } },
					orderBy: { employee_number: 'asc' },
					all: true
				})
	);
	const employments = $derived(employmentRows.current ?? []);
	const employmentIds = $derived(employments.map((employment) => employment.id));
	/** The contract in force today, which is the one a month calendar is drawn for. */
	const activeEmployment = $derived(
		employments.find((employment) => coversDate(employment.effective_range, today))
	);
	/** A person with one contract has it prefilled on the forms this record opens. */
	const scopedEmployment = $derived(employments.length === 1 ? employments[0] : undefined);
	/** The entity whose pay grammar steps the events: the contract in force today, else the first one held. */
	const scopeCompanyId = $derived(
		activeEmployment?.company_id ?? employments[0]?.company_id ?? null
	);
	const companyRows = liveRows(() =>
		employmentIds.length === 0
			? null
			: bolt.read('companies', {
					where: { employments: { some: { id: { in: employmentIds } } } },
					select: { name: true, settings_code: true, pay_frequency: true, pay_cutoff_day: true },
					all: true
				})
	);
	const scopeCompany = $derived(
		companyRows.current?.find((company) => company.id === scopeCompanyId)
	);
	/** The payroll cycle the events are filtered by, in the entity's own grammar. */
	const pay = createPayPeriodScope(() => scopeCompany);
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		employmentId: () => scopedEmployment?.id,
		employeeId: () => personId ?? undefined,
		companyId: () => scopedEmployment?.company_id,
		settingsCode: () => scopeCompany?.settings_code
	});
	const termsRows = liveRows(() =>
		employmentIds.length === 0
			? null
			: bolt.read('employment_terms', {
					where: { employment_id: { in: employmentIds }, approval_id: { isNull: true } },
					select: { employment_id: true, effective_range: true, summary: true },
					all: true
				})
	);

	type TimelineEvent = {
		readonly id: string;
		readonly day: string;
		readonly kind: 'HIRED' | 'CHANGED' | 'EXITED';
		readonly detail: string | null;
	};
	/**
	 * One rail per legal entity, newest event first: joined, every change of terms that followed, and the exit when there
	 * is one. A promotion, a new contract or a return all read as one line — the terms summary states what changed.
	 */
	const timeline = $derived.by(() => {
		const byCompany = new Map<
			string,
			{ id: string; number: string; contract: number; active: boolean; events: TimelineEvent[] }[]
		>();
		for (const employment of employments) {
			const hired = employment.effective_range.from;
			const exited = employment.effective_range.to;
			const terms = (termsRows.current ?? [])
				.filter((term) => term.employment_id === employment.id)
				.map((term) => ({ day: term.effective_range.from, summary: term.summary || null }))
				.toSorted((left, right) => left.day.localeCompare(right.day));
			const events: TimelineEvent[] = [
				{
					id: `${employment.id}:hired`,
					day: hired,
					kind: 'HIRED',
					detail: terms[0]?.summary ?? null
				}
			];
			for (const [index, term] of terms.entries())
				if (index > 0 && term.day > hired)
					events.push({
						id: `${employment.id}:term:${index}`,
						day: term.day,
						kind: 'CHANGED',
						detail: term.summary
					});
			if (exited != null)
				events.push({ id: `${employment.id}:exit`, day: exited, kind: 'EXITED', detail: null });
			const rail = byCompany.get(employment.company_id) ?? [];
			rail.push({
				id: employment.id,
				number: employment.employee_number,
				contract: employment.contract_number ?? 1,
				active: exited == null,
				events: events.toSorted((left, right) => right.day.localeCompare(left.day))
			});
			byCompany.set(employment.company_id, rail);
		}
		return [...byCompany]
			.map(([companyId, contracts]) => ({
				companyId,
				companyName:
					companyRows.current?.find((company) => company.id === companyId)?.name ?? companyId,
				contracts: contracts.toSorted(
					(left, right) => left.number.localeCompare(right.number) || left.contract - right.contract
				)
			}))
			.toSorted((left, right) => left.companyName.localeCompare(right.companyName));
	});
	const EVENT_LABEL_KEYS = {
		HIRED: 'component.timeline_hired',
		CHANGED: 'component.timeline_changed',
		EXITED: 'component.timeline_exited'
	} as const;

	let hireOpen = $state(false);
	/** Face enrolment opens from here and nowhere else: the kiosk on the wall only clocks. */
	let enrollOpen = $state(false);
	let justSavedUrl = $state<string | null>(null);
	const photo = $derived(record?.face_photo);
	const photoHref = $derived(justSavedUrl ?? (photo == null ? null : bolt.fileUrl(photo)));
	const faceStatus = $derived(
		justSavedUrl !== null && record?.face_enrollment_status === 'NONE'
			? 'APPROVED'
			: String(record?.face_enrollment_status ?? 'NONE')
	);
	const FACE_STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
		NONE: 'face.status_none',
		PENDING: 'face.status_pending',
		APPROVED: 'face.status_approved',
		SUSPENDED: 'face.status_suspended'
	};
	const matchCount = $derived(record?.face_match_count ?? 0);
	const byContract = $derived({ employment_id: { in: employmentIds } });
</script>

{#snippet coded(name: keyof typeof CODED_FIELDS.employees, label: string)}
	<!-- A code of the lineage's table: the scope contract's, the one whose run reads it. -->
	<Field {name} {label} help={t('component.race_religion_hint')}>
		{#snippet editor(field)}
			<CodeSelect
				settingsCode={scopeCompany?.settings_code}
				table={CODED_FIELDS.employees[name]}
				value={typeof field.value === 'string' ? field.value : null}
				disabled={field.disabled}
				onChange={(next) => field.onChange(next as never)}
			/>
		{/snippet}
	</Field>
{/snippet}

{#snippet person()}
	<Form
		of="employees"
		mode={view.mode}
		{...record == null ? { values: createValues(view) } : { id: record.id, record }}
		submit={record ? t('component.save_person') : t('component.add_person')}
	>
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
					<Column span="all"><Field name="location" address="address" /></Column>
				</Grid>
			</FormSection>
			<FormSection title={t('component.standing')} hint={t('component.standing_hint')}>
				<Grid gap="sm" minimum="compact">
					<Field name="marital_status" label={t('component.marital_status')} />
					<Field name="solo_parent" label={t('component.solo_parent')} />
					<Field name="disabled" label={t('component.disabled')} />
					<Field name="receiving_pension" label={t('component.receiving_pension')} />
					{@render coded('race', t('component.race'))}
					{@render coded('religion', t('component.religion'))}
				</Grid>
			</FormSection>
			<FormSection title={t('component.family_section')} hint={t('component.family_section_hint')}>
				<Grid gap="sm" minimum="compact">
					<Field name="spouse_status" label={t('component.spouse')} />
					<Field name="dependents_count" label={t('component.dependents')} />
					<Column span="all"><Field name="children" label={t('employee_children.title')} /></Column>
				</Grid>
			</FormSection>
		</Stack>
	</Form>
{/snippet}

{#snippet hireButton()}
	<Button variant="outline" size="sm" onclick={() => (hireOpen = true)}>
		<Icon icon="lucide:briefcase" class="size-4" />
		{t('component.hire')}
	</Button>
{/snippet}

{#snippet engagements()}
	<Stack gap="lg">
		<!-- The hire lives here, on the person: a contract is theirs before it is an entity's. -->
		<FlowDialog
			bind:open={hireOpen}
			title={t('component.hire_title', { name: String(record?.name ?? '') })}
			description={t('component.hire_description')}
		>
			<HireForm askCompany onDone={() => (hireOpen = false)} />
		</FlowDialog>
		{#if timeline.length > 0}
			<FormSection first title={t('component.timeline_title')} hint={t('component.timeline_hint')}>
				{#snippet actions()}{@render hireButton()}{/snippet}
				<Stack gap="lg">
					{#each timeline as column (column.companyId)}
						<Stack gap="sm">
							<h4 class="text-sm font-semibold">{column.companyName}</h4>
							{#each column.contracts as contract (contract.id)}
								<Stack gap="xs">
									<Inline align="baseline" gap="sm">
										<button
											type="button"
											class="text-sm font-medium text-primary underline-offset-4 hover:underline"
											onclick={() => openRecord('employments', contract.id)}
										>
											{contract.number} · #{contract.contract}
										</button>
										<span class="text-meta">
											{contract.active
												? t('component.timeline_active')
												: t('component.timeline_last_ended', {
														date: formatCalendarDate(
															contract.events.find((event) => event.kind === 'EXITED')?.day ?? ''
														)
													})}
										</span>
									</Inline>
									<ol class="ml-1 border-l border-border">
										{#each contract.events as event (event.id)}
											<li class="relative pb-5 pl-5 last:pb-0">
												<Imposter
													as="span"
													placement="top-start"
													layer="under"
													class="top-1.5 -left-[5px] size-2 rounded-full {event.kind === 'EXITED'
														? 'bg-muted-foreground'
														: event.kind === 'HIRED'
															? 'bg-primary'
															: 'bg-brand'}"
												/>
												<Stack gap="xs">
													<Inline align="baseline" gap="sm">
														<span class="text-sm font-medium"
															>{t(EVENT_LABEL_KEYS[event.kind])}</span
														>
														<span class="text-meta tabular-nums"
															>{formatCalendarDate(event.day)}</span
														>
													</Inline>
													<span class="text-sm"
														>{event.detail ?? t('component.timeline_no_terms')}</span
													>
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
		{:else}
			<Inline justify="end">{@render hireButton()}</Inline>
		{/if}
	</Stack>
{/snippet}

<!--
	The person's events, family by family, as the Events pages and the employee's own app show them, every row scoped to
	this person's contracts. Work is the same month board the employee's own app draws, read-only here.
-->
{#snippet workEvents()}
	<EmploymentMonth employmentId={activeEmployment?.id ?? null} />
{/snippet}
{#snippet leaveEvents()}
	{#if pay.window != null}
		<Table
			of="leave_entries"
			key="employee-leave"
			toolbar={{ title: t('family.leave') }}
			where={{ ...byContract, ...leavePeriodWhere(pay.window) }}
			orderBy={{ effective_on: 'desc' }}
			columns={[
				'catalogue_id',
				{ field: 'summary', label: t('leave.activity') },
				'employment_id',
				'reference',
				'days',
				'hours',
				'encash_days',
				'encash_hours'
			]}
		/>
	{/if}
{/snippet}
<!-- A pay-request family's period: its entries pinned to it outright, or unpinned and dated inside its window. -->
{#snippet claimEvents()}
	{#if pay.window != null}
		<Table
			of="claim_requests"
			key="employee-claims"
			toolbar={{ title: t('family.claim') }}
			where={{
				...byContract,
				or: [
					{ pay_period: { eq: pay.period } },
					{
						pay_period: { isNull: true },
						incurred_on: { gte: pay.window.start, lte: pay.window.end }
					}
				]
			}}
			orderBy={{ incurred_on: 'desc' }}
			columns={[
				'catalogue_id',
				'employment_id',
				'amount',
				'as_adjustment_entry',
				'incurred_on',
				'evidence_file'
			]}
		/>
	{/if}
{/snippet}
{#snippet adhocEvents()}
	{#if pay.window != null}
		<Table
			of="adhoc_requests"
			key="employee-adhoc"
			toolbar={{ title: t('family.adhoc') }}
			where={{
				...byContract,
				or: [
					{ pay_period: { eq: pay.period } },
					{
						pay_period: { isNull: true },
						event_date: { gte: pay.window.start, lte: pay.window.end }
					}
				]
			}}
			orderBy={{ event_date: 'desc' }}
			columns={['catalogue_id', 'employment_id', 'amount', 'as_adjustment_entry', 'event_date']}
		/>
	{/if}
{/snippet}
{#snippet loanEvents()}
	<Table
		of="loans"
		key="employee-loans"
		toolbar={{ title: t('family.loan') }}
		where={byContract}
		orderBy={{ effective_from: 'desc' }}
		columns={['reference', 'employment_id', 'principal', 'effective_range']}
	/>
{/snippet}
{#snippet events()}
	<Stack gap="md">
		<MonthPeriodPicker
			month={pay.period}
			halves={pay.halves}
			weeks={pay.weeks}
			ariaLabel={t('app.events.pay_period')}
			onMonthChange={(next) => pay.select(next)}
		/>
		<Tabs
			tabs={[
				{ name: 'work', title: t('family.work'), icon: 'lucide:calendar-clock', body: workEvents },
				{
					name: 'leave',
					title: t('family.leave'),
					icon: 'lucide:calendar-check',
					body: leaveEvents
				},
				{ name: 'claim', title: t('family.claim'), icon: 'lucide:receipt-text', body: claimEvents },
				{ name: 'adhoc', title: t('family.adhoc'), icon: 'lucide:hand-coins', body: adhocEvents },
				{ name: 'loan', title: t('family.loan'), icon: 'lucide:landmark', body: loanEvents }
			]}
		/>
	</Stack>
{/snippet}

{#snippet statutoryFacts()}
	<StatutoryFacts />
{/snippet}

{#snippet faceIdentity()}
	{#if record}
		{#if photoHref === null && faceStatus === 'NONE'}
			<!-- No face yet is a first-run state: what the tab is for, what to do, and the one action that does it. -->
			<Stack
				gap="md"
				align="start"
				class="max-w-lg rounded-lg border border-dashed border-border p-6"
			>
				<span class="rounded-full bg-muted p-3 text-muted-foreground"
					><Icon icon="lucide:scan-face" class="size-6" /></span
				>
				<Stack gap="xs">
					<h3 class="text-heading">{t('face.status_none')}</h3>
					<p class="max-w-md text-sm text-muted-foreground">{t('face.empty_description')}</p>
				</Stack>
				<Button data-face-enroll-action onclick={() => (enrollOpen = true)}>
					<Icon icon="lucide:scan-face" class="size-4" />
					{t('face.enroll')}
				</Button>
			</Stack>
		{:else}
			<Stack gap="sm">
				{#if photoHref !== null}
					<img class="w-40 rounded-lg" src={photoHref} alt={t('face.enrolled_photo')} />
				{:else}
					<p class="text-sm text-muted-foreground">{t('face.no_photo')}</p>
				{/if}
				<p class="text-sm">
					{t(FACE_STATUS_KEYS[faceStatus] ?? 'face.status_none')}
					{#if matchCount > 0}· {t('face.matches', { count: matchCount })}{/if}
				</p>
				<div>
					<Button variant="secondary" data-face-enroll-action onclick={() => (enrollOpen = true)}>
						<Icon icon="lucide:scan-face" class="size-4" />
						{faceStatus === 'NONE' ? t('face.enroll') : t('face.re_enroll')}
					</Button>
				</div>
			</Stack>
		{/if}
		<FlowDialog
			bind:open={enrollOpen}
			title={t('face.title')}
			description={t('face.description', { name: String(record.name ?? '') })}
		>
			<FaceEnrollFlow
				record={{
					id: record.id,
					face_enrollment_status: record.face_enrollment_status
				}}
				onsaved={(previewUrl) => (justSavedUrl = previewUrl)}
				onclose={() => (enrollOpen = false)}
			/>
		</FlowDialog>
	{/if}
{/snippet}

<RecordShell
	of="employees"
	mode={view.mode}
	{...record == null ? {} : { id: record.id }}
	{...record == null
		? {}
		: {
				subtitle: `${record.email ?? t('component.no_email_recorded')} · ${record.nationality ?? t('component.nationality_not_recorded')}`
			}}
	tabs={record == null
		? []
		: [
				{
					name: 'employments',
					title: t('component.employments'),
					icon: 'lucide:briefcase',
					body: engagements
				},
				{ name: 'events', title: t('component.events'), icon: 'lucide:inbox', body: events },
				{
					name: 'statutory-facts',
					title: t('component.statutory_facts'),
					icon: 'lucide:id-card',
					body: statutoryFacts
				},
				{ name: 'face', title: t('face.tab'), icon: 'lucide:scan-face', body: faceIdentity }
			]}
>
	{@render person()}
</RecordShell>
