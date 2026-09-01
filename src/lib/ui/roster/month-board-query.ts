/**
 * Every month-board `findMany` is a live prefix. The sync engine admits at most
 * `MAX_SYNC_LOADED_KEYS` (1 000) rows per query; a larger `limit` fails registration and
 * leaves the board on eternal loading. These bounds are that ceiling, not a second budget.
 */
export const MONTH_BOARD_QUERY_LIMITS = {
	companies: 500,
	employments: 1_000,
	employees: 1_000,
	rosterCodes: 500,
	employmentTerms: 1_000,
	leaveTypes: 200,
	rosters: 50,
	workDays: 1_000,
	leaveRequests: 1_000,
	payrollRuns: 500,
	settlementClaims: 1_000,
	holidays: 200,
	filteredWorkDays: 1_000
} as const;

type MonthBoardQuerySource = keyof typeof MONTH_BOARD_QUERY_LIMITS;

interface MonthBoardQueryReceiptInput {
	readonly companySelected: boolean;
	readonly employmentsLoaded: boolean;
	readonly activeEmploymentCount: number;
	readonly workDayCount: number;
	readonly daysInMonth: number;
	readonly schemaFilterActive: boolean;
	readonly unresolvedClockOutsOnly: boolean;
	readonly loadedRows?: Partial<Record<MonthBoardQuerySource, number>>;
}

interface MonthBoardQuerySourceReceipt {
	readonly source: MonthBoardQuerySource;
	readonly rowBound: number;
	readonly loadedRows: number;
	readonly atBound: boolean;
}

interface MonthBoardQueryReceipt {
	readonly sources: readonly MonthBoardQuerySourceReceipt[];
	readonly queryCount: number;
	readonly rowBound: number;
	readonly loadedRowCount: number;
	readonly matrixCellCount: number;
	readonly normalQueryCeiling: number;
	readonly normalRowBound: number;
	readonly interactiveQueryCeiling: number;
	readonly interactiveRowBound: number;
	readonly unresolvedClockOutFilterApplied: boolean;
	readonly eyeFilterAdditionalQueries: 0;
	readonly perEmployeeQueryCount: 0;
	readonly perDayQueryCount: 0;
}

const COMPANY_SOURCES = [
	'employments',
	'rosterCodes',
	'leaveTypes',
	'rosters',
	'payrollRuns',
	'holidays'
] as const satisfies readonly MonthBoardQuerySource[];

const ACTIVE_EMPLOYMENT_SOURCES = [
	'employees',
	'employmentTerms',
	'workDays',
	'leaveRequests'
] as const satisfies readonly MonthBoardQuerySource[];

const NORMAL_SOURCES = [
	'companies',
	...COMPANY_SOURCES,
	...ACTIVE_EMPLOYMENT_SOURCES,
	'settlementClaims'
] as const satisfies readonly MonthBoardQuerySource[];

function sourceBound(sources: readonly MonthBoardQuerySource[]): number {
	return sources.reduce((total, source) => total + MONTH_BOARD_QUERY_LIMITS[source], 0);
}

export const MONTH_BOARD_NORMAL_QUERY_CEILING = NORMAL_SOURCES.length;
export const MONTH_BOARD_NORMAL_ROW_BOUND = sourceBound(NORMAL_SOURCES);
export const MONTH_BOARD_INTERACTIVE_QUERY_CEILING = MONTH_BOARD_NORMAL_QUERY_CEILING + 1;
export const MONTH_BOARD_INTERACTIVE_ROW_BOUND =
	MONTH_BOARD_NORMAL_ROW_BOUND + MONTH_BOARD_QUERY_LIMITS.filteredWorkDays;

/**
 * A deterministic receipt for the declarative reads that can back one rendered month board.
 *
 * It records configured query limits rather than observed database work, so source tests can prove
 * that the graph stays bounded independently of the payroll engine benchmark. The unresolved-clock
 * eye is intentionally absent from the source graph: it filters the already-built person-day map.
 */
export function monthBoardQueryReceipt(input: MonthBoardQueryReceiptInput): MonthBoardQueryReceipt {
	const activeSources: MonthBoardQuerySource[] = ['companies'];
	if (input.companySelected) activeSources.push(...COMPANY_SOURCES);
	if (input.companySelected && input.employmentsLoaded && input.activeEmploymentCount > 0) {
		activeSources.push(...ACTIVE_EMPLOYMENT_SOURCES);
		if (input.workDayCount > 0) activeSources.push('settlementClaims');
		if (input.schemaFilterActive) activeSources.push('filteredWorkDays');
	}

	const sources = activeSources.map((source) => {
		const rowBound = MONTH_BOARD_QUERY_LIMITS[source];
		const loadedRows = input.loadedRows?.[source] ?? 0;
		return { source, rowBound, loadedRows, atBound: loadedRows >= rowBound };
	});

	return {
		sources,
		queryCount: sources.length,
		rowBound: sources.reduce((total, source) => total + source.rowBound, 0),
		loadedRowCount: sources.reduce((total, source) => total + source.loadedRows, 0),
		matrixCellCount: Math.max(0, input.activeEmploymentCount) * Math.max(0, input.daysInMonth),
		normalQueryCeiling: MONTH_BOARD_NORMAL_QUERY_CEILING,
		normalRowBound: MONTH_BOARD_NORMAL_ROW_BOUND,
		interactiveQueryCeiling: MONTH_BOARD_INTERACTIVE_QUERY_CEILING,
		interactiveRowBound: MONTH_BOARD_INTERACTIVE_ROW_BOUND,
		unresolvedClockOutFilterApplied: input.unresolvedClockOutsOnly,
		eyeFilterAdditionalQueries: 0,
		perEmployeeQueryCount: 0,
		perDayQueryCount: 0
	};
}
