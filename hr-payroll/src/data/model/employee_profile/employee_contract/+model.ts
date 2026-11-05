import { Effect } from 'effect';
import { model } from '@norbital-ai/bolt';
import { dynamicRead } from '@norbital-ai/bolt/protocol';
import { isJsonObject, jsonObject } from '../../../../lib/payroll_engine/foundation.js';
import { validateRegistered } from '../../../../lib/payroll_engine/registrations.js';
import { queryRows, type Reader } from '../../../../lib/payroll_engine/reads.js';
import { tap } from '../../../../lib/payroll_engine/taps.js';

/** What a writer may set; the contract number, seal stamps and the derived label are server-owned. */
const columns = [
	'employee_id',
	'entity_id',
	'engagement',
	'employee_number',
	'effective_range',
	'service_started_on',
	'signed_contract_period',
	'final_pay_due_on',
	'terms',
	'payroll',
	'bank',
	'input_schema_version_id',
	'employee_extension_data',
	'reason',
	'status'
] as const;

/** A finalised run captures the contract terms it calculated; no change may reach that period afterwards. */
const capturedRun = Effect.fnUntraced(function* (
	read: Reader,
	rows: readonly {
		readonly entity_id: string;
		readonly effective_range: { readonly from: string; readonly to: string | null };
	}[]
) {
	if (rows.length === 0) return null;
	const entityIds = [...new Set(rows.map((row) => row.entity_id))];
	const runs = yield* queryRows(read, {
		payroll_run: {
			where: { entity_id: { in: entityIds } },
			fields: ['id', 'entity_id', 'salary_coverage', 'run_number'],
			limit: 10000
		}
	});
	for (const row of rows) {
		const captured = runs.payroll_run?.find((run) => {
			const coverage = run.salary_coverage as { from?: string; to?: string | null } | null;
			if (coverage?.from == null || run.entity_id !== row.entity_id) return false;
			const to = coverage.to ?? null;
			return (
				row.effective_range.from <= (to ?? '9999-12-31') &&
				(row.effective_range.to === null || row.effective_range.to >= coverage.from)
			);
		});
		if (captured !== undefined)
			return `Payroll run ${String(captured.run_number)} already captured this period; the contract cannot change under it.`;
	}
	return null;
});

export default model('employee_contract', {
	description:
		'Sealed employment terms. A dated replacement changes future terms; consumed historical terms remain protected.',
	label: ['employee_name', 'employee_number'],
	fields: {
		employee_id: {
			kind: 'ref',
			to: 'employee_profile',
			inverse: 'employee_contract'
		},
		entity_id: { kind: 'ref', to: 'entity', inverse: 'employee_contract' },
		employee_number: { kind: 'text' },
		// the person's name, kept here so every picker and link names the employment by its person
		employee_name: {
			kind: 'text',
			optional: true,
			hidden: true
		},

		engagement: {
			kind: 'enum',
			values: [
				'EMPLOYEE',
				'PART_TIME',
				'CONTRACTOR',
				'INTERN',
				'APPRENTICE',
				'CONSULTANT',
				'PAYEE'
			],
			default: 'EMPLOYEE',
			help: 'The contracted role. PAYEE is paid without employment (a commission agent), outside the headcount and separations.'
		},
		status: {
			kind: 'state',
			initial: 'DRAFT',
			states: {
				DRAFT: { to: ['SEALED'], edit: 'all' },
				SEALED: {
					to: ['VOID'],
					edit: ['effective_range', 'final_pay_due_on', 'reason', 'employee_name']
				},
				VOID: { to: [], edit: 'none' }
			}
		},
		effective_range: {
			kind: 'period',
			of: 'date',
			help: 'The dates this agreement applies. A replacement contract continues employment; ending it records a reason.'
		},
		service_started_on: {
			kind: 'date',
			optional: true,
			help: 'The date service began for leave and benefit entitlements. A same-jurisdiction replacement keeps the predecessor date; a cross-jurisdiction replacement starts new statutory service.'
		},
		signed_contract_period: { kind: 'period', of: 'date', optional: true },
		terms: {
			kind: 'object',
			fields: {
				signed_on: {
					kind: 'date',
					optional: true,
					help: 'The actual date this employment agreement was signed.'
				},
				probation_period: {
					kind: 'period',
					of: 'date',
					optional: true,
					help: 'The original agreed probation dates. Salary amendments retain these dates; they do not start another probation.'
				},
				rate: {
					kind: 'object',
					optional: true,
					fields: {
						amount: { kind: 'number', min: 0 },
						unit: { kind: 'enum', values: ['MONTHLY', 'DAILY', 'HOURLY', 'PIECE'] }
					}
				},
				normal_hours_per_day: { kind: 'number', optional: true },
				normal_hours_per_week: { kind: 'number', optional: true },
				normal_days_per_week: { kind: 'number', min: 0, max: 7, optional: true },
				employer_bears_income_tax: {
					kind: 'bool',
					optional: true,
					help: 'The agreement makes the employer bear the employee’s income tax. The jurisdiction formula determines any required gross-up.'
				},
				job_title: { kind: 'text', optional: true },
				department: { kind: 'text', optional: true },
				statutory_work_category: { kind: 'text', optional: true },
				work_classification: { kind: 'text', optional: true },
				residency_status: { kind: 'text', optional: true },
				work_authorisation_category: { kind: 'text', optional: true },
				shift_pattern_id: { kind: 'id', of: 'shift_pattern', optional: true },
				notice_period: {
					kind: 'object',
					optional: true,
					fields: {
						value: { kind: 'number', min: 0 },
						unit: { kind: 'enum', values: ['DAYS', 'WEEKS', 'MONTHS'] }
					}
				},
				annual_leave_carry_limit_days: {
					kind: 'number',
					min: 0,
					optional: true,
					help: 'An agreed contractual limit for carrying annual leave into the next leave year.'
				},
				wage_payment_method: {
					kind: 'enum',
					values: ['BANK', 'CASH', 'CHEQUE', 'DIGITAL'],
					optional: true
				},
				allowances: {
					kind: 'record',
					optional: true,
					of: { kind: 'record', of: { kind: 'json' } }
				}
			}
		},
		// person identity the jurisdiction formulas read; the profile owns contact details and the display name
		payroll: {
			kind: 'object',
			fields: {
				date_of_birth: { kind: 'date', optional: true },
				identity_number: { kind: 'text', optional: true },
				gender: { kind: 'enum', values: ['MALE', 'FEMALE'], optional: true },
				marital_status: {
					kind: 'enum',
					values: ['SINGLE', 'MARRIED', 'SEPARATED', 'DIVORCED', 'WIDOWED'],
					optional: true
				}
			},
			optional: true,
			label: 'Person details'
		},
		bank: { kind: 'custom', of: 'bank', optional: true },
		final_pay_due_on: {
			kind: 'date',
			optional: true,
			help: 'The actual contractual date the final settlement becomes payable. This differs from the maximum statutory deadline and the run’s actual payment date.'
		},
		input_schema_version_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'employee_contract',
			onDelete: 'restrict',
			where: { status: { eq: 'SEALED' } }
		},
		reason: {
			kind: 'text',
			optional: true,
			help: 'Why this record was voided or the employment ended.'
		},
		employee_extension_data: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			default: {},
			help: "The employee data the jurisdiction's employee extension schema declares."
		}
	},
	noOverlap: [
		{
			key: ['employee_id'],
			period: 'effective_range',
			where: { status: { eq: 'SEALED' } }
		}
	],
	read: {
		employee_contract: { fields: 'all' },
		'employee_contract.employee_id': { fields: 'all' },
		'employee_contract.entity_id': { fields: 'all' },
		'employee_contract.input_schema_version_id': { fields: 'all' },
		'employee_contract.leave_catalog_entry': { fields: 'all' }
	},
	outputs: {
		kiosk: {
			employee_contract: {
				fields: [
					'employee_id',
					'entity_id',
					'employee_number',
					'effective_range',
					'terms',
					'status'
				]
			}
		}
	},
	create: {
		columns: { employee_contract: columns },
		filled: { employee_contract: ['employee_number'] },
		transform: function* (rows, ctx) {
			const captured = yield* capturedRun(ctx.db.query, rows);
			if (captured !== null) return yield* ctx.refuse(captured, { field: 'effective_range' });
			yield* validateRegistered(
				ctx.db.query,
				'employee_contract',
				'create',
				rows.map((row) => jsonObject(row))
			);
			const ids = [...new Set(rows.map((row) => row.input_schema_version_id))];
			const settings = yield* ctx.db.query({
				jurisdiction_settings: { where: { id: { in: ids } }, fields: ['lookup'], limit: 10000 }
			});
			const allowed = new Map(
				settings.jurisdiction_settings.rows.map((row) => {
					const lookup = row.lookup;
					const categories =
						lookup !== null && typeof lookup === 'object' && !Array.isArray(lookup)
							? lookup.statutory_work_categories
							: undefined;
					return [
						String(row.id),
						Array.isArray(categories)
							? new Set(categories.filter((value): value is string => typeof value === 'string'))
							: undefined
					] as const;
				})
			);
			for (const row of rows) {
				const category = row.terms?.statutory_work_category;
				if (category == null) continue;
				const declared = allowed.get(String(row.input_schema_version_id));
				if (declared !== undefined && !declared.has(category))
					return yield* ctx.refuse(`Choose one of the jurisdiction's statutory work categories.`, {
						field: 'terms'
					});
			}
			const employeeIds = [...new Set(rows.map((row) => row.employee_id))];
			const held = yield* ctx.db.query({
				employee_contract: {
					where: { employee_id: { in: employeeIds } },
					fields: ['employee_id', 'employee_number'],
					limit: 10000
				}
			});
			const existing = yield* ctx.db.query({
				employee_contract: { fields: ['employee_number'], limit: 10000 }
			});
			const numbers = new Map(
				held.employee_contract.rows.map((row) => [String(row.employee_id), row.employee_number])
			);
			let next =
				existing.employee_contract.rows.reduce((max, row) => {
					const match = /^HR-(\d+)$/.exec(String(row.employee_number ?? ''));
					return match === null ? max : Math.max(max, Number(match[1] ?? 0));
				}, 0) + 1;
			const assigned = new Map<string, string>();
			const reference = (value: number) => `HR-${String(value).padStart(4, '0')}`;
			return rows.map((row) => {
				if (row.employee_number != null && row.employee_number !== '') return row;
				const employee = String(row.employee_id);
				const heldNumber = numbers.get(employee);
				if (heldNumber != null && heldNumber !== '') return { ...row, employee_number: heldNumber };
				const assignedNumber = assigned.get(employee);
				if (assignedNumber !== undefined) return { ...row, employee_number: assignedNumber };
				const number = reference(next++);
				assigned.set(employee, number);
				return { ...row, employee_number: number };
			});
		}
	},
	update: {
		columns: {
			employee_contract: [
				...columns.filter((field) => field !== 'employee_number'),
				'employee_name'
			]
		},
		transform: function* (changes, ctx) {
			// a captured contract may still be voided; only substantive changes are barred
			const substantive = changes.filter(
				({ before, set }) => !(before.status === 'SEALED' && set.status === 'VOID')
			);
			let captured: string | null = null;
			if (substantive.length > 0)
				captured = yield* capturedRun(
					ctx.db.query,
					substantive.map(({ before, set }) => ({ ...before, ...set }))
				);
			if (captured !== null) return yield* ctx.refuse(captured, { field: 'effective_range' });
			yield* validateRegistered(
				ctx.db.query,
				'employee_contract',
				'update',
				substantive.map((change) => jsonObject({ ...change.before, ...change.set }))
			);
			const ids = [...new Set(changes.map((change) => change.before.input_schema_version_id))];
			const settings = yield* ctx.db.query({
				jurisdiction_settings: { where: { id: { in: ids } }, fields: ['lookup'], limit: 10000 }
			});
			const allowed = new Map(
				settings.jurisdiction_settings.rows.map((row) => {
					const lookup = row.lookup;
					const categories =
						lookup !== null && typeof lookup === 'object' && !Array.isArray(lookup)
							? lookup.statutory_work_categories
							: undefined;
					return [
						String(row.id),
						Array.isArray(categories)
							? new Set(categories.filter((value): value is string => typeof value === 'string'))
							: undefined
					] as const;
				})
			);
			for (const { before, set } of substantive) {
				const terms = { ...before.terms, ...set.terms };
				const category = terms.statutory_work_category;
				if (typeof category !== 'string') continue;
				const declared = allowed.get(String(before.input_schema_version_id));
				if (declared !== undefined && !declared.has(category))
					return yield* ctx.refuse(`Choose one of the jurisdiction's statutory work categories.`, {
						field: 'terms'
					});
			}
			for (const { set } of changes) {
				if (set.status === 'VOID' && !set.reason?.trim())
					return yield* ctx.refuse('Record why this contract is void.');
			}
			return changes.map(({ set }) => set);
		}
	},
	effect: {
		created: function* (rows, ctx) {
			const ids = [...new Set(rows.map((row) => row.employee_id))];
			const existing = yield* ctx.query({
				employee_balance: {
					where: { employee_id: { in: ids } },
					fields: ['employee_id'],
					limit: 10000
				}
			});
			const held = new Set(existing.employee_balance.rows.map((row) => row.employee_id));
			const missing = new Map(
				rows
					.filter((row) => !held.has(row.employee_id))
					.map((row) => [row.employee_id, { employee_id: row.employee_id, account: {} }])
			);
			if (missing.size > 0)
				yield* ctx.act.checked([
					{ callable: 'employee_balance.create', input: [...missing.values()] }
				]);
			yield* tap(
				ctx,
				'create',
				{ collection: 'employee_contract', ids: rows.map((r) => r.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			for (const change of changes) {
				const row = { ...change.before, ...change.after } as Record<string, unknown>;
				const range: unknown = row.effective_range;
				const effectiveTo =
					typeof range === 'string'
						? (() => {
								const inner = range.startsWith('[') ? range.slice(1, -1) : range;
								const at = inner.indexOf(',');
								return at < 0 ? null : inner.slice(at + 1).replace(/\)$/, '') || null;
							})()
						: isJsonObject(range) && typeof range.to === 'string'
							? range.to
							: null;
				if (row.status !== 'SEALED' || effectiveTo == null) continue;
				const extension = isJsonObject(row.employee_extension_data)
					? row.employee_extension_data
					: {};
				const exitFacts = isJsonObject(extension.exit_facts) ? extension.exit_facts : {};
				if (exitFacts.misconduct_dismissal === true) continue;
				const settingsId = isJsonObject(row.input_schema_version_id)
					? row.input_schema_version_id.id
					: row.input_schema_version_id;
				if (typeof settingsId !== 'string') continue;
				const lineage = yield* ctx.query(
					dynamicRead({
						jurisdiction_settings: {
							where: { id: { eq: settingsId } },
							fields: ['code'] as const,
							limit: 1
						}
					})
				);
				const code = lineage.jurisdiction_settings?.rows?.[0]?.code;
				const contracts = yield* ctx.query(
					dynamicRead({
						employee_contract: {
							where: { employee_id: { eq: String(row.employee_id) } },
							fields: ['id', 'status', 'effective_range', 'input_schema_version_id'] as const,
							limit: 10000
						}
					})
				);
				const successors = (contracts.employee_contract?.rows ?? []).filter((other) => {
					if (String(other.id) === String(row.id)) return false;
					if (other.status !== 'DRAFT' && other.status !== 'SEALED') return false;
					const successor = other.effective_range;
					return (
						isJsonObject(successor) &&
						typeof successor.from === 'string' &&
						successor.from > effectiveTo
					);
				});
				let sameJurisdiction = false;
				if (successors.length > 0) {
					const ids = [
						...new Set(
							successors
								.map((other) => {
									const value = other.input_schema_version_id;
									return isJsonObject(value) ? value.id : value;
								})
								.filter((value): value is string => typeof value === 'string')
						)
					];
					if (ids.length > 0) {
						const settings = yield* ctx.query(
							dynamicRead({
								jurisdiction_settings: {
									where: { id: { in: ids } },
									fields: ['id', 'code'] as const,
									limit: 10000
								}
							})
						);
						const codes = new Map(
							(settings.jurisdiction_settings?.rows ?? []).map((settingsRow) => [
								String(settingsRow.id),
								settingsRow.code
							])
						);
						sameJurisdiction = successors.some((other) => {
							const value = other.input_schema_version_id;
							const id = isJsonObject(value) ? value.id : value;
							return typeof code === 'string' && typeof id === 'string' && codes.get(id) === code;
						});
					}
				}
				// a same-jurisdiction replacement continues employment; a cross-jurisdiction transfer settles leave first
				if (sameJurisdiction) continue;
				const versions =
					typeof code !== 'string'
						? []
						: ((yield* ctx.query(
								dynamicRead({
									jurisdiction_settings: {
										where: { code: { eq: code }, status: { eq: 'SEALED' } },
										fields: ['id', 'effective_range'] as const,
										limit: 10000
									}
								})
							)).jurisdiction_settings?.rows ?? []);
				const current = versions.find((version) => {
					const range = version.effective_range;
					return (
						isJsonObject(range) &&
						typeof range.from === 'string' &&
						range.from <= effectiveTo &&
						(range.to == null || String(range.to) >= effectiveTo)
					);
				});
				const catalogSettingsId =
					current !== undefined && typeof current.id === 'string' ? current.id : settingsId;
				const catalogs = yield* ctx.query(
					dynamicRead({
						leave_catalog: {
							where: { code: { eq: 'ANNUAL_LEAVE' }, settings_id: { eq: catalogSettingsId } },
							fields: ['id', 'lookup'] as const,
							limit: 1
						}
					})
				);
				const catalog = catalogs.leave_catalog?.rows?.[0];
				if (
					catalog === undefined ||
					!isJsonObject(catalog.lookup) ||
					!isJsonObject(catalog.lookup.encash_on_exit) ||
					catalog.lookup.encash_on_exit.allowed !== true
				)
					continue;
				const held = yield* ctx.query(
					dynamicRead({
						leave_catalog_entry: {
							where: { employment_id: { eq: String(row.id) }, encashment: { eq: true } },
							fields: ['id'] as const,
							limit: 1
						}
					})
				);
				if ((held.leave_catalog_entry?.rows ?? []).length > 0) continue;
				const balances = yield* ctx.query(
					dynamicRead({
						employee_balance: {
							where: { employee_id: { eq: String(row.employee_id) } },
							fields: ['account'] as const,
							limit: 1
						}
					})
				);
				const account = balances.employee_balance?.rows?.[0]?.account;
				const leave = isJsonObject(account) && isJsonObject(account.leave) ? account.leave : {};
				const days = Number(leave.ANNUAL_LEAVE ?? 0);
				if (!Number.isFinite(days) || days <= 0) continue;
				const employer = yield* ctx.query(
					dynamicRead({
						entity_profile_version: {
							where: { entity_id: { eq: String(row.entity_id) }, status: { eq: 'SEALED' } },
							fields: ['pay_cutoff_day'] as const,
							limit: 1
						}
					})
				);
				const cutoff = Number(employer.entity_profile_version?.rows?.[0]?.pay_cutoff_day ?? 1);
				const day = Math.min(Number(effectiveTo.slice(8, 10)), cutoff);
				const date = `${effectiveTo.slice(0, 7)}-${String(day).padStart(2, '0')}`;
				const halfDays = Math.max(1, Math.round(days * 2));
				yield* ctx.act.checked([
					{
						callable: 'leave_catalog_entry.create',
						input: [
							{
								entity_id: String(row.entity_id),
								employment_id: String(row.id),
								catalog_id: String(catalog.id),
								encashment: true,
								days: Array.from({ length: halfDays }, (_, index) => ({
									date,
									part: index % 2 === 0 ? 'AM' : 'PM'
								}))
							}
						]
					}
				]);
			}
			yield* tap(
				ctx,
				'update',
				{ collection: 'employee_contract', ids: changes.map((c) => c.after.id) },
				changes
			);
		}
	}
});
