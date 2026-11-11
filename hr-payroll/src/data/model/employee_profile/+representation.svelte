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
	import BalanceAdjustment from '../../../lib/ui/person/balance_adjustment.svelte';
	import BalanceLedger from '../../../lib/ui/person/balance_ledger.svelte';
	import FaceEnrollFlow from '../../../lib/ui/person/face_enroll_flow.svelte';
	import VersionTimeline from '../../../lib/ui/components/version_timeline.svelte';
	import { addDays, PlainDate } from '@norbital-ai/std/date';
	import { formatTermsDates } from '../../../lib/ui/format/display_formatters.js';
	import { employeeReference } from '../../../lib/export_format_configuration/export_format.js';
	import { listedKindNames } from '../../../lib/ui/format/listed_kind_names.svelte.js';

	let { view }: { view: RecordView<'employee_profile'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const t = bolt.t;
	const caseName = listedKindNames('case_kinds');
	let enrolling = $state(false),
		adjusting = $state(false),
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
	const balance = $derived(
		record == null
			? null
			: bolt.query({
					employee_balance: {
						where: { employee_id: { eq: record.id } },
						fields: ['account'],
						limit: 1
					}
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
						to: row.effective_range.to == null ? null : String(row.effective_range.to),
						sealed: row.status === 'SEALED',
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
	/** A rehire keeps one profile: the stretch between two sealed contracts shows as a gap in the history. */
	const timeline = $derived(
		ordered.flatMap((row, index) => {
			const item = {
				id: String(row.id),
				period: row.period,
				status: row.status,
				detail: `${row.entity} · ${employeeReference(row.number, row.entity)}`
			};
			const earlier = ordered.slice(index + 1).find((other) => other.sealed);
			if (!row.sealed || earlier === undefined || earlier.to === null) return [item];
			const from = addDays(PlainDate(earlier.to), 1);
			const to = addDays(PlainDate(row.from), -1);
			if (String(from) > String(to)) return [item];
			const days = Math.round((Date.parse(String(to)) - Date.parse(String(from))) / 86_400_000) + 1;
			return [
				item,
				{
					id: `gap:${String(row.id)}`,
					gap: true,
					period: formatTermsDates({ effective_range: { from: String(from), to: String(to) } }, t),
					status: t('contract.gap'),
					detail: t('contract.gap_detail', { days })
				}
			];
		})
	);
</script>

{#snippet general()}<div class="grid max-w-4xl gap-6">
		<Form
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
			>{#snippet children()}
				<div class="grid gap-6">
					<section class="grid gap-3">
						<h3 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							Identity and contact
						</h3>
						<div class="grid gap-x-6 gap-y-4 @md:grid-cols-2">
							{#each ['name', 'email', 'phone', 'location'] as name (name)}<Field {name} />{/each}
						</div>
					</section>
					<section class="grid gap-3">
						<h3 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							Address
						</h3>
						<Field name="address" />
					</section>
					<section class="grid gap-3">
						<h3 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							Documents
						</h3>
						<Field name="documents" />
					</section>
					<section class="grid gap-3">
						<h3 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							Service
						</h3>
						<Field name="cumulative_service" />
					</section>
					{#if record}{@render face()}{/if}
				</div>
			{/snippet}</Form
		>
	</div>{/snippet}
{#snippet historyTab()}{#if record}<Cluster justify="between" class="mb-4"
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
				items={timeline}
				onOpen={(id) => openRecord('employee_contract', id)}
			/>{/if}{/if}{/snippet}
{#snippet changesTab()}{#if record}<Table
			of="contract_change"
			key="person-contract-changes"
			where={{ employee_id: { eq: record.id }, applied_version_id: { isNull: true } }}
			toolbar={{ new: false, title: bolt.t('section.scheduled_changes') }}
			columns={['effective_from', 'field_path', 'old_value', 'new_value', 'notes']}
		/>{/if}{/snippet}
{#snippet contractsTab()}{#if record}<Tabs
			tabs={[
				{
					name: 'history',
					title: t('section.employment_history'),
					icon: 'lucide:history',
					body: historyTab
				},
				{
					name: 'changes',
					title: t('section.scheduled_changes'),
					icon: 'lucide:calendar-clock',
					body: changesTab
				}
			]}
		/>{/if}{/snippet}
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
{#snippet finances()}{#if record}{@const held = balance?.current?.employee_balance.rows[0]}<Stack
			gap="lg"
			><Cluster justify="end"
				><Button variant="outline" disabled={held === undefined} onclick={() => (adjusting = true)}
					><Icon name="lucide:pencil" class="size-4" />{t('balance.adjust')}</Button
				></Cluster
			>{#if held !== undefined}<BalanceLedger
					balanceId={held.id}
					account={held.account}
				/>{/if}</Stack
		>{/if}{/snippet}
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
						? bolt.t('face.empty_title')
						: `${bolt.t('v2.face_status')}: ${faceStatus}`}</span
				>
			</Cluster>
			<Cluster gap="xs">
				<Button
					variant="secondary"
					disabled={saving || faceStatus === 'PENDING' || faceStatus === 'SUSPENDED'}
					onclick={() => (enrolling = true)}
					>{faceStatus === 'NONE' ? bolt.t('face.enroll') : bolt.t('v2.update_face')}</Button
				>
				{#if faceStatus === 'PENDING'}<Button disabled={saving} onclick={() => status('APPROVED')}
						>{bolt.t('v2.approve_face')}</Button
					><Button variant="secondary" disabled={saving} onclick={() => status('NONE')}
						>{bolt.t('v2.reject_face')}</Button
					>{:else if faceStatus === 'APPROVED'}<Button
						variant="secondary"
						disabled={saving}
						onclick={() => status('SUSPENDED')}>{bolt.t('v2.suspend_face')}</Button
					>{:else if faceStatus === 'SUSPENDED'}<Button
						disabled={saving}
						onclick={() => status('APPROVED')}>{bolt.t('v2.reinstate_face')}</Button
					>{/if}
			</Cluster>
		</Cluster>{/if}{/snippet}
<RecordShell
	of="employee_profile"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record === null}{@render general()}{:else}<Tabs
			value="general"
			tabs={[
				{ name: 'general', title: bolt.t('v2.profile'), icon: 'lucide:user-round', body: general },
				{
					name: 'contracts',
					title: bolt.t('section.employment_history'),
					icon: 'lucide:file-signature',
					body: contractsTab
				},
				{
					name: 'loans',
					title: bolt.t('models.loan_catalog_entry.label'),
					icon: 'lucide:banknote',
					body: loansTab
				},
				{
					name: 'cases',
					title: bolt.t('app.cases.title'),
					icon: 'lucide:briefcase-medical',
					body: casesTab
				},
				{ name: 'finances', title: bolt.t('v2.balances'), icon: 'lucide:scale', body: finances }
			]}
		/>{/if}
</RecordShell>
{#if adjusting && record && balance?.current?.employee_balance.rows[0]}<BalanceAdjustment
		employeeId={record.id}
		balanceId={balance.current.employee_balance.rows[0].id}
		onclose={() => (adjusting = false)}
	/>{/if}
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
