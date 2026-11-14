import type { ActInput, Callable } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';
import { fork } from '@norbital-ai/ui/effect';
import { Effect } from 'effect';
import type { EntryEmployee, EntryEntity, EntryLaws } from '../../payroll_engine/entry_workbook.js';
import type { pageLaws } from '../law.svelte.js';
import type { CompanyScope } from '../scopes/company_scope.svelte.js';
import { runWorkbookImport, type WorkbookGrids } from './workbook_import.js';

/** What every entry sheet parser reads of the picked company: itself, its employments and the laws by date. */
export type EntryParty = {
	readonly entity: EntryEntity;
	readonly employees: readonly EntryEmployee[];
	readonly laws: EntryLaws;
};
type Held = {
	readonly employment: {
		readonly rows: readonly {
			readonly id: EntryEmployee['id'];
			readonly employee_number: string;
			readonly entity_id: EntryEmployee['entity_id'];
			readonly effective_range: { readonly from: string; readonly to: string | null };
		}[];
	};
};

/** A sheet's number as the plain decimal a write takes. */
export const plain = (amount: number) =>
	new Intl.NumberFormat('en', { useGrouping: false, maximumFractionDigits: 20 }).format(amount);

/**
 * One entry sheet's import for the picked company: the page parses the workbook against its held rows, and the rows
 * are one create act. Answers the toolbar item under the name the page gives it. Call during component initialisation.
 */
export function entryImport<const A extends string, H extends Held>(
	ctx: Pick<PageContext, 't' | 'act'>,
	scope: CompanyScope,
	laws: ReturnType<typeof pageLaws>,
	options: {
		readonly action: A extends Callable ? A : Callable;
		readonly label: () => string;
		readonly held: () => H | null | undefined;
		/** The refusal while the held rows are still out. */
		readonly loading: string;
		build(
			grids: WorkbookGrids,
			current: H,
			party: EntryParty
		): {
			readonly rows: ActInput<A>;
			readonly warnings: readonly string[];
		};
	}
) {
	let importing = $state(false);
	let imported = 0;
	let warnings: readonly string[] = [];
	const buildPayload = (grids: WorkbookGrids): ActInput<A> => {
		const current = options.held();
		const company = scope.company;
		if (current == null || company == null) throw new Error(options.loading);
		const built = options.build(grids, current, {
			entity: {
				id: company.id,
				code: company.code ?? null,
				name: company.name,
				settings_code: company.settings_code
			},
			employees: current.employment.rows.map((row) => ({
				id: row.id,
				number: row.employee_number,
				entity_id: row.entity_id,
				from: row.effective_range.from,
				to: row.effective_range.to
			})),
			laws: laws.on
		});
		const rows: unknown = built.rows;
		imported = Array.isArray(rows) ? rows.length : 0;
		warnings = built.warnings;
		return built.rows;
	};
	const run = () => {
		importing = true;
		fork(
			runWorkbookImport<A>(ctx, {
				action: options.action,
				recordLabel: options.label().toLowerCase(),
				buildPayload,
				importedCount: () => imported,
				warnings: () => warnings
			}).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						importing = false;
					})
				)
			)
		);
	};
	return (name: string) => ({
		run,
		icon: 'lucide:file-spreadsheet',
		name,
		disabled: () =>
			importing || options.held() == null || laws.loading ? ctx.t('component.loading') : null
	});
}
