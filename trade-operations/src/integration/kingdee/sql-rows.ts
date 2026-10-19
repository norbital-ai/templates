/** Delta positions stay ordered; current values avoid rewinding a newer initial snapshot. */
export function sqlRows(
	table: string,
	columns: readonly string[],
	archiveDeletes = false,
	key = 'external_code',
	statusDeletes = false
) {
	const current = (column: string) =>
		`CASE WHEN current_row.[${key}] IS NOT NULL THEN current_row.[${column}] WHEN tombstone.[${key}] IS NOT NULL THEN tombstone.[${column}] ELSE delta.[${column}] END`;
	const deleted = `current_row.[${key}] IS NULL AND COALESCE(tombstone.__$operation,delta.__$operation)=1`;
	const changed = columns
		.map((column) =>
			archiveDeletes && column === 'active'
				? `CASE WHEN ${deleted} THEN CAST(0 AS bit) ELSE ${current(column)} END AS [active]`
				: statusDeletes && column === 'status'
					? `CASE WHEN ${deleted} THEN 'void' ELSE ${current(column)} END AS [status]`
					: `${current(column)} AS [${column}]`
		)
		.join(', ');
	const operation = `CASE WHEN ${deleted} THEN ${archiveDeletes || statusDeletes ? 4 : 1} WHEN delta.__$operation=1 THEN 4 ELSE delta.__$operation END AS __$operation`;
	return {
		snapshot: `SELECT [${key}] AS __key, ${columns.map((column) => `[${column}]`).join(', ')} FROM colony.[${table}]`,
		changes: `SELECT delta.[${key}] AS __key, delta.[${key}] AS __event_key, ${changed}, delta.__$start_lsn, delta.__$seqval, ${operation}
   FROM cdc.fn_cdc_get_all_changes_colony_${table}(@from_lsn,@to_lsn,'all') delta
   LEFT JOIN colony.[${table}] current_row ON current_row.[${key}]=delta.[${key}]
   OUTER APPLY (SELECT TOP (1) * FROM cdc.colony_${table}_CT retained WHERE current_row.[${key}] IS NULL AND retained.[${key}]=delta.[${key}]
    ORDER BY retained.__$start_lsn DESC,retained.__$seqval DESC,retained.__$operation DESC) tombstone`,
		captures: [`colony_${table}`],
		columns
	};
}
