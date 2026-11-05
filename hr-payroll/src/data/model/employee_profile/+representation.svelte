<script lang="ts">
	import { bolt } from '$bolt';
	import { Effect } from 'effect';
	import { fork } from '@norbital-ai/ui/effect';
	import {
		DescriptionHint,
		EmptyState,
		Form,
		Field,
		Icon,
		RecordShell,
		Table,
		Tabs,
		Button,
		Sheet,
		toast,
		notifyOutcome,
		openRecord,
		type RecordView
	} from '@norbital-ai/ui';
	import { Stack, Cluster } from '@norbital-ai/ui/layout';
	import FaceEnrollFlow from '../../../lib/ui/person/face_enroll_flow.svelte';
	import VersionTimeline from '../../../lib/ui/components/version_timeline.svelte';
	import { formatTermsDates } from '../../../lib/ui/format/display_formatters.js';
	import { employeeReference } from '../../../lib/export_format_configuration/export_format.js';
	import { listedKindNames } from '../../../lib/ui/format/listed_kind_names.svelte.js';

	let { view }: { view: RecordView<'employee_profile'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const t = bolt.t;
	const caseName = listedKindNames('case_kinds');
	let enrolling = $state(false),
		saving = $state(false);
	function status(value: 'APPROVED' | 'NONE' | 'SUSPENDED') {
		if (record === null || saving) return;
		const id = record.id;
		saving = true;
		fork(
			bolt
				.act('employee_profile.update', [{ target: id, set: { face_enrollment_status: value } }])
				.pipe(
					Effect.tap((outcome) => Effect.sync(() => notifyOutcome(bolt, outcome))),
					Effect.catch((error) =>
						Effect.sync(() =>
							toast.error(error instanceof Error ? error.message : bolt.t('component.error'))
						)
					),
					Effect.ensuring(Effect.sync(() => (saving = false)))
				)
		);
	}
	const contracts = $derived.by(() =>
		record == null
			? null
			: bolt.query({
					employee_contract: {
						where: { employee_id: { eq: record.id } },
						fields: [
							'employee_number',
							'effective_range',
							'entity_id',
							'terms',
							'engagement',
							'status'
						]
					},
					'employee_contract.entity_id': { fields: ['name'] }
				})
	);
	const contractIds = $derived(
		(contracts?.current?.employee_contract.rows ?? []).map((row) => row.id)
	);
	const entityIds = $derived([
		...new Set(
			(contracts?.current?.employee_contract.rows ?? []).flatMap((row) =>
				row.entity_id == null ? [] : [row.entity_id.id]
			)
		)
	]);
	const ordered = $derived(
		(contracts?.current?.employee_contract.rows ?? [])
			.flatMap((row) => {
				const entity = row.entity_id;
				if (entity == null) return [];
				return [
					{
						id: row.id,
						entity: entity.name,
						number: row.employee_number,
						period: formatTermsDates(row, t),
						from: String(row.effective_range.from),
						status:
							row.status === 'VOID'
								? t('contract.voided')
								: row.status === 'DRAFT'
									? t('contract.draft')
									: t('contract.sealed')
					}
				];
			})
			.toSorted((left, right) => right.from.localeCompare(left.from))
	);
</script>

{#snippet general()}<Form
		of="employee_profile"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		onOutcome={(outcome) => {
			if (outcome.kind !== 'committed' || record) return;
			const created = outcome.records.find((row) => row.model === 'employee_profile');
			if (created) openRecord('employee_profile', created.id);
		}}
		>{#snippet children()}<Stack gap="md"
				>{#each ['name', 'email', 'phone', 'address', 'location', 'source_reference'] as name (name)}<Field
						{name}
					/>{/each}</Stack
			>{/snippet}</Form
	>{/snippet}
{#snippet contractsTab()}{#if record}<Cluster justify="between" class="mb-4"
			><h3 class="text-heading">{t('section.employment_history')}</h3>
			<Button
				size="icon"
				variant="outline"
				aria-label={t('contract.new')}
				title={t('contract.new')}
				onclick={() => openRecord('employee_contract', 'new')}
				><Icon name="lucide:plus" class="size-4" /></Button
			></Cluster
		>{#if contracts?.loading}<p class="text-meta">
				{t('component.loading')}
			</p>{:else if ordered.length === 0}<EmptyState
				title={t('section.employment_history')}
			/>{:else}<VersionTimeline
				label={t('section.employment_history')}
				items={ordered.map((row) => ({
					id: row.id,
					period: row.period,
					status: row.status,
					detail: `${row.entity} · ${employeeReference(row.number, row.entity)}`
				}))}
				onOpen={(id) => openRecord('employee_contract', id)}
			/>{/if}{/if}{/snippet}
{#snippet loansTab()}{#if record}{#if contractIds.length === 0}<EmptyState
				title={t('models.loan_catalog_entry.label')}
			/>{:else}<Table
				of="loan_catalog_entry"
				key="person-loans"
				where={{ employment_id: { in: contractIds } }}
				toolbar={{ new: false, title: t('models.loan_catalog_entry.label') }}
				columns={['catalog_id', 'quantity', 'repayment_period']}
			/>{/if}{/if}{/snippet}
{#snippet caseCell({ value }: { value: string | undefined })}<span>{caseName(value ?? '')}</span
	>{/snippet}
{#snippet casesTab()}{#if record}{#if entityIds.length === 0}<EmptyState
				title={t('app.cases.title')}
			/>{:else}<Stack gap="sm"
				><DescriptionHint text={t('v2.cases_entity_scope')} /><Table
					of="workplace_case_catalog_entry"
					key="person-workplace-cases"
					where={{ entity_id: { in: entityIds } }}
					orderBy={{ opened_on: 'desc' }}
					toolbar={{ new: false, title: t('app.cases.title') }}
					columns={[{ field: 'kind', cell: caseCell }, 'entity_id', 'opened_on', 'closed_on']}
				/></Stack
			>{/if}{/if}{/snippet}
{#snippet leavesTab()}{#if record}{#if contractIds.length === 0}<EmptyState
				title={t('app.leave.title')}
			/>{:else}<Table
				of="leave_catalog_entry"
				key="person-leave"
				where={{ employment_id: { in: contractIds } }}
				toolbar={{ new: false, title: t('app.leave.title') }}
				columns={['catalog_id', 'days', 'payroll_run_id']}
			/>{/if}{/if}{/snippet}
{#snippet finances()}{#if record}<Stack gap="lg"
			><Table
				of="employee_balance"
				key="person-balances"
				where={{ employee_id: { eq: record.id } }}
				toolbar={{ new: false, delete: false, title: bolt.t('v2.balances') }}
				columns={['account']}
			/>
		</Stack>{/if}{/snippet}
{#snippet face()}{#if record}{#if (record.face_enrollment_status ?? 'NONE') === 'NONE'}<Stack
				gap="sm"
				align="center"
				class="rounded-lg border border-dashed px-6 py-12 text-center"
			>
				<span class="grid size-16 place-items-center rounded-full bg-muted">
					<Icon name="lucide:scan-face" class="size-8 text-muted-foreground" />
				</span>
				<h3 class="text-sm font-medium">{bolt.t('face.empty_title')}</h3>
				<p class="max-w-sm text-sm text-muted-foreground">{bolt.t('face.empty_hint')}</p>
				<Button onclick={() => (enrolling = true)}>{bolt.t('face.enroll')}</Button>
			</Stack>
		{:else}<Stack gap="md"
				><p>{bolt.t('v2.face_status')}: {record.face_enrollment_status}</p>
				<Cluster gap="sm"
					><Button
						disabled={saving ||
							record.face_enrollment_status === 'PENDING' ||
							record.face_enrollment_status === 'SUSPENDED'}
						onclick={() => (enrolling = true)}>{bolt.t('face.enroll')}</Button
					>{#if record.face_enrollment_status === 'PENDING'}<Button
							disabled={saving}
							onclick={() => status('APPROVED')}>{bolt.t('v2.approve_face')}</Button
						><Button variant="secondary" disabled={saving} onclick={() => status('NONE')}
							>{bolt.t('v2.reject_face')}</Button
						>{:else if record.face_enrollment_status === 'APPROVED'}<Button
							variant="secondary"
							disabled={saving}
							onclick={() => status('SUSPENDED')}>{bolt.t('v2.suspend_face')}</Button
						>{:else if record.face_enrollment_status === 'SUSPENDED'}<Button
							disabled={saving}
							onclick={() => status('APPROVED')}>{bolt.t('v2.reinstate_face')}</Button
						>{/if}</Cluster
				></Stack
			>{/if}{/if}{/snippet}
{#snippet payslips()}{#if record}<Stack gap="lg"
			><Table
				of="payslip"
				key="person-payslips"
				where={{ employee_id: { eq: record.id } }}
				toolbar={{ new: false, delete: false, title: bolt.t('v2.payslips') }}
				columns={['payroll_run_id', 'gross_earnings', 'net_pay']}
			/>
		</Stack>{/if}{/snippet}
<RecordShell
	of="employee_profile"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record === null}{@render general()}{:else}<Tabs
			tabs={[
				{ name: 'general', title: bolt.t('v2.profile'), body: general },
				{ name: 'contracts', title: bolt.t('section.employment_history'), body: contractsTab },
				{ name: 'loans', title: bolt.t('models.loan_catalog_entry.label'), body: loansTab },
				{ name: 'cases', title: bolt.t('app.cases.title'), body: casesTab },
				{ name: 'leave', title: bolt.t('app.leave.title'), body: leavesTab },
				{ name: 'finances', title: bolt.t('v2.balances'), body: finances },
				{ name: 'face', title: bolt.t('v2.face'), body: face },
				{ name: 'payslips', title: bolt.t('v2.payslips'), body: payslips }
			]}
		/>{/if}
</RecordShell>
{#if enrolling && record}<Sheet
		open
		onOpenChange={(open) => !open && (enrolling = false)}
		title={bolt.t('face.enroll')}
		><FaceEnrollFlow
			{record}
			onsaved={() => (enrolling = false)}
			onclose={() => (enrolling = false)}
		/></Sheet
	>{/if}
