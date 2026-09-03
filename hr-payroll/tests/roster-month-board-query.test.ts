// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	MONTH_BOARD_FILTERED_WORK_DAY_COLUMNS,
	MONTH_BOARD_INTERACTIVE_QUERY_CEILING,
	MONTH_BOARD_INTERACTIVE_ROW_BOUND,
	MONTH_BOARD_NORMAL_QUERY_CEILING,
	MONTH_BOARD_NORMAL_ROW_BOUND,
	MONTH_BOARD_QUERY_LIMITS,
	MONTH_BOARD_WORK_DAY_COLUMNS,
	monthBoardQueryReceipt,
	monthBoardWorkDayLiveColumns
} from '../src/lib/ui/roster/month-board-query.ts';

const normalInput = {
	companySelected: true,
	employmentsLoaded: true,
	activeEmploymentCount: 42,
	workDayCount: 1_302,
	daysInMonth: 31,
	schemaFilterActive: false,
	unresolvedClockOutsOnly: false
} as const;

test('the normal month board has a fixed eleven-query and 34,450-row ceiling', () => {
	const receipt = monthBoardQueryReceipt(normalInput);

	assert.equal(MONTH_BOARD_NORMAL_QUERY_CEILING, 11);
	assert.equal(MONTH_BOARD_NORMAL_ROW_BOUND, 34_450);
	assert.equal(receipt.queryCount, 11);
	assert.equal(receipt.rowBound, 34_450);
	assert.equal(receipt.perEmployeeQueryCount, 0);
	assert.equal(receipt.perDayQueryCount, 0);
	assert.equal(receipt.matrixCellCount, 1_302);
	assert.deepEqual(
		receipt.sources.map(({ source }) => source),
		[
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

	assert.equal(MONTH_BOARD_INTERACTIVE_QUERY_CEILING, 12);
	assert.equal(MONTH_BOARD_INTERACTIVE_ROW_BOUND, 44_450);
	assert.equal(receipt.queryCount, 12);
	assert.equal(receipt.rowBound, 44_450);
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
			sources: [],
			queryCount: 0,
			rowBound: 0,
			loadedRowCount: 0,
			matrixCellCount: 0,
			normalQueryCeiling: 11,
			normalRowBound: 34_450,
			interactiveQueryCeiling: 12,
			interactiveRowBound: 44_450,
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
	assert.equal(companyWithoutActivePeople.queryCount, 6);
	assert.equal(companyWithoutActivePeople.rowBound, 2_450);

	const activePeopleWithoutRows = monthBoardQueryReceipt({
		...normalInput,
		workDayCount: 0
	});
	assert.equal(activePeopleWithoutRows.queryCount, 10);
	assert.equal(activePeopleWithoutRows.rowBound, 24_450);
});

test('the receipt totals observed rows and exposes sources that reach their configured bound', () => {
	const receipt = monthBoardQueryReceipt({
		...normalInput,
		loadedRows: {
			employments: 42,
			employees: 42,
			workDays: MONTH_BOARD_QUERY_LIMITS.workDays,
			settlementClaims: 7
		}
	});

	assert.equal(receipt.loadedRowCount, 10_091);
	assert.equal(receipt.sources.find(({ source }) => source === 'workDays')?.atBound, true);
	assert.equal(receipt.sources.find(({ source }) => source === 'employees')?.atBound, false);
});

test('a live work_days mask always carries id and row_version even when the caller omits them', () => {
	const stamped = monthBoardWorkDayLiveColumns({
		employment_id: true,
		work_date: true
	});

	assert.equal(stamped.id, true);
	assert.equal(stamped.row_version, true);
	assert.equal(stamped.employment_id, true);
	assert.equal(stamped.work_date, true);
});

test('both month-board work_days prefixes project the whole-row base version and keep their own fields', () => {
	assert.equal(MONTH_BOARD_WORK_DAY_COLUMNS.id, true);
	assert.equal(MONTH_BOARD_WORK_DAY_COLUMNS.row_version, true);
	assert.equal(MONTH_BOARD_WORK_DAY_COLUMNS.employment_id, true);
	assert.equal(MONTH_BOARD_WORK_DAY_COLUMNS.work_date, true);
	assert.equal(MONTH_BOARD_WORK_DAY_COLUMNS.shift_definition_id, true);
	assert.equal(MONTH_BOARD_WORK_DAY_COLUMNS.roster_id, true);
	assert.equal(MONTH_BOARD_WORK_DAY_COLUMNS.assignment_code, true);
	assert.equal(MONTH_BOARD_WORK_DAY_COLUMNS.planned_origin, true);
	assert.equal(MONTH_BOARD_WORK_DAY_COLUMNS.planned_note, true);
	assert.equal(MONTH_BOARD_WORK_DAY_COLUMNS.worked_intervals, true);
	assert.equal(MONTH_BOARD_WORK_DAY_COLUMNS.break_minutes, true);

	assert.equal(MONTH_BOARD_FILTERED_WORK_DAY_COLUMNS.id, true);
	assert.equal(MONTH_BOARD_FILTERED_WORK_DAY_COLUMNS.row_version, true);
	assert.equal(MONTH_BOARD_FILTERED_WORK_DAY_COLUMNS.employment_id, true);
	assert.equal(MONTH_BOARD_FILTERED_WORK_DAY_COLUMNS.work_date, true);
	assert.equal(MONTH_BOARD_FILTERED_WORK_DAY_COLUMNS.shift_definition_id, true);
	assert.equal(MONTH_BOARD_FILTERED_WORK_DAY_COLUMNS.assignment_code, true);
	assert.equal('roster_id' in MONTH_BOARD_FILTERED_WORK_DAY_COLUMNS, false);
	assert.equal('worked_intervals' in MONTH_BOARD_FILTERED_WORK_DAY_COLUMNS, false);
	assert.equal('break_minutes' in MONTH_BOARD_FILTERED_WORK_DAY_COLUMNS, false);
});
