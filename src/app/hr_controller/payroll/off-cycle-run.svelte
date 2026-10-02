<script lang="ts">
	/**
	 * A new ad hoc (OFF_CYCLE) run inside one pay cycle. HR picks what it pays — items of the ad hoc and claim
	 * catalogues in force for the company's lineage — then every outstanding, approved entry of those items is listed by
	 * person, all ticked; the ticked ones are the run's `sources`. A person whose salary the run settles ahead of the
	 * cycle's REGULAR run carries the EARLY mark (`settlesSalaryEarly`).
	 */
	import { t } from '../../../lib/ui/t.js';
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { toast } from 'svelte-sonner';
	import { Badge, Button, Checkbox, Combobox, Dialog, EmptyState } from '@norbital-ai/ui';
	import { Cluster, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { EMPLOYMENT_LABEL_SELECT, employmentLabel } from '../../../lib/ui/create-scope.js';
	import { formatCalendarDate, formatNumeric } from '../../../lib/ui/display-formatters.js';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import { inForceSettings } from '../../../lib/ui/settings-scope.js';
	import { todayKey } from '../../../lib/ui/calendar.js';
	import Loading from '../../../lib/ui/Loading.svelte';
	import { decodeNumber } from '../../../lib/wire.js';
	import { settlesSalaryEarly } from '../../../lib/pay-cycles.js';

	let {
		open = $bindable(false),
		companyId,
		settingsCode,
		period,
		cycleRuns,
		cycleSlips
	}: {
		open?: boolean;
		companyId: Id<'companies'>;
		settingsCode: string;
		period: string;
		cycleRuns: Parameters<typeof settlesSalaryEarly>[0];
		cycleSlips: Parameters<typeof settlesSalaryEarly>[1];
	} = $props();

	const inForce = $derived({
		settings_id: { is: inForceSettings(settingsCode, String(todayKey())) }
	} as never);
	const adhocItems = liveRows<{ code: string; name: string | null }>(() =>
		open
			? bolt.read('adhoc_catalogue', {
					where: inForce,
					select: { code: true, name: true },
					all: true
				})
			: null
	);
	const claimItems = liveRows<{ code: string; name: string | null }>(() =>
		open
			? bolt.read('claim_catalogue', {
					where: inForce,
					select: { code: true, name: true },
					all: true
				})
			: null
	);
	type Family = 'adhoc' | 'claim';
	const items = $derived(
		[
			...(adhocItems.current ?? []).map((row) => ({ family: 'adhoc' as Family, ...row })),
			...(claimItems.current ?? []).map((row) => ({ family: 'claim' as Family, ...row }))
		]
			.map((row) => ({ key: `${row.family}:${row.code}`, label: row.name ?? row.code }))
			.toSorted((a, b) => a.label.localeCompare(b.label))
	);

	// outstanding: approved (not held under an approval) and not yet captured by a payslip
	const where = $derived({
		employment_id: { is: { company_id: { eq: companyId } } },
		approval_id: { isNull: true },
		payslip_id: { isNull: true }
	} as const);
	const claims = liveRows(() =>
		open
			? bolt.read('claim_requests', {
					where,
					select: {
						employment_id: { select: EMPLOYMENT_LABEL_SELECT },
						catalogue_id: { select: { name: true, code: true } },
						amount: true,
						incurred_on: true
					},
					all: true
				})
			: null
	);
	const adhoc = liveRows(() =>
		open
			? bolt.read('adhoc_requests', {
					where,
					select: {
						employment_id: { select: EMPLOYMENT_LABEL_SELECT },
						catalogue_id: { select: { name: true, code: true } },
						amount: true,
						event_date: true
					},
					all: true
				})
			: null
	);

	let picked = $state<ReadonlySet<string>>(new Set());
	let selectedPeople = $state<ReadonlySet<string>>(new Set());
	const personOptions = $derived.by(() => {
		const people = new Map<string, string>();
		for (const row of [...(claims.current ?? []), ...(adhoc.current ?? [])])
			people.set(row.employment_id.id, employmentLabel(row.employment_id));
		return [...people]
			.map(([value, label]) => ({ value, label }))
			.toSorted((a, b) => a.label.localeCompare(b.label));
	});
	let unticked = $state<ReadonlySet<string>>(new Set());
	let busy = $state(false);

	type Entry = { id: string; name: string; day: unknown; amount: number };
	/** The picked items' entries by person, people by name. */
	const people = $derived.by(() => {
		const rows = [
			...(claims.current ?? []).map((row) => ({ row, family: 'claim', day: row.incurred_on })),
			...(adhoc.current ?? []).map((row) => ({ row, family: 'adhoc', day: row.event_date }))
		];
		const byPerson = new Map<string, { id: string; name: string; entries: Entry[] }>();
		for (const { row, family, day } of rows) {
			const item = row.catalogue_id as { name?: string | null; code: string };
			if (!picked.has(`${family}:${item.code}`)) continue;
			const employment = row.employment_id;
			if (!selectedPeople.has(employment.id)) continue;
			const person = byPerson.get(employment.id) ?? {
				id: employment.id,
				name: employmentLabel(employment),
				entries: []
			};
			person.entries.push({
				id: row.id,
				name: item.name ?? item.code,
				day,
				amount: decodeNumber(row.amount)
			});
			byPerson.set(employment.id, person);
		}
		return [...byPerson.values()].toSorted((a, b) => a.name.localeCompare(b.name));
	});
	const loading = $derived(
		adhocItems.loading || claimItems.loading || claims.loading || adhoc.loading
	);
	const chosen = $derived(
		people.flatMap((person) => person.entries).filter((entry) => !unticked.has(entry.id))
	);
	const total = $derived(chosen.reduce((sum, entry) => sum + entry.amount, 0));

	const flip = (set: ReadonlySet<string>, ids: readonly string[], on: boolean) => {
		const next = new Set(set);
		for (const id of ids)
			if (on) next.add(id);
			else next.delete(id);
		return next;
	};
	const early = (person: { id: string; entries: Entry[] }) =>
		person.entries.some((entry) => !unticked.has(entry.id)) &&
		settlesSalaryEarly(cycleRuns, cycleSlips, person.id);

	async function create() {
		busy = true;
		const outcome = await bolt.act('payroll_runs.create', {
			company_id: companyId,
			period,
			kind: 'OFF_CYCLE',
			sources: chosen.map((entry) => entry.id)
		});
		busy = false;
		if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
			toast.success(t('app.payroll.adhoc_run_created'));
			open = false;
		} else toast.error(outcome.kind === 'refused' ? outcome.message : t('component.error'));
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-2xl p-0">
		<Stack gap="md" class="p-6">
			<Dialog.Header>
				<Dialog.Title>{t('app.payroll.adhoc_run_title', { period })}</Dialog.Title>
			</Dialog.Header>
			{#if loading}
				<Loading />
			{:else if items.length === 0}
				<EmptyState variant="inset" title={t('app.payroll.no_adhoc_items')} />
			{:else}
				<Stack gap="xs">
					<span class="text-meta">{t('app.payroll.adhoc_people')}</span>
					<Combobox
						aria-label={t('app.payroll.adhoc_people')}
						options={personOptions.filter((person) => !selectedPeople.has(person.value))}
						value={null}
						placeholder={t('app.payroll.choose_adhoc_people')}
						onChange={(id) => {
							if (id != null) selectedPeople = flip(selectedPeople, [id], true);
						}}
					/>
					<Cluster gap="xs">
						{#each personOptions.filter( (person) => selectedPeople.has(person.value) ) as person (person.value)}
							<Button
								size="sm"
								variant="outline"
								aria-label={t('app.payroll.remove_adhoc_person', { name: person.label })}
								onclick={() => (selectedPeople = flip(selectedPeople, [person.value], false))}
								>{person.label} ×</Button
							>
						{/each}
					</Cluster>
				</Stack>
				<Cluster gap="xs" role="group" aria-label={t('app.payroll.adhoc_items')}>
					{#each items as item (item.key)}
						{@const on = picked.has(item.key)}
						<Button
							size="sm"
							variant={on ? 'default' : 'outline'}
							aria-pressed={on}
							onclick={() => (picked = flip(picked, [item.key], !on))}
						>
							{item.label}
						</Button>
					{/each}
				</Cluster>
				{#if selectedPeople.size === 0}<p class="text-sm text-muted-foreground">
						{t('app.payroll.choose_adhoc_people')}
					</p>
				{:else if picked.size > 0 && people.length === 0}
					<EmptyState variant="inset" title={t('app.payroll.no_outstanding_entries')} />
				{:else if people.length > 0}
					<Scroll name={t('app.payroll.outstanding_entries')} max="standard">
						<Stack as="ul" gap="md">
							{#each people as person (person.id)}
								{@const ids = person.entries.map((entry) => entry.id)}
								{@const count = ids.filter((id) => !unticked.has(id)).length}
								<li>
									<Stack gap="xs">
										<Cluster gap="sm" align="center">
											<Checkbox
												aria-label={person.name}
												checked={count === ids.length}
												indeterminate={count > 0 && count < ids.length}
												onCheckedChange={(on) => (unticked = flip(unticked, ids, on !== true))}
											/>
											<span class="text-sm font-medium">{person.name}</span>
											{#if early(person)}
												<Badge data-early-salary>{t('app.payroll.salary_early')}</Badge>
											{/if}
										</Cluster>
										<Stack as="ul" gap="xs" class="pl-7">
											{#each person.entries as entry (entry.id)}
												<li>
													<Inline as="label" gap="sm" align="center" class="text-sm">
														<Checkbox
															checked={!unticked.has(entry.id)}
															onCheckedChange={(on) =>
																(unticked = flip(unticked, [entry.id], on !== true))}
														/>
														<span class="min-w-0 flex-1 truncate">{entry.name}</span>
														<span class="text-meta tabular-nums"
															>{formatCalendarDate(entry.day)}</span
														>
														<span class="w-24 text-right tabular-nums"
															>{formatNumeric(entry.amount)}</span
														>
													</Inline>
												</li>
											{/each}
										</Stack>
									</Stack>
								</li>
							{/each}
						</Stack>
					</Scroll>
				{/if}
			{/if}
			<Cluster justify="between" align="center" gap="sm">
				<span class="text-meta tabular-nums">
					{t('app.payroll.selected_entries', {
						count: chosen.length,
						amount: formatNumeric(total)
					})}
				</span>
				<Button disabled={busy || chosen.length === 0} onclick={create}>
					{t('app.payroll.create_run')}
				</Button>
			</Cluster>
		</Stack>
	</Dialog.Content>
</Dialog.Root>
