// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	MONTH_BOARD_INTERACTIVE_QUERY_CEILING,
	MONTH_BOARD_INTERACTIVE_ROW_BOUND,
	MONTH_BOARD_NORMAL_QUERY_CEILING,
	MONTH_BOARD_NORMAL_ROW_BOUND,
	MONTH_BOARD_QUERY_LIMITS,
	monthBoardQueryReceipt
} from './month-board-query.ts';

const normalInput = {
	companySelected: true,
	employmentsLoaded: true,
	activeEmploymentCount: 42,
	workDayCount: 1_302,
	daysInMonth: 31,
	schemaFilterActive: false,
	unresolvedClockOutsOnly: false
} as const;

test('the normal month board has a fixed twelve-query and 48,950-row ceiling', () => {
	const receipt = monthBoardQueryReceipt(normalInput);

	assert.equal(MONTH_BOARD_NORMAL_QUERY_CEILING, 12);
	assert.equal(MONTH_BOARD_NORMAL_ROW_BOUND, 48_950);
	assert.equal(receipt.queryCount, 12);
	assert.equal(receipt.rowBound, 48_950);
	assert.equal(receipt.perEmployeeQueryCount, 0);
	assert.equal(receipt.perDayQueryCount, 0);
	assert.equal(receipt.matrixCellCount, 1_302);
	assert.deepEqual(
		receipt.sources.map(({ source }) => source),
		[
			'companies',
			'employments',
			'rosterCodes',
			'leaveTypes',
			'rosters',
			'payrollRuns',
			'holidays',
			'employees',
			'employmentTerms',
			'workDays',
			'leaveRequests',
			'settlementClaims'
		]
	);
});

test('the unresolved-clock-out eye adds no read to the normal graph', () => {
	const allPeople = monthBoardQueryReceipt(normalInput);
	const unresolvedOnly = monthBoardQueryReceipt({
		...normalInput,
		unresolvedClockOutsOnly: true
	});

	assert.equal(unresolvedOnly.unresolvedClockOutFilterApplied, true);
	assert.equal(unresolvedOnly.eyeFilterAdditionalQueries, 0);
	assert.equal(unresolvedOnly.queryCount, allPeople.queryCount);
	assert.equal(unresolvedOnly.rowBound, allPeople.rowBound);
	assert.deepEqual(unresolvedOnly.sources, allPeople.sources);
});

test('employee and day cardinality change matrix work but never query cardinality', () => {
	const smallMonth = monthBoardQueryReceipt({
		...normalInput,
		activeEmploymentCount: 1,
		workDayCount: 1,
		daysInMonth: 28
	});
	const largeMonth = monthBoardQueryReceipt({
		...normalInput,
		activeEmploymentCount: 1_000,
		workDayCount: 20_000,
		daysInMonth: 31
	});

	assert.equal(smallMonth.queryCount, largeMonth.queryCount);
	assert.equal(smallMonth.rowBound, largeMonth.rowBound);
	assert.equal(smallMonth.matrixCellCount, 28);
	assert.equal(largeMonth.matrixCellCount, 31_000);
});

test('one optional declarative schema-filter probe has its own fixed ceiling', () => {
	const receipt = monthBoardQueryReceipt({ ...normalInput, schemaFilterActive: true });

	assert.equal(MONTH_BOARD_INTERACTIVE_QUERY_CEILING, 13);
	assert.equal(MONTH_BOARD_INTERACTIVE_ROW_BOUND, 68_950);
	assert.equal(receipt.queryCount, 13);
	assert.equal(receipt.rowBound, 68_950);
	assert.deepEqual(receipt.sources.at(-1), {
		source: 'filteredWorkDays',
		rowBound: MONTH_BOARD_QUERY_LIMITS.filteredWorkDays,
		loadedRows: 0,
		atBound: false
	});
});

test('query activation follows declarative parent inputs instead of people or calendar loops', () => {
	assert.deepEqual(
		monthBoardQueryReceipt({
			...normalInput,
			companySelected: false,
			employmentsLoaded: false,
			activeEmploymentCount: 0,
			workDayCount: 0
		}),
		{
			sources: [{ source: 'companies', rowBound: 500, loadedRows: 0, atBound: false }],
			queryCount: 1,
			rowBound: 500,
			loadedRowCount: 0,
			matrixCellCount: 0,
			normalQueryCeiling: 12,
			normalRowBound: 48_950,
			interactiveQueryCeiling: 13,
			interactiveRowBound: 68_950,
			unresolvedClockOutFilterApplied: false,
			eyeFilterAdditionalQueries: 0,
			perEmployeeQueryCount: 0,
			perDayQueryCount: 0
		}
	);

	const companyWithoutActivePeople = monthBoardQueryReceipt({
		...normalInput,
		employmentsLoaded: true,
		activeEmploymentCount: 0,
		workDayCount: 0
	});
	assert.equal(companyWithoutActivePeople.queryCount, 7);
	assert.equal(companyWithoutActivePeople.rowBound, 2_950);

	const activePeopleWithoutRows = monthBoardQueryReceipt({
		...normalInput,
		workDayCount: 0
	});
	assert.equal(activePeopleWithoutRows.queryCount, 11);
	assert.equal(activePeopleWithoutRows.rowBound, 28_950);
});

test('the receipt totals observed rows and exposes sources that reach their configured bound', () => {
	const receipt = monthBoardQueryReceipt({
		...normalInput,
		loadedRows: {
			companies: 3,
			employments: 42,
			employees: 42,
			workDays: MONTH_BOARD_QUERY_LIMITS.workDays,
			settlementClaims: 7
		}
	});

	assert.equal(receipt.loadedRowCount, 20_094);
	assert.equal(receipt.sources.find(({ source }) => source === 'workDays')?.atBound, true);
	assert.equal(receipt.sources.find(({ source }) => source === 'employees')?.atBound, false);
});
