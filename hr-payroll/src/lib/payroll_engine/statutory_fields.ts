export const STATUTORY_FIELDS = {
	settings: {
		suspension_kinds: {
			kind: 'custom',
			of: 'suspension_kinds',
			default: []
		},
		code: {
			kind: 'text'
		},
		jurisdiction_code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		employee_input_schema: {
			kind: 'json',
			optional: true
		},
		entity_input_schema: {
			kind: 'json',
			optional: true
		},
		behaviours: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					version: { kind: 'int' },
					rules: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								id: { kind: 'text' },
								catalog: { kind: 'text', optional: true },
								target_collection: { kind: 'text', optional: true },
								events: { kind: 'list', of: { kind: 'text' } },
								when: { kind: 'text', format: 'cel', optional: true },
								fields: { kind: 'list', of: { kind: 'text' }, optional: true },
								reads: { kind: 'record', of: { kind: 'json' }, optional: true },
								effect: { kind: 'text', format: 'cel', optional: true }
							}
						}
					}
				}
			},
			default: {
				version: 1,
				rules: []
			}
		},
		sealed_at: {
			kind: 'instant',
			optional: true
		},
		voided_at: {
			kind: 'instant',
			optional: true
		},
		void_reason: {
			kind: 'text',
			optional: true
		},
		reference_tables: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			optional: true
		},
		payroll: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					currency: { kind: 'text', optional: true },
					timezone: { kind: 'text', optional: true },
					tax_year_start_month: { kind: 'int', optional: true },
					minor_units: { kind: 'int', min: 0, max: 4, optional: true },
					rolling_hours_months: { kind: 'int', min: 1, optional: true },
					history_months: { kind: 'int', min: 1, optional: true },
					pay_date: { kind: 'text', format: 'cel', optional: true },
					week_start: { kind: 'int', min: 0, max: 6, optional: true },
					semi_monthly_split: { kind: 'int', min: 1, max: 27, optional: true },
					roster_week: { kind: 'enum', values: ['ROLLING', 'CALENDAR'], optional: true },
					base_salary_required: { kind: 'bool', optional: true },
					off_cycle_families: { kind: 'list', of: { kind: 'text' }, optional: true },
					monthly_wage: { kind: 'text', format: 'cel', optional: true },
					negative_net: { kind: 'enum', values: ['refuse', 'allow'], optional: true }
				}
			}
		},
		change_summary: {
			kind: 'text',
			optional: true
		},
		effective_range: {
			kind: 'period',
			of: 'date'
		},
		sources: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					entries: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								url: { kind: 'text', format: 'url' },
								instructions: { kind: 'text' },
								document_origins: {
									kind: 'list',
									of: { kind: 'text', format: 'url' },
									optional: true
								}
							}
						}
					},
					instructions: {
						kind: 'text',
						optional: true
					}
				}
			}
		}
	},
	adhoc_catalog: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text',
			optional: true
		},
		authority: {
			kind: 'text',
			optional: true
		},
		destination: {
			kind: 'enum',
			values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY']
		},
		direction: {
			kind: 'enum',
			values: ['ADD', 'SUBTRACT'],
			optional: true
		},
		bands: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						when: {
							kind: 'text',
							format: 'cel'
						},
						amount: {
							kind: 'text',
							format: 'cel'
						},
						limit: {
							kind: 'object',
							optional: true,
							fields: {
								on_exceed: {
									kind: 'enum',
									values: ['BLOCK', 'CAP', 'ALLOW']
								},
								amount: {
									kind: 'text',
									format: 'cel'
								}
							}
						}
					}
				}
			}
		},
		eligibility: {
			kind: 'text',
			format: 'cel',
			default: ''
		},
		qualifies_when: {
			kind: 'text',
			format: 'cel',
			optional: true
		},
		amount_required: {
			kind: 'bool',
			default: true,
			help: 'An entry must carry an amount; a class priced by its bands alone (piece units) need not.'
		},
		counts_toward: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'text'
				}
			}
		},
		raise_on_exit: {
			kind: 'bool',
			default: false,
			help: 'The final slip raises this class itself when its eligibility holds on the exit (termination benefit, severance, notice in lieu), priced by its bands on an empty entry of the exit day; an entry of the class HR makes instead wins. A moved or undone exit takes it back.'
		},
		payable_after_exit: {
			kind: 'bool',
			default: false,
			help: 'Entries of this class may fall after the employment ends (non-compete pay, instalments of a separation payment) and are paid on a payslip of their own period.'
		}
	},
	allowance_catalog: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text',
			optional: true
		},
		eligibility: {
			kind: 'text',
			format: 'cel'
		},
		amount: {
			kind: 'text',
			format: 'cel',
			optional: true,
			help: 'CEL amount over the payslip context; `allowance.amount` is the contract’s monthly figure.'
		},
		authority: {
			kind: 'text',
			optional: true
		},
		counts_toward: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'text'
				}
			},
			default: []
		},
		destination: {
			kind: 'enum',
			values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY']
		},
		direction: {
			kind: 'enum',
			values: ['ADD', 'SUBTRACT']
		}
	},
	claim_catalog: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text',
			optional: true
		},
		authority: {
			kind: 'text',
			optional: true
		},
		destination: {
			kind: 'enum',
			values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY']
		},
		direction: {
			kind: 'enum',
			values: ['ADD', 'SUBTRACT'],
			optional: true
		},
		bands: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						when: {
							kind: 'text',
							format: 'cel'
						},
						amount: {
							kind: 'text',
							format: 'cel'
						},
						limit: {
							kind: 'object',
							optional: true,
							fields: {
								on_exceed: {
									kind: 'enum',
									values: ['BLOCK', 'CAP', 'ALLOW'],
									help: 'BLOCK pays up to the limit, ALLOW pays all; either flags the excess on the run.'
								},
								amount: {
									kind: 'text',
									format: 'cel'
								},
								window: {
									kind: 'enum',
									values: ['ENTRY', 'PERIOD', 'CALENDAR_YEAR'],
									optional: true,
									help: 'What the limit meters: each claim alone (default), or the settlement period or calendar year less the claims of the class already taken in it.'
								}
							}
						}
					}
				}
			}
		},
		eligibility: {
			kind: 'text',
			format: 'cel',
			default: ''
		},
		qualifies_when: {
			kind: 'text',
			format: 'cel',
			default: ''
		},
		amount_required: {
			kind: 'bool',
			default: true,
			help: 'An entry must carry an amount; a class priced by its bands alone (piece units) need not.'
		},
		counts_toward: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'text'
				}
			}
		}
	},
	leave_catalog: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		description: {
			kind: 'text',
			optional: true
		},
		authority: {
			kind: 'text',
			optional: true
		},
		eligibility: {
			kind: 'text',
			format: 'cel',
			default: ''
		},
		unit: {
			kind: 'enum',
			values: ['DAY', 'CALENDAR_DAY', 'HOUR'],
			default: 'DAY',
			help: 'What a request charges: DAY the planned working days of its range (rest and off days and published holidays charge nothing), CALENDAR_DAY every day of it, HOUR the scheduled hours of its planned working days.'
		},
		can_encash: {
			kind: 'bool',
			help: 'Whether untaken days of the class may be paid out. Stated on every class: no default decides it.'
		},
		encash_on_exit: {
			kind: 'bool',
			default: false
		},
		encash_at_window_end: {
			kind: 'bool',
			default: false,
			help: 'On the last day of the class’s window (a calendar or service year), its untaken balance is encashed as on exit.'
		},
		entitlement: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					unit: { kind: 'text', optional: true },
					days: {
						kind: 'text',
						format: 'cel',
						optional: true,
						help: 'CEL entitlement in days over `service_months`, `bands`, `as_of`, the subject roots and `taken`; absent means the class is not metered.'
					},
					window: {
						kind: 'enum',
						values: ['CALENDAR_YEAR', 'SERVICE_YEAR', 'LIFETIME', 'EVENT', 'ROLLING'],
						optional: true,
						help: 'The span the balance is metered over; absent means LIFETIME. EVENT meters each entry.facts.event_id (or window_key) on its own; ROLLING the window_months ending on the day read.'
					},
					window_months: {
						kind: 'int',
						optional: true,
						help: 'ROLLING: the months the window reaches back from the day read (that day included).'
					},
					service_year_offset_months: {
						kind: 'int',
						optional: true,
						help: 'SERVICE_YEAR: months after the employment start the first service year begins.'
					},
					window_key: {
						kind: 'text',
						format: 'cel',
						optional: true,
						help: 'CEL over `entry` (the movement’s columns and facts) naming the EVENT window a movement counts in, e.g. `entry.facts.child_id`; absent means entry.facts.event_id.'
					},
					carry_forward: {
						kind: 'text',
						format: 'cel',
						optional: true,
						help: 'CEL on the previous window: the most unused days carried into the next CALENDAR_YEAR or SERVICE_YEAR window; absent carries nothing.'
					},
					carry_depth: {
						kind: 'int',
						optional: true,
						help: 'How many windows carried days may still be carried (absent: once).'
					},
					consumes_after_days: {
						kind: 'int',
						optional: true,
						help: 'With consumes_code: the first N units of the class (in the pool’s window) are its own; only those past N draw on the pool.'
					},
					hours_per_day: {
						kind: 'text',
						format: 'cel',
						optional: true,
						help: 'With consumes_code and a non-day unit: CEL over the subject, the units one pool day holds.'
					},
					bands: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								service_months: { kind: 'int' },
								days: { kind: 'int' }
							}
						},
						optional: true
					}
				}
			},
			optional: true
		},
		is_npl: {
			kind: 'bool',
			default: false
		},
		pay_fraction: {
			kind: 'text',
			format: 'cel',
			default: ''
		},
		share_by: {
			kind: 'enum',
			values: ['WORKING_DAYS', 'CALENDAR_DAYS'],
			default: 'WORKING_DAYS',
			help: 'How a leave row spanning pay periods is shared between them.'
		},
		consumes_code: {
			kind: 'text',
			optional: true
		}
	},
	loan_catalog: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text',
			optional: true
		},
		authority: {
			kind: 'text',
			optional: true
		},
		destination: {
			kind: 'enum',
			values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY'],
			default: 'NET'
		},
		direction: {
			kind: 'enum',
			values: ['ADD', 'SUBTRACT'],
			default: 'SUBTRACT',
			optional: true
		},
		bands: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						when: {
							kind: 'text',
							format: 'cel'
						},
						amount: {
							kind: 'text',
							format: 'cel'
						},
						limit: {
							kind: 'object',
							optional: true,
							fields: {
								on_exceed: {
									kind: 'enum',
									values: ['BLOCK', 'CAP', 'ALLOW']
								},
								amount: {
									kind: 'text',
									format: 'cel'
								}
							}
						}
					}
				}
			}
		},
		eligibility: {
			kind: 'text',
			format: 'cel',
			default: ''
		},
		amount_required: {
			kind: 'bool',
			default: true,
			help: 'An entry must carry an amount; a class priced by its bands alone (piece units) need not.'
		}
	},
	work_catalog: {
		code: { kind: 'text' },
		name: { kind: 'text', optional: true },
		authority: { kind: 'text', format: 'markdown', optional: true },
		component_code: { kind: 'text' },
		eligibility: {
			kind: 'text',
			format: 'cel',
			help: 'CEL predicate over the payslip context; the line is produced only when it holds.'
		},
		quantity: { kind: 'text', format: 'cel', help: 'CEL quantity over the payslip context.' },
		rate: { kind: 'text', format: 'cel', help: 'CEL rate over the payslip context.' },
		prorated: {
			kind: 'bool',
			default: false,
			help: 'The line is the contract amount scaled to the days employed; the payslip records its proration.'
		},
		denominator: {
			kind: 'text',
			format: 'cel',
			optional: true,
			help: 'CEL: the divisor a prorated line states on the payslip (blank: the period’s calendar days).'
		},
		destination: { kind: 'enum', values: ['PAY', 'NET', 'EMPLOYER'] },
		direction: { kind: 'enum', values: ['ADD', 'SUBTRACT'] },
		counts_toward: { kind: 'json', shape: { kind: 'list', of: { kind: 'text' } }, default: [] }
	},
	statutory_contribution_catalog: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		authority: {
			kind: 'text',
			optional: true
		},
		configuration: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					assess_without_wage: { kind: 'bool', optional: true },
					carry_uncovered: { kind: 'bool', optional: true },
					governed_by: { kind: 'text', optional: true },
					order: { kind: 'number', optional: true },
					as_of: { kind: 'text', optional: true },
					annual_reconciliation: {
						kind: 'object',
						optional: true,
						fields: {
							when: { kind: 'text', format: 'cel' },
							part: { kind: 'text' },
							ceiling: { kind: 'text', format: 'cel' },
							through: { kind: 'text', format: 'cel' }
						}
					},
					warn_when: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: { when: { kind: 'text', format: 'cel' }, message: { kind: 'text' } }
						},
						optional: true
					},
					person: {
						kind: 'record',
						of: { kind: 'text', format: 'cel' },
						optional: true,
						help: 'Person facts this scheme reads, each a CEL expression over the statutory context (for example the age basis), merged into `person`.'
					},
					assessable: {
						kind: 'record',
						of: { kind: 'text', format: 'cel' },
						optional: true,
						help: 'The month-to-date assessable amount of each wage part (ceilings, projections), CEL over `wage`, `month`, `year`, `period` and `terms`. A part without an expression is assessed as paid.'
					},
					assessment: { kind: 'text', format: 'cel', optional: true },
					refuse_when: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: { when: { kind: 'text', format: 'cel' }, message: { kind: 'text' } }
						},
						optional: true,
						help: 'Guards evaluated before the rules: the first that holds refuses the payslip with its message.'
					},
					rules: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								when: { kind: 'text', format: 'cel', optional: true },
								employee: { kind: 'text', format: 'cel', optional: true },
								employer: { kind: 'text', format: 'cel', optional: true },
								contribution: { kind: 'text', format: 'cel', optional: true }
							}
						},
						optional: true
					},
					limitation: { kind: 'text', optional: true }
				}
			},
			help: 'Original legal policy plus executable input, record, derivation, assessment and finalization configuration. Missing source evidence never establishes zero liability.'
		}
	},
	rule_set: {
		scope: {
			kind: 'text',
			default: 'JURISDICTION'
		},
		family: {
			kind: 'text'
		},
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		content_hash: {
			kind: 'text',
			optional: true
		},
		source_identity: {
			kind: 'json',
			optional: true,
			help: 'Original jurisdiction/source location and hash plus retained source IDs. Newly authored native identity never impersonates a retired source row.'
		},
		rules: {
			kind: 'json',
			help: 'Authoritative family data, ordered entries and digest-keyed executable programs. No jurisdiction fallback supplies regulatory policy.'
		}
	}
} as const;
