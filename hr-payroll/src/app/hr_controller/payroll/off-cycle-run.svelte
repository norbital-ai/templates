<script lang="ts">
	/**
	 * A new off-cycle run inside one pay cycle: the outstanding, approved claims and ad hoc entries of the company,
	 * by person, and the ones ticked are the run's `sources`. A CORRECTION pays ad hoc lines only. A person whose
	 * salary the run settles ahead of the cycle's REGULAR run carries the EARLY mark (`settlesSalaryEarly`).
	 */
	import { t } from '../../../lib/ui/t.js';
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { toast } from 'svelte-sonner';
	import { Badge, Button, Checkbox, Dialog, EmptyState } from '@norbital-ai/ui';
	import { Cluster, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { EMPLOYMENT_LABEL_SELECT, employmentLabel } from '../../../lib/ui/create-scope.js';
	import { formatCalendarDate, formatNumeric } from '../../../lib/ui/display-formatters.js';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import { decodeNumber } from '../../../lib/wire.js';
	import { settlesSalaryEarly } from '../../../lib/pay-cycles.js';

	let {
		open = $bindable(false),
		companyId,
		period,
		cycleRuns,
		cycleSlips
	}: {
		open?: boolean;
		companyId: Id<'companies'>;
		period: string;
		cycleRuns: Parameters<typeof settlesSalaryEarly>[0];
		cycleSlips: Parameters<typeof settlesSalaryEarly>[1];
	} = $props();

	// outstanding: live (not held under an approval) and not yet captured by a payslip
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

	let kind = $state<'OFF_CYCLE' | 'CORRECTION'>('OFF_CYCLE');
	let selected = $state<ReadonlySet<string>>(new Set());
	let busy = $state(false);

	type Entry = {
		id: string;
		family: 'claim' | 'adhoc';
		name: string;
		day: unknown;
		amount: number;
	};
	const catalogueName = (ref: unknown) => {
		const row = ref as { name?: unknown; code?: unknown } | null;
		return String(row?.name ?? row?.code ?? '—');
	};
	/** The entries by person, people by name; a CORRECTION offers ad hoc lines only. */
	const people = $derived.by(() => {
		const rows = [
			...(kind === 'CORRECTION' ? [] : (claims.current ?? [])).map((row) => ({
				row,
				family: 'claim' as const,
				day: row.incurred_on
			})),
			...(adhoc.current ?? []).map((row) => ({
				row,
				family: 'adhoc' as const,
				day: row.event_date
			}))
		];
		const byPerson = new Map<string, { id: string; name: string; entries: Entry[] }>();
		for (const { row, family, day } of rows) {
			const employment = row.employment_id;
			const person = byPerson.get(employment.id) ?? {
				id: employment.id,
				name: employmentLabel(employment),
				entries: []
			};
			person.entries.push({
				id: row.id,
				family,
				name: catalogueName(row.catalogue_id),
				day,
				amount: decodeNumber(row.amount)
			});
			byPerson.set(employment.id, person);
		}
		return [...byPerson.values()].toSorted((a, b) => a.name.localeCompare(b.name));
	});
	const loading = $derived(claims.loading || adhoc.loading);
	const chosen = $derived(
		people.flatMap((person) => person.entries).filter((e) => selected.has(e.id))
	);
	const total = $derived(chosen.reduce((sum, entry) => sum + entry.amount, 0));

	const toggle = (ids: readonly string[], on: boolean) => {
		const next = new Set(selected);
		for (const id of ids)
			if (on) next.add(id);
			else next.delete(id);
		selected = next;
	};
	const early = (person: { id: string; entries: Entry[] }) =>
		kind === 'OFF_CYCLE' &&
		person.entries.some((entry) => selected.has(entry.id)) &&
		settlesSalaryEarly(cycleRuns, cycleSlips, person.id);

	async function create() {
		busy = true;
		const outcome = await bolt.act('payroll_runs.create', {
			company_id: companyId,
			period,
			kind,
			sources: chosen.map((entry) => entry.id)
		});
		busy = false;
		if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
			toast.success(t('app.payroll.off_cycle_created'));
			selected = new Set();
			open = false;
		} else toast.error(outcome.kind === 'refused' ? outcome.message : t('component.error'));
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-2xl p-0">
		<Stack gap="md" class="p-6">
			<Dialog.Header>
				<Dialog.Title>{t('app.payroll.new_off_cycle_title', { period })}</Dialog.Title>
			</Dialog.Header>
			<Cluster gap="xs" role="group" aria-label={t('app.payroll.run_kind')}>
				{#each ['OFF_CYCLE', 'CORRECTION'] as const as option (option)}
					<Button
						size="sm"
						variant={kind === option ? 'secondary' : 'ghost'}
						aria-pressed={kind === option}
						onclick={() => {
							kind = option;
							selected = new Set();
						}}
					>
						{t(`models.payroll_runs.fields.kind.${option}`)}
					</Button>
				{/each}
			</Cluster>
			{#if loading}
				<p class="text-sm text-muted-foreground">{t('app.payroll.loading_entries')}</p>
			{:else if people.length === 0}
				<EmptyState title={t('app.payroll.no_outstanding_entries')} />
			{:else}
				<Scroll name={t('app.payroll.outstanding_entries')} max="standard">
					<Stack as="ul" gap="md">
						{#each people as person (person.id)}
							{@const ids = person.entries.map((entry) => entry.id)}
							{@const count = ids.filter((id) => selected.has(id)).length}
							<li>
								<Stack gap="xs">
									<Cluster gap="sm" align="center">
										<Checkbox
											aria-label={person.name}
											checked={count === ids.length}
											indeterminate={count > 0 && count < ids.length}
											onCheckedChange={(on) => toggle(ids, on === true)}
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
														checked={selected.has(entry.id)}
														onCheckedChange={(on) => toggle([entry.id], on === true)}
													/>
													<span class="min-w-0 flex-1 truncate">{entry.name}</span>
													<span class="text-meta tabular-nums">{formatCalendarDate(entry.day)}</span
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
