<script lang="ts">
	import { bolt } from '$bolt';
	import { Effect, Schema } from 'effect';
	import { fork } from '@norbital-ai/ui/effect';
	import {
		Button,
		Form,
		notifyOutcome,
		RecordShell,
		Table,
		Tabs,
		toast,
		type RecordView
	} from '@norbital-ai/ui';
	import { downloadSalaryListing } from '../../../lib/export_format_configuration/salary_listing_export.js';
	import { PayslipBreakdown } from '../../../lib/payroll_engine/payslip_breakdown.js';
	let { view }: { view: RecordView<'payroll_run'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	let downloading = $state(false);
	let paying = $state(false);
	const slips = $derived(
		record === null
			? null
			: bolt.query({
					payslip: {
						where: { payroll_run_id: { eq: record.id } },
						fields: [
							'employment_id',
							'gross_earnings',
							'total_deductions',
							'net_pay',
							'employer_cost',
							'breakdown'
						],
						limit: 10000
					}
				})
	);
	const employmentIds = $derived([
		...new Set((slips?.current?.payslip.rows ?? []).map((row) => row.employment_id))
	]);
	const contracts = $derived(
		employmentIds.length === 0
			? null
			: bolt.query({
					employee_contract: {
						where: { id: { in: employmentIds } },
						fields: ['employee_number', 'employee_name'],
						limit: 10000
					}
				})
	);
	const context = $derived(
		record === null
			? null
			: bolt.query({
					entity: { where: { id: { eq: record.entity_id } }, fields: ['name'], limit: 1 },
					jurisdiction_settings: {
						where: { id: { eq: record.settings_id } },
						fields: ['currency'],
						limit: 1
					}
				})
	);
	const numeric = (value: unknown): number => {
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value);
		if (value !== null && typeof value === 'object') {
			const decimal = Reflect.get(value, '$dec');
			if (typeof decimal === 'string' && Number.isFinite(Number(decimal))) return Number(decimal);
			const text = String(value);
			if (text !== '[object Object]' && Number.isFinite(Number(text))) return Number(text);
		}
		return 0;
	};
	const markPaid = () => {
		if (record === null) return;
		paying = true;
		fork(
			bolt.act('payroll_run.update', [{ target: record.id, set: { state: 'PAID' } }]).pipe(
				Effect.tap((outcome) => Effect.sync(() => notifyOutcome(bolt, outcome))),
				Effect.catch((error) =>
					Effect.sync(() =>
						toast.error(error instanceof Error ? error.message : bolt.t('component.error'))
					)
				),
				Effect.ensuring(Effect.sync(() => (paying = false)))
			)
		);
	};
	const download = async () => {
		if (record === null || slips?.current == null || contracts?.current == null) return;
		downloading = true;
		try {
			const byId = new Map(
				contracts.current.employee_contract.rows.map((row) => [String(row.id), row])
			);
			const rows = slips.current.payslip.rows.flatMap((slip) => {
				const contract = byId.get(String(slip.employment_id));
				if (contract === undefined) return [];
				try {
					return [
						{
							employee_number: String(contract.employee_number),
							employee_name: String(contract.employee_name),
							breakdown: Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown),
							gross_earnings: numeric(slip.gross_earnings),
							total_deductions: numeric(slip.total_deductions),
							net_pay: numeric(slip.net_pay),
							employer_cost: numeric(slip.employer_cost)
						}
					];
				} catch {
					return [];
				}
			});
			await downloadSalaryListing({
				company: String(context?.current?.entity.rows[0]?.name ?? ''),
				currency: String(context?.current?.jurisdiction_settings.rows[0]?.currency ?? ''),
				period: String(record.period ?? ''),
				runKind: String(record.kind ?? 'ON_CYCLE'),
				payDate:
					record.state === 'PAID'
						? new Date(String(record.updated_at)).toLocaleDateString('en-CA')
						: '',
				runReference: String(record.run_number ?? record.id),
				rows
			});
		} finally {
			downloading = false;
		}
	};
</script>

{#snippet summary()}{#if record !== null}<div class="mb-2 flex justify-end gap-2">
			{#if record.state === 'UNPAID'}<Button disabled={paying} onclick={markPaid}
					>{bolt.t('app.payroll.mark_paid')}</Button
				>{/if}
			<Button
				variant="secondary"
				disabled={downloading ||
					slips?.current == null ||
					contracts?.current == null ||
					context?.current == null}
				onclick={download}>Export salary listing</Button
			>
		</div>{/if}<Form
		of="payroll_run"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	/>{/snippet}
{#snippet payslips()}{#if record}<Table
			of="payslip"
			key="run-payslips"
			where={{ payroll_run_id: { eq: record.id } }}
			toolbar={{ new: false, delete: false, title: bolt.t('v2.payslips') }}
			columns={[
				'employee_id',
				'employment_id',
				'basic_earnings',
				'gross_earnings',
				'net_pay',
				'total_deductions',
				'employer_cost'
			]}
		/>{/if}{/snippet}
<RecordShell
	of="payroll_run"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record === null}{@render summary()}{:else}<Tabs
			tabs={[
				{ name: 'payslips', title: bolt.t('v2.payslips'), body: payslips },
				{ name: 'summary', title: bolt.t('v2.run_details'), body: summary }
			]}
		/>{/if}
</RecordShell>
