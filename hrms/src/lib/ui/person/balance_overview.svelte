<script lang="ts">
	/**
	 * What a person has left today: one line per leave and claim row in the window in force, read from the balance.
	 * Statutory and pay totals are amounts paid, not left: they sit in their own section. Earlier windows wait behind
	 * History. Read-only: HR adjusts a balance from the ledger.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button, Icon, Table } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { accountsOf, leftIn } from '../../ledger/core.js';

	let { ctx, account }: { ctx: PageContext; account: unknown } = $props();
	const t = ctx.t;
	const today = String(ctx.clock('day').today);
	let history = $state(false);

	const COUNTED = ['leave', 'claim'] as const;
	const PAID = ['statutory', 'pay'] as const;
	const WINDOWS = ['Y', 'M', 'S', 'B', 'L', 'E'] as const;
	/** `<scope>.<window letter>.<start>` in words: "Year from 2026-01-01". */
	const windowName = (period: string) => {
		const [, letter, start = ''] = /\.([YMSBLE])\.(\d{4}-\d{2}-\d{2})$/.exec(period) ?? [];
		const kind = WINDOWS.find((known) => known === letter);
		return kind === undefined
			? period
			: `${t(`balance.window.${kind}`)} ${kind === 'M' ? start.slice(0, 7) : start}`;
	};
	const accounts = $derived(accountsOf(account));
	// the rows' words and units, from the sealed law of the countries the balance holds
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
		ctx.query({
			jurisdiction_settings: {
				where: { code: { in: scopes }, status: { eq: 'SEALED' } },
				fields: ['code', 'currency'],
				limit: 1000,
				leave_catalog: { fields: ['code', 'description', 'lookup'], limit: 1000 },
				claim_catalog: { fields: ['code', 'description'], limit: 1000 },
				statutory_contribution_catalog: { fields: ['code', 'description'], limit: 1000 },
				subtotals: { fields: ['code', 'name'], limit: 1000 }
			}
		})
	);
	// ponytail: a code keeps one description and unit across versions here; read the window's own version if they ever differ
	const known = $derived.by(() => {
		const about = new Map<string, string>();
		const hours = new Set<string>();
		const currency = new Map<string, string>();
		for (const version of law.current?.jurisdiction_settings.rows ?? []) {
			currency.set(version.code, String(version.currency));
			for (const row of version.leave_catalog) {
				if (row.description) about.set(`leave/${row.code}`, row.description);
				if (row.lookup.unit === 'HOUR') hours.add(row.code);
			}
			for (const row of version.claim_catalog)
				if (row.description) about.set(`claim/${row.code}`, row.description);
			for (const row of version.statutory_contribution_catalog)
				if (row.description) about.set(`statutory/${row.code.split('.')[0]}`, row.description);
			for (const row of version.subtotals) about.set(`pay/${row.code}`, row.name);
		}
		return { about, hours, currency };
	});
	const unitOf = (family: string, code: string, period: string) =>
		family === 'claim'
			? (known.currency.get(period.split('.')[0] ?? '') ?? t('balance.unit.MONEY'))
			: t(known.hours.has(code) ? 'balance.unit.HOUR' : 'balance.unit.DAY');
	/** Each code's windows, the one in force today first: the newest that has started. */
	const windows = (families: readonly string[]) =>
		families.flatMap((family) =>
			Object.entries(accounts[family] ?? {}).flatMap(([code, periods]) => {
				const started = Object.keys(periods)
					.filter((period) => period.slice(-10) <= today)
					.toSorted((one, other) => other.slice(-10).localeCompare(one.slice(-10)));
				return started.map((period, index) => ({
					id: `${family}/${code}/${period}`,
					family,
					code,
					period,
					current: index === 0,
					measures: periods[period] ?? {}
				}));
			})
		);
	const counted = $derived(
		windows(COUNTED)
			.map(({ measures, ...line }) => ({
				...line,
				item: line.code,
				about: known.about.get(`${line.family}/${line.code}`) ?? '',
				window: windowName(line.period),
				entitled: measures.entitled ?? measures.limit ?? 0,
				carried: line.family === 'leave' ? (measures.carried ?? 0) : null,
				used: measures.used ?? 0,
				left: leftIn(measures),
				unit: unitOf(line.family, line.code, line.period)
			}))
			.toSorted(
				(one, other) =>
					one.family.localeCompare(other.family) ||
					one.code.localeCompare(other.code) ||
					other.period.slice(-10).localeCompare(one.period.slice(-10))
			)
	);
	const paid = $derived(
		windows(PAID)
			.filter((line) => line.current)
			.map(({ measures, ...line }) => ({
				...line,
				item:
					line.family === 'pay' ? (known.about.get(`pay/${line.code}`) ?? line.code) : line.code,
				about: known.about.get(`statutory/${line.code.split('.')[0]}`) ?? '',
				window: windowName(line.period),
				paid: measures.paid ?? measures.total ?? 0
			}))
			.toSorted(
				(one, other) =>
					// statutory before pay totals
					other.family.localeCompare(one.family) || one.item.localeCompare(other.item)
			)
	);
	const number = { kind: 'number' } as const;
</script>

{#snippet itemCell({ row }: { row: { item: string; about: string } })}<span
		class="block truncate"
		title={row.about === '' ? undefined : row.about}>{row.item}</span
	>{/snippet}

<Stack size="fill" gap="lg">
	<Table
		{ctx}
		of={counted.filter((line) => line.current)}
		key="person-balance-left"
		toolbar={{
			new: false,
			title: t('balance.overview'),
			description: t('balance.overview_help'),
			trailing: historyToggle
		}}
		columns={[
			{ field: 'item', label: t('balance.item'), cell: itemCell },
			{ field: 'window', label: t('balance.window') },
			{ field: 'entitled', label: t('balance.entitled'), kind: number, align: 'end' },
			{ field: 'carried', label: t('balance.carried'), kind: number, align: 'end' },
			{ field: 'used', label: t('balance.used'), kind: number, align: 'end' },
			{ field: 'left', label: t('balance.left'), kind: number, align: 'end' },
			{ field: 'unit', label: t('balance.unit') }
		]}
	/>
	{#if history}<Table
			{ctx}
			of={counted.filter((line) => !line.current)}
			key="person-balance-history"
			toolbar={{ new: false, title: t('balance.history') }}
			columns={[
				{ field: 'item', label: t('balance.item'), cell: itemCell },
				{ field: 'window', label: t('balance.window') },
				{ field: 'entitled', label: t('balance.entitled'), kind: number, align: 'end' },
				{ field: 'carried', label: t('balance.carried'), kind: number, align: 'end' },
				{ field: 'used', label: t('balance.used'), kind: number, align: 'end' },
				{ field: 'left', label: t('balance.left'), kind: number, align: 'end' },
				{ field: 'unit', label: t('balance.unit') }
			]}
		/>{/if}
	{#if paid.length > 0}<Table
			{ctx}
			of={paid}
			key="person-balance-paid"
			toolbar={{ new: false, title: t('balance.paid'), description: t('balance.paid_help') }}
			columns={[
				{ field: 'item', label: t('balance.item'), cell: itemCell },
				{ field: 'window', label: t('balance.window') },
				{ field: 'paid', label: t('balance.paid_amount'), kind: number, align: 'end' }
			]}
		/>{/if}
</Stack>
{#snippet historyToggle()}<Button variant="outline" onclick={() => (history = !history)}
		><Icon name="lucide:history" class="size-4" />{t('balance.history')}</Button
	>{/snippet}
