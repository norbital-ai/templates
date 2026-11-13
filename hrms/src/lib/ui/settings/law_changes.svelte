<script lang="ts">
	/**
	 * A law's dated changes, newest first. A row shows its date and only what it changed, and opens its own record:
	 * there its patch is edited, its date moved, or the change deleted, and a write the law refuses says why.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { format, open_record } from '@norbital-ai/ui';
	import { leaves } from '../../dated.js';
	import { LAW_DEPTH, LAW_ROWS } from '../../law.js';
	import type { JsonObject } from '../../payroll_engine/foundation.js';
	import VersionTimeline from '../components/version_timeline.svelte';
	import { LAW_FAMILY_LABEL } from './law_row.svelte';
	import { changeOf, type LawChange } from './law_save.js';

	let { ctx, chain, today }: { ctx: PageContext; chain: readonly LawChange[]; today: string } =
		$props();

	const title = (name: string) => `${name[0]?.toUpperCase()}${name.slice(1).replaceAll('_', ' ')}`;
	/** Family, then each row or key with the fields set under it; a long list is cut. */
	const summary = (patch: JsonObject): string =>
		[...Map.groupBy(leaves(patch, LAW_DEPTH), ([path]) => path.split('/')[0] ?? '')]
			.map(([family, paths]) => {
				const rows = LAW_ROWS.find((name) => name === family);
				const codes = [...Map.groupBy(paths, ([path]) => path.split('/')[1] ?? '')].map(
					([code, set]) => {
						const names = set.flatMap(([path, value]) => {
							const field = path.split('/')[2];
							return field !== undefined
								? [field]
								: value === null
									? [ctx.t('law_changes.removed')]
									: [];
						});
						const shown = names.length > 4 ? [...names.slice(0, 4), '…'] : names;
						return shown.length === 0 ? code : `${code} (${shown.join(', ')})`;
					}
				);
				const shown = codes.length > 6 ? [...codes.slice(0, 6), '…'] : codes;
				return `${rows === undefined ? title(family) : LAW_FAMILY_LABEL[rows]}: ${shown.join(', ')}`;
			})
			.join(' · ');

	const items = $derived.by(() => {
		const ordered = chain
			.map((row) => ({ row, change: changeOf(row) }))
			.toSorted(
				(left, right) =>
					right.change.effective_from.localeCompare(left.change.effective_from) ||
					right.change.id.localeCompare(left.change.id)
			);
		const first = ordered.at(-1)?.change.id;
		return ordered.map(({ row, change }) => {
			const finding = row.finding_id?.status;
			const what = change.id === first ? ctx.t('law_changes.whole') : summary(change.patch);
			return {
				id: change.id,
				period: format({ kind: 'date' }, change.effective_from, { locale: ctx.locale }),
				status:
					finding !== undefined && finding !== 'CONFIRMED'
						? ctx.t('law_changes.not_confirmed')
						: change.effective_from > today
							? ctx.t('law_changes.upcoming')
							: ctx.t('app.settings.version_in_force'),
				detail:
					finding === undefined
						? what
						: `${what} — ${ctx.t('law_changes.research', { status: finding })}`
			};
		});
	});
</script>

<VersionTimeline
	label={ctx.t('app.settings.changes')}
	{items}
	onOpen={(id) => open_record('jurisdiction_change', id)}
/>
