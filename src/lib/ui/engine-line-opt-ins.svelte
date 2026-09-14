<script lang="ts">
	/**
	 * The statutory opt-ins of the engine-priced work lines, as one matrix: a row is one
	 * (line, scheme, effect) decision.
	 *
	 * BASIC is the contract salary, ABSENCE an unpaid day, NIGHT_PREMIUM the premium. No work band
	 * prices them, so the only thing to state is which schemes each line posts into: INCLUDE adds
	 * the line to that scheme's base and REDUCE subtracts it. A pair that is not stated means no
	 * effect, and a row with no scheme chosen is not a statement at all.
	 */
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import type { CollectionField } from '@norbital-ai/std/collection';
	import { watch } from 'runed';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { StatutoryOptIn } from '../../datatypes/work_rules/+definition.js';
	import StatutorySchemeCell from './statutory-scheme-cell.svelte';

	type EngineLine = 'salary' | 'absence' | 'night';
	type EngineLines = Readonly<
		Record<EngineLine, { readonly statutory_opt_ins: readonly StatutoryOptIn[] }>
	>;
	type LineCode = 'BASIC' | 'ABSENCE' | 'NIGHT_PREMIUM';
	type OptInRow = {
		id: string;
		line: LineCode;
		contribution_id: string;
		effect: StatutoryOptIn['effect'];
	};

	let {
		value,
		disabled = false,
		readonly = false,
		onValueChange
	}: {
		readonly value: EngineLines;
		readonly disabled?: boolean;
		readonly readonly?: boolean;
		readonly onValueChange: (value: EngineLines) => void;
	} = $props();
	const { t } = useI18n<TenantI18nKeys>();

	const LINE_OF: Readonly<Record<LineCode, EngineLine>> = {
		BASIC: 'salary',
		ABSENCE: 'absence',
		NIGHT_PREMIUM: 'night'
	};
	const CODE_OF: Readonly<Record<EngineLine, LineCode>> = {
		salary: 'BASIC',
		absence: 'ABSENCE',
		night: 'NIGHT_PREMIUM'
	};
	const LINES = Object.keys(LINE_OF) as LineCode[];

	const project = (lines: EngineLines): OptInRow[] =>
		(Object.keys(CODE_OF) as EngineLine[]).flatMap((line) =>
			lines[line].statutory_opt_ins.map((optIn, index) => ({
				id: `${line}:${index}`,
				line: CODE_OF[line],
				contribution_id: optIn.contribution_id,
				effect: optIn.effect
			}))
		);
	let rows = $state<OptInRow[]>([]);
	watch(
		() => value,
		(lines) => {
			rows = project(lines);
		},
		{ lazy: false }
	);

	const fieldOf = (
		name: string,
		kind: string,
		extra: Partial<CollectionField> = {}
	): CollectionField => ({ name, kind, nullable: true, ...extra });
	const columns: MatrixColumn<OptInRow>[] = [
		{
			key: 'line',
			label: t('renderer.work_rules.engine_line'),
			field: fieldOf('line', 'enum', { values: LINES }),
			width: 180
		},
		{
			key: 'contribution_id',
			label: t('component.statutory_scheme'),
			field: fieldOf('contribution_id', 'text'),
			renderer: StatutorySchemeCell,
			width: 220
		},
		{
			key: 'effect',
			label: t('component.opt_in_effect'),
			field: fieldOf('effect', 'enum', { values: ['INCLUDE', 'REDUCE'] }),
			width: 160
		}
	];

	function commit(next: OptInRow[]): void {
		rows = next;
		const byLine: Record<EngineLine, StatutoryOptIn[]> = { salary: [], absence: [], night: [] };
		for (const row of next)
			if (row.contribution_id !== '')
				byLine[LINE_OF[row.line]].push({
					contribution_id: row.contribution_id,
					effect: row.effect
				});
		onValueChange({
			salary: { statutory_opt_ins: byLine.salary },
			absence: { statutory_opt_ins: byLine.absence },
			night: { statutory_opt_ins: byLine.night }
		});
	}
</script>

<MatrixRenderer
	bind:rows
	{columns}
	{disabled}
	{readonly}
	allowAddRows={!disabled}
	bounded={false}
	getRowId={(row) => row.id}
	addRowLabel={t('component.add_opt_in')}
	createRow={() => ({
		id: `new:${rows.length}`,
		line: 'BASIC' as const,
		contribution_id: '',
		effect: 'INCLUDE' as const
	})}
	onChange={commit}
/>
