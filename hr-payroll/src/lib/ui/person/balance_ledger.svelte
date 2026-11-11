<script lang="ts">
	/**
	 * A person's balance as HR reads it: one line per item and window with what is entitled, carried, used and left,
	 * and under it every ledger row of the chosen line, newest first. Read-only: the manual adjustment is the one write.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Table } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { accountsOf, leftIn } from '../../ledger/core.js';

	let { balanceId, account }: { balanceId: Id<'employee_balance'>; account: unknown } = $props();
	const t = bolt.t;
	let chosen = $state<string | null>(null);

	const FAMILIES = ['leave', 'claim', 'statutory', 'pay'] as const;
	const WINDOWS = ['Y', 'M', 'S', 'B', 'L', 'E'] as const;
	const SOURCES = [
		'manual',
		'entitlement',
		'retention',
		'payroll_run',
		'leave_catalog_entry',
		'claim_catalog_entry',
		'adhoc_catalog_entry'
	] as const;
	const order = (family: string) => {
		const at = FAMILIES.findIndex((known) => known === family);
		return at < 0 ? FAMILIES.length : at;
	};
	const familyName = (family: string) => {
		const known = FAMILIES.find((name) => name === family);
		return known === undefined ? family : t(`balance.family.${known}`);
	};
	/** `<scope>.<window letter>.<start>` in words: "Year from 2026-01-01 (MY)". */
	const windowName = (period: string) => {
		const [, scope = '', letter, start = ''] =
			/^(.+)\.([YMSBLE])\.(\d{4}-\d{2}-\d{2})$/.exec(period) ?? [];
		const kind = WINDOWS.find((known) => known === letter);
		return kind === undefined
			? period
			: `${t(`balance.window.${kind}`)} ${kind === 'M' ? start.slice(0, 7) : start} (${scope.split('.')[0]})`;
	};
	/** `manual:<id>`, `leave_catalog_entry:<id>`, `payroll_run:<id>`, `entitlement:…`, `retention:…` in plain words. */
	const sourceName = (source: unknown) => {
		const kind = String(source ?? '').split(':')[0] ?? '';
		const known = SOURCES.find((name) => name === kind);
		return known === undefined ? kind : t(`balance.source.${known}`);
	};
	const accounts = $derived(accountsOf(account));
	// the words for each code, from the sealed law of the countries the balance holds
	const scopes = $derived([
		...new Set(
			Object.values(accounts).flatMap((codes) =>
				Object.values(codes).flatMap((periods) =>
					Object.keys(periods).map((period) => period.split('.')[0] ?? '')
				)
			)
		)
	]);
	const law = $derived(
		bolt.query({
			jurisdiction_settings: {
				where: { code: { in: scopes }, status: { eq: 'SEALED' } },
				fields: ['id'],
				limit: 1000
			},
			'jurisdiction_settings.leave_catalog': { fields: ['code', 'description'], limit: 1000 },
			'jurisdiction_settings.claim_catalog': { fields: ['code', 'description'], limit: 1000 },
			'jurisdiction_settings.statutory_contribution_catalog': {
				fields: ['code', 'description'],
				limit: 1000
			},
			'jurisdiction_settings.subtotals': { fields: ['code', 'name'], limit: 1000 }
		})
	);
	// ponytail: a code keeps one description across versions here; read the window's own version if they ever differ
	const words = $derived.by(() => {
		const held = new Map<string, string>();
		const put = (family: string, code: string, text: string | null | undefined) => {
			if (typeof text === 'string' && text.trim() !== '') held.set(`${family}/${code}`, text);
		};
		for (const version of law.current?.jurisdiction_settings.rows ?? []) {
			for (const row of version.leave_catalog) put('leave', row.code, row.description);
			for (const row of version.claim_catalog) put('claim', row.code, row.description);
			for (const row of version.statutory_contribution_catalog) {
				put('statutory', `${row.code}.employee`, row.description);
				put('statutory', `${row.code}.employer`, row.description);
			}
			for (const row of version.subtotals) put('pay', row.code, row.name);
		}
		return held;
	});
	const lines = $derived(
		Object.entries(accounts)
			.flatMap(([family, codes]) =>
				Object.entries(codes).flatMap(([code, periods]) =>
					Object.entries(periods).map(([period, measures]) => {
						const counted = family === 'leave' || family === 'claim';
						return {
							id: `${family}/${code}/${period}`,
							family,
							code,
							period,
							account: familyName(family),
							item: words.get(`${family}/${code}`) ?? code,
							window: windowName(period),
							entitled: counted ? (measures.entitled ?? measures.limit ?? 0) : null,
							carried: family === 'leave' ? (measures.carried ?? 0) : null,
							used: counted ? (measures.used ?? 0) : (measures.paid ?? measures.total ?? 0),
							left: counted ? leftIn(measures) : null
						};
					})
				)
			)
			.toSorted(
				(one, other) =>
					order(one.family) - order(other.family) ||
					other.period.slice(-10).localeCompare(one.period.slice(-10)) ||
					one.code.localeCompare(other.code)
			)
	);
	const line = $derived(lines.find((row) => row.id === chosen));
	const number = { kind: 'number' } as const;
</script>

{#snippet itemCell({ row }: { row: (typeof lines)[number] })}
	<span class="block min-w-0">
		<span class="block truncate">{row.item}</span>
		{#if row.item !== row.code}<span class="block truncate font-mono text-xs text-muted-foreground"
				>{row.code}</span
			>{/if}
	</span>
{/snippet}
{#snippet sourceCell({ value }: { value: unknown })}{sourceName(value)}{/snippet}

<Stack gap="lg">
	<Table
		of={lines}
		key="person-balance"
		toolbar={{ new: false, title: t('v2.balances'), description: t('balance.lines_help') }}
		rowClass={(row) => (row.id === chosen ? 'bg-muted/50' : undefined)}
		onOpen={(row) => (chosen = row.id === chosen ? null : row.id)}
		columns={[
			{ field: 'account', label: t('balance.account') },
			{ field: 'item', label: t('balance.item'), cell: itemCell },
			{ field: 'window', label: t('balance.window') },
			{ field: 'entitled', label: t('balance.entitled'), kind: number, align: 'end' },
			{ field: 'carried', label: t('balance.carried'), kind: number, align: 'end' },
			{ field: 'used', label: t('balance.used'), kind: number, align: 'end' },
			{ field: 'left', label: t('balance.left'), kind: number, align: 'end' }
		]}
	/>
	<Table
		of="ledger_entry"
		key="person-ledger"
		where={{
			balance_id: { eq: balanceId },
			...(line === undefined
				? {}
				: {
						account: { eq: line.family },
						code: { eq: line.code },
						period: { eq: line.period }
					})
		}}
		orderBy={{ effective_on: 'desc' }}
		toolbar={{
			new: false,
			title:
				line === undefined
					? t('balance.ledger')
					: `${t('balance.ledger')} · ${line.item} · ${line.window}`
		}}
		columns={[
			'effective_on',
			{ field: 'source', cell: sourceCell },
			'operation',
			'amount',
			'unit',
			'measure',
			'note'
		]}
	/>
</Stack>
