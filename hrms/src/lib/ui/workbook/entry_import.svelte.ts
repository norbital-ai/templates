import type { ActInput, Callable, Id } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';
import { fork } from '@norbital-ai/ui/effect';
import { Effect } from 'effect';
import type {
	EntryEmployee,
	EntryEntity,
	EntryLaws
} from '../../../data/model/entry/service/entry_workbook.js';
import type { pageLaws } from '../law.svelte.js';
import type { CompanyScope } from '../scopes/company_scope.svelte.js';
import { runWorkbookImport, workbookImportError, type WorkbookGrids } from './workbook_import.js';

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

/** Standard company-scoped employment query shared by every entry workbook import. */
export const employmentQuery = (companyId: Id<'entity'>) =>
	({
		where: { entity_id: { eq: companyId } },
		fields: ['employee_number', 'entity_id', 'effective_range'],
		limit: 10000
	}) as const;

/**
 * One entry sheet's import for the picked company: loads existing rows lazily only when the user
 * picks a workbook, parses against them, and writes one create act. Call during component initialisation.
 */
export function entryImport<const A extends string, H extends Held, E>(
	ctx: Pick<PageContext, 't' | 'act'>,
	scope: CompanyScope,
	laws: ReturnType<typeof pageLaws>,
	options: {
		readonly action: A extends Callable ? A : Callable;
		readonly label: () => string;
		readonly load: (companyId: Id<'entity'>) => Effect.Effect<H, E>;
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
	const buildPayload = (grids: WorkbookGrids) =>
		Effect.gen(function* () {
			const company = scope.company;
			if (company == null)
				return yield* Effect.fail(workbookImportError(ctx.t('component.loading')));
			const current = yield* options.load(company.id).pipe(Effect.mapError(workbookImportError));
			const built = yield* Effect.try({
				try: () =>
					options.build(grids, current, {
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
					}),
				catch: workbookImportError
			});
			const rows: unknown = built.rows;
			imported = Array.isArray(rows) ? rows.length : 0;
			warnings = built.warnings;
			return built.rows;
		});
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
			importing || scope.company == null || laws.loading ? ctx.t('component.loading') : null
	});
}
