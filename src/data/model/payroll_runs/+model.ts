import { model } from '@norbital-ai/bolt';

/** A run retains its identity: recalculation replaces unpaid payslips, while paid payslips stay immutable. */
export default model({
	description:
		'A frozen payroll calculation for a company and period: a month (YYYY-MM) at a monthly company, a half (YYYY-MM-1 for the 1st to the 15th, YYYY-MM-2 for the 16th to the month end) at a semi-monthly one. A period holds one REGULAR run and any number of FINAL (leavers exiting in the period), EARLY (salary an off-cycle run settled ahead of the REGULAR one, created with it), OFF_CYCLE (selected one-off requests) and CORRECTION (selected manual ad hoc lines) runs, numbered by sequence. Recalculation updates unpaid payslips in place and recaptures current inputs; paid payslips stay immutable and are corrected by a new line in a later run. Payment lives on the payslips; the run carries no state of its own and only an unpaid run can be deleted. The run names the jurisdiction settings version that governed it and the calculation version that produced its outputs.',
	icon: 'lucide:play-circle',
	label: 'period',
	fields: {
		calculation_manifest: { kind: 'json', optional: true },
  original_final_source: { kind: 'json', optional: true, help: 'Native immutable employer assessment source bank and replayable configured execution captures.' },
  calculation_state: { kind: 'enum', values: ['PENDING', 'CALCULATED'], optional: true, help: 'Native configured creation is pending until the complete calculated output and source-lock transaction succeeds.' },
  source_basis: { kind: 'json', optional: true, help: 'Immutable configured calendar request, qualified source captures and exact execution provenance.' },
		period: { kind: 'text' },
		/**
		 * REGULAR pays everyone; FINAL settles the period's leavers early; EARLY settles the salary of the people an
		 * OFF_CYCLE run pays ahead of the REGULAR run; OFF_CYCLE and CORRECTION pay only `sources`.
		 */
		kind: {
			kind: 'enum',
			values: ['REGULAR', 'OFF_CYCLE', 'EARLY', 'FINAL', 'CORRECTION'],
			default: 'REGULAR'
		},
		/** The run's position among the company's runs of this period, from 1; derived, never input. */
		sequence: { kind: 'int', min: 1 },
		/** OFF_CYCLE and CORRECTION: the claim and ad hoc request ids the run pays, and nothing else. */
		sources: { kind: 'json', shape: { kind: 'list', of: { kind: 'text' } }, optional: true },
		/** Hash of the selected configuration. */
		configuration_hash: { kind: 'text' },
		/** The published holidays the run read, captured whole. */
		holidays: { kind: 'json', shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				id: { kind: 'text' },
				statutory_settings_id: { kind: 'text', optional: true },
				company_id: { kind: 'text' },
				date: { kind: 'text' },
				name: { kind: 'text' },
    source:{kind:'text',optional:true},
				kind: {
					kind: 'enum',
					values: ['PUBLIC_HOLIDAY', 'SPECIAL_HOLIDAY', 'SUBSTITUTE', 'DOUBLE_HOLIDAY']
				},
				replaces: { kind: 'text', optional: true },
				given_to: { kind: 'enum', values: ['EVERYONE', 'ONLY_IF_OFF_ON_REPLACED_DATE'] },
				published_at: { kind: 'text' },
    person_calendar:{kind:'object',optional:true,fields:{annual_role:{kind:'text'},year:{kind:'text'},country:{kind:'text'},source:{kind:'text'},published_on:{kind:'text'},leave_code:{kind:'text'},nationality_source:{kind:'text'},nationality_on:{kind:'text'}}}
			}
		}
	} },
		/** The engine build that interpreted the captured configuration. */
		calculation_version: { kind: 'text' },
		pay_date: { kind: 'date' },
		/** Contractual wage due date, separate from the run's settlement date. */
		pay_due_date: { kind: 'date', optional: true },
		salary_from: { kind: 'date', optional: true, help: 'Actual configured wage-period envelope, distinct from the attendance cutoff.' },
  salary_to: { kind: 'date', optional: true },
		attendance_from: { kind: 'date' },
		attendance_to: { kind: 'date' },
		/** How each charge was derived; later runs' overtime ceilings read its settled counts. */
		calculation_trace: { kind: 'json', shape: {
  "kind": "list",
  "of": {
    "kind": "object",
    "fields": {
      "employment_id": {
        "kind": "text"
      },
      "employee_number": {
        "kind": "text"
      },
      "replacement_discharge_source_ids": {
        "kind": "list",
        "of": {
          "kind": "text"
        },
        "optional": true
      },
      "schemes": {
        "kind": "list",
        "of": {
          "kind": "object",
          "fields": {
            "scheme_code": {
              "kind": "text"
            },
            "rule_when": {
              "kind": "text",
              "optional": true
            },
            "history_partition": {
              "kind": "text",
              "optional": true
            },
            "first_contribution_due_on": {
              "kind": "text",
              "optional": true
            },
            "base_amount": {
              "kind": "number"
            },
            "ordinary_amount": {
              "kind": "number",
              "optional": true
            },
            "assessment_month": {
              "kind": "text",
              "optional": true
            },
            "assessment_months": {
              "kind": "int",
              "min": 1,
              "optional": true
            },
            "assessment_frequency": {
              "kind": "enum",
              "values": [
                "MONTHLY",
                "SEMI_MONTHLY",
                "TEN_DAY",
                "INTEGER_MONTHS",
                "WEEKLY"
              ],
              "optional": true
            },
            "employee_amount": {
              "kind": "number"
            },
            "employee_external_payment": {
              "kind": "number",
              "optional": true
            },
            "employer_amount": {
              "kind": "number"
            },
            "inputs": {
              "kind": "list",
              "of": {
                "kind": "object",
                "fields": {
                  "code": {
                    "kind": "text"
                  },
                  "label": {
                    "kind": "text"
                  },
                  "effect": {
                    "kind": "enum",
                    "values": [
                      "INCLUDE",
                      "REDUCE"
                    ]
                  },
                  "amount": {
                    "kind": "number"
                  }
                }
              }
            },
            "reads": {
              "kind": "list",
              "of": {
                "kind": "object",
                "fields": {
                  "code": {
                    "kind": "text"
                  },
                  "employee_amount": {
                    "kind": "number"
                  },
                  "ordinary_employee_amount": {
                    "kind": "number",
                    "optional": true
                  },
                  "employer_amount": {
                    "kind": "number"
                  }
                }
              }
            }
          }
        }
      },
      "overtime_hours": {
        "kind": "list",
        "optional": true,
        "of": {
          "kind": "object",
          "fields": {
            "limit": {
              "kind": "text"
            },
            "month": {
              "kind": "text"
            },
            "hours": {
              "kind": "number"
            }
          }
        }
      },
      "time_off_in_lieu": {
        "kind": "list",
        "optional": true,
        "of": {
          "kind": "object",
          "fields": {
            "correction_observed_at": {
              "kind": "text",
              "optional": true
            },
            "correction_source_ids": {
              "kind": "list",
              "of": {
                "kind": "text"
              },
              "optional": true
            },
            "employment_id": {
              "kind": "text",
              "optional": true
            },
            "leave_code": {
              "kind": "text",
              "optional": true
            },
            "expires_on": {
              "kind": "text",
              "optional": true
            },
            "source_issued_on": {
              "kind": "text",
              "optional": true
            },
            "agreement_reference": {
              "kind": "text",
              "optional": true
            },
            "year_end": {
              "kind": "text",
              "optional": true
            },
            "pay_by": {
              "kind": "text",
              "optional": true
            },
            "settled_on": {
              "kind": "text",
              "optional": true
            },
            "reserved_on": {
              "kind": "text",
              "optional": true
            },
            "available_from": {
              "kind": "text",
              "optional": true
            },
            "recorded_on": {
              "kind": "text",
              "optional": true
            },
            "recorded_at": {
              "kind": "text",
              "optional": true
            },
            "cash_state": {
              "kind": "text",
              "optional": true
            },
            "work_day_id": {
              "kind": "text"
            },
            "date": {
              "kind": "text"
            },
            "line": {
              "kind": "text"
            },
            "label": {
              "kind": "text"
            },
            "hours": {
              "kind": "number"
            },
            "rate": {
              "kind": "number"
            },
            "amount": {
              "kind": "number"
            },
            "paid": {
              "kind": "bool"
            }
          }
        }
      },
      "weekly_work": {
        "kind": "list",
        "of": {
          "kind": "object",
          "fields": {
            "version": {
              "kind": "number"
            },
            "rule_key": {
              "kind": "text"
            },
            "week_start": {
              "kind": "text"
            },
            "week_end": {
              "kind": "text"
            },
            "settled_increment": {
              "kind": "number"
            },
            "transition_reference": {
              "kind": "text"
            },
            "threshold_own_hours": {
              "kind": "number",
              "optional": true
            },
            "threshold_comparator_hours": {
              "kind": "number",
              "optional": true
            },
            "days": {
              "kind": "list",
              "of": {
                "kind": "object",
                "fields": {
                  "date": {
                    "kind": "text"
                  },
                  "work_day_id": {
                    "kind": "text"
                  },
                  "hours": {
                    "kind": "number"
                  },
                  "normal_covered_hours": {
                    "kind": "number"
                  },
                  "lower_unit_amount": {
                    "kind": "number"
                  },
                  "upper_unit_amount": {
                    "kind": "number"
                  },
                  "settings_id": {
                    "kind": "text"
                  },
                  "terms_id": {
                    "kind": "text"
                  },
                  "provenance": {
                    "kind": "enum",
                    "values": [
                      "RECORDED_WORK",
                      "NO_RECORDED_WORK"
                    ],
                    "optional": true
                  },
                  "own_hours": {
                    "kind": "number"
                  },
                  "comparator_hours": {
                    "kind": "number"
                  },
                  "comparator_presence": {
                    "kind": "text"
                  },
                  "daily_awards": {
                    "kind": "list",
                    "of": {
                      "kind": "object",
                      "fields": {
                        "key": {
                          "kind": "text"
                        },
                        "quantum": {
                          "kind": "number"
                        },
                        "tier": {
                          "kind": "enum",
                          "values": [
                            "LOWER",
                            "UPPER"
                          ],
                          "optional": true
                        },
                        "unit_amount": {
                          "kind": "number"
                        },
                        "units": {
                          "kind": "number"
                        },
                        "amount": {
                          "kind": "number"
                        },
                        "coordinates": {
                          "kind": "list",
                          "of": {
                            "kind": "object",
                            "fields": {
                              "date": {
                                "kind": "text"
                              },
                              "work_day_id": {
                                "kind": "text"
                              },
                              "from": {
                                "kind": "number"
                              },
                              "to": {
                                "kind": "number"
                              }
                            }
                          }
                        },
                        "unit_coordinates": {
                          "kind": "list",
                          "optional": true,
                          "of": {
                            "kind": "list",
                            "of": {
                              "kind": "object",
                              "fields": {
                                "date": {
                                  "kind": "text"
                                },
                                "work_day_id": {
                                  "kind": "text"
                                },
                                "from": {
                                  "kind": "number"
                                },
                                "to": {
                                  "kind": "number"
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            },
            "weekly_awards": {
              "kind": "list",
              "of": {
                "kind": "object",
                "fields": {
                  "key": {
                    "kind": "text"
                  },
                  "quantum": {
                    "kind": "number"
                  },
                  "tier": {
                    "kind": "enum",
                    "values": [
                      "LOWER",
                      "UPPER"
                    ],
                    "optional": true
                  },
                  "unit_amount": {
                    "kind": "number"
                  },
                  "units": {
                    "kind": "number"
                  },
                  "amount": {
                    "kind": "number"
                  },
                  "coordinates": {
                    "kind": "list",
                    "of": {
                      "kind": "object",
                      "fields": {
                        "date": {
                          "kind": "text"
                        },
                        "work_day_id": {
                          "kind": "text"
                        },
                        "from": {
                          "kind": "number"
                        },
                        "to": {
                          "kind": "number"
                        }
                      }
                    }
                  },
                  "unit_coordinates": {
                    "kind": "list",
                    "optional": true,
                    "of": {
                      "kind": "list",
                      "of": {
                        "kind": "object",
                        "fields": {
                          "date": {
                            "kind": "text"
                          },
                          "work_day_id": {
                            "kind": "text"
                          },
                          "from": {
                            "kind": "number"
                          },
                          "to": {
                            "kind": "number"
                          }
                        }
                      }
                    }
                  }
                }
              }
            },
            "receipt_origins": {
              "kind": "list",
              "optional": true,
              "of": {
                "kind": "object",
                "fields": {
                  "key": {
                    "kind": "text"
                  },
                  "quantum": {
                    "kind": "number"
                  },
                  "tier": {
                    "kind": "enum",
                    "values": [
                      "LOWER",
                      "UPPER"
                    ],
                    "optional": true
                  },
                  "unit_amount": {
                    "kind": "number"
                  },
                  "units": {
                    "kind": "number"
                  },
                  "amount": {
                    "kind": "number"
                  },
                  "coordinates": {
                    "kind": "list",
                    "of": {
                      "kind": "object",
                      "fields": {
                        "date": {
                          "kind": "text"
                        },
                        "work_day_id": {
                          "kind": "text"
                        },
                        "from": {
                          "kind": "number"
                        },
                        "to": {
                          "kind": "number"
                        }
                      }
                    }
                  },
                  "unit_coordinates": {
                    "kind": "list",
                    "optional": true,
                    "of": {
                      "kind": "list",
                      "of": {
                        "kind": "object",
                        "fields": {
                          "date": {
                            "kind": "text"
                          },
                          "work_day_id": {
                            "kind": "text"
                          },
                          "from": {
                            "kind": "number"
                          },
                          "to": {
                            "kind": "number"
                          }
                        }
                      }
                    }
                  },
                  "kind": {
                    "kind": "enum",
                    "values": [
                      "DAILY",
                      "WEEKLY"
                    ]
                  }
                }
              }
            },
            "receipts": {
              "kind": "list",
              "of": {
                "kind": "object",
                "fields": {
                  "amount": {
                    "kind": "number"
                  },
                  "units": {
                    "kind": "list",
                    "of": {
                      "kind": "object",
                      "fields": {
                        "origin": {
                          "kind": "text"
                        },
                        "index": {
                          "kind": "number"
                        },
                        "kind": {
                          "kind": "enum",
                          "values": [
                            "DAILY",
                            "WEEKLY"
                          ]
                        }
                      }
                    }
                  }
                }
              }
            },
            "reservations": {
              "kind": "list",
              "of": {
                "kind": "object",
                "fields": {
                  "daily_origin": {
                    "kind": "text"
                  },
                  "weekly_origin": {
                    "kind": "text"
                  },
                  "units": {
                    "kind": "number"
                  },
                  "credit": {
                    "kind": "number"
                  },
                  "daily_unit_from": {
                    "kind": "number"
                  },
                  "weekly_unit_from": {
                    "kind": "number"
                  },
                  "coordinates": {
                    "kind": "list",
                    "of": {
                      "kind": "object",
                      "fields": {
                        "date": {
                          "kind": "text"
                        },
                        "work_day_id": {
                          "kind": "text"
                        },
                        "from": {
                          "kind": "number"
                        },
                        "to": {
                          "kind": "number"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        "optional": true
      },
      "weekly_work_summary": {
        "kind": "list",
        "optional": true,
        "of": {
          "kind": "object",
          "fields": {
            "rule_key": {
              "kind": "text"
            },
            "week_start": {
              "kind": "text"
            },
            "week_end": {
              "kind": "text"
            },
            "settled_increment": {
              "kind": "number"
            },
            "transition_reference": {
              "kind": "text"
            }
          }
        }
      },
      "overtime_days": {
        "kind": "number",
        "optional": true
      },
      "minimum_wage": {
        "kind": "number",
        "optional": true
      }
    }
  }
} },
		/** The COMPANY-assessed schemes' charges for the whole run. */
		company_charges: { kind: 'json', shape: {
  "kind": "list",
  "of": {
    "kind": "object",
    "fields": {
      "scheme_code": {
        "kind": "text"
      },
      "agency_allocation": {
        "kind": "object",
        "optional": true,
        "fields": {
          "assessment_id": {
            "kind": "text"
          },
          "source_history_id": {
            "kind": "text"
          },
          "original_pricing_settings_id": {
            "kind": "text"
          },
          "source_identity": {
            "kind": "text"
          },
          "employee_id": {
            "kind": "text"
          },
          "company_id": {
            "kind": "text"
          },
          "employment_id": {
            "kind": "text"
          },
          "settings_code": {
            "kind": "text"
          },
          "policy_code": {
            "kind": "text"
          },
          "fund_reference": {
            "kind": "text"
          },
          "month": {
            "kind": "date"
          },
          "currency": {
            "kind": "currency"
          },
          "certified_base_amount": {
            "kind": "number"
          },
          "base_assessed": {
            "kind": "number"
          },
          "certified_employee_amount": {
            "kind": "number"
          },
          "certified_employer_amount": {
            "kind": "number"
          },
          "employee_assessed": {
            "kind": "number"
          },
          "employee_external_credited": {
            "kind": "number"
          },
          "employee_withheld": {
            "kind": "number"
          },
          "employer_assessed": {
            "kind": "number"
          },
          "original_assessment_ids": {
            "kind": "list",
            "of": {
              "kind": "text"
            }
          },
          "original_paid_payslip_ids": {
            "kind": "list",
            "of": {
              "kind": "text"
            }
          },
          "original_receipt_keys": {
            "kind": "list",
            "of": {
              "kind": "text"
            }
          }
        }
      },
      "cash_reporting": {
        "kind": "list",
        "optional": true,
        "of": {
          "kind": "object",
          "fields": {
            "key": {
              "kind": "text"
            },
            "amount": {
              "kind": "number"
            },
            "authority": {
              "kind": "text"
            },
            "work_basis": {
              "kind": "list",
              "optional": true,
              "of": {
                "kind": "object",
                "fields": {
                  "source_id": {
                    "kind": "text"
                  },
                  "work_date": {
                    "kind": "text"
                  },
                  "component_code": {
                    "kind": "text"
                  },
                  "label": {
                    "kind": "text"
                  },
                  "bucket": {
                    "kind": "text"
                  },
                  "reporting_class": {
                    "kind": "text",
                    "optional": true
                  },
                  "rule_key": {
                    "kind": "text",
                    "optional": true
                  },
                  "minimum_wage": {
                    "kind": "bool"
                  },
                  "amount": {
                    "kind": "number"
                  },
                  "base": {
                    "kind": "number"
                  },
                  "overtime": {
                    "kind": "number"
                  },
                  "day_pay": {
                    "kind": "number"
                  },
                  "night_premium": {
                    "kind": "number"
                  }
                }
              }
            },
            "source_references": {
              "kind": "list",
              "optional": true,
              "of": {
                "kind": "text"
              }
            }
          }
        }
      },
      "original_source_context": {
        "kind": "text",
        "optional": true
      },
      "attributed_assessments": {
        "kind": "list",
        "optional": true,
        "of": {
          "kind": "object",
          "fields": {
            "period": {
              "kind": "text"
            },
            "settings_id": {
              "kind": "text"
            },
            "contribution_id": {
              "kind": "text"
            },
            "original_payslip_ids": {
              "kind": "list",
              "of": {
                "kind": "text"
              }
            },
            "source_ids": {
              "kind": "list",
              "of": {
                "kind": "text"
              }
            },
            "base_amount": {
              "kind": "number"
            },
            "ordinary_amount": {
              "kind": "number"
            },
            "employee_amount": {
              "kind": "number"
            },
            "employee_external_payment": {
              "kind": "number",
              "optional": true
            },
            "employer_amount": {
              "kind": "number"
            },
            "rule_when": {
              "kind": "text"
            },
            "remittance_due_on": {
              "kind": "text",
              "optional": true
            },
            "remittance_late_allocation": {
              "kind": "enum",
              "values": [
                "CONTRIBUTION_MONTH_ARREARS"
              ],
              "optional": true
            }
          }
        }
      },
      "authority": {
        "kind": "text",
        "optional": true
      },
      "label": {
        "kind": "text",
        "optional": true
      },
      "listing_order": {
        "kind": "int",
        "optional": true
      },
      "listing_group": {
        "kind": "text",
        "optional": true
      },
      "base_amount": {
        "kind": "number"
      },
      "ordinary_amount": {
        "kind": "number",
        "optional": true
      },
      "native_scope_basis": {
        "kind": "list",
        "optional": true,
        "of": {
          "kind": "object",
          "fields": {
            "employment_id": {
              "kind": "text"
            },
            "from": {
              "kind": "text"
            },
            "to": {
              "kind": "text"
            },
            "declaration_id": {
              "kind": "text"
            },
            "declaration_from": {
              "kind": "text"
            },
            "evidence_keys": {
              "kind": "list",
              "of": {
                "kind": "text"
              }
            },
            "evidence_ids": {
              "kind": "list",
              "of": {
                "kind": "text"
              }
            },
            "previous_declarations": {
              "kind": "list",
              "optional": true,
              "of": {
                "kind": "object",
                "fields": {
                  "declaration_id": {
                    "kind": "text"
                  },
                  "date": {
                    "kind": "text"
                  },
                  "declaration_from": {
                    "kind": "text"
                  },
                  "evidence_ids": {
                    "kind": "list",
                    "of": {
                      "kind": "text"
                    }
                  },
                  "status": {
                    "kind": "union",
                    "by": "kind",
                    "arms": {
                      "REGISTERED": {
                        "reference_number": {
                          "kind": "text"
                        },
                        "rate_override": {
                          "kind": "number",
                          "min": 0,
                          "optional": true
                        },
                        "since": {
                          "kind": "text",
                          "optional": true
                        },
                        "first_contribution_due_on": {
                          "kind": "text",
                          "optional": true
                        },
                        "instalments": {
                          "kind": "list",
                          "optional": true,
                          "of": {
                            "kind": "object",
                            "fields": {
                              "amount": {
                                "kind": "number"
                              },
                              "from": {
                                "kind": "text"
                              },
                              "to": {
                                "kind": "text"
                              },
                              "reference": {
                                "kind": "text"
                              }
                            }
                          }
                        },
                        "elections": {
                          "kind": "record",
                          "of": {
                            "kind": "union",
                            "of": [
                              {
                                "kind": "bool"
                              },
                              {
                                "kind": "number"
                              },
                              {
                                "kind": "text"
                              }
                            ]
                          },
                          "optional": true
                        },
                        "opening": {
                          "kind": "list",
                          "optional": true,
                          "of": {
                            "kind": "object",
                            "fields": {
                              "history_partition": {
                                "kind": "text",
                                "optional": true
                              },
                              "year": {
                                "kind": "text"
                              },
                              "base": {
                                "kind": "number"
                              },
                              "employee": {
                                "kind": "number"
                              },
                              "employer": {
                                "kind": "number"
                              },
                              "rebate": {
                                "kind": "number",
                                "min": 0,
                                "optional": true
                              },
                              "ordinary": {
                                "kind": "number",
                                "optional": true
                              },
                              "raw_ordinary_wages": {
                                "kind": "number",
                                "min": 0,
                                "optional": true
                              },
                              "raw_additional_wages": {
                                "kind": "number",
                                "min": 0,
                                "optional": true
                              },
                              "wages_through": {
                                "kind": "text",
                                "optional": true
                              },
                              "origin": {
                                "kind": "enum",
                                "values": [
                                  "CURRENT_EMPLOYER",
                                  "OTHER_EMPLOYER",
                                  "APPROVED_RELATED_EMPLOYER"
                                ],
                                "optional": true
                              },
                              "source_system_reference": {
                                "kind": "text",
                                "optional": true
                              },
                              "source_receipt_ids": {
                                "kind": "list",
                                "of": {
                                  "kind": "text"
                                },
                                "optional": true
                              },
                              "reconciliation_reference": {
                                "kind": "text",
                                "optional": true
                              },
                              "excludes_workspace_paid_history": {
                                "kind": "bool",
                                "optional": true
                              },
                              "board_approval_reference": {
                                "kind": "text",
                                "optional": true
                              },
                              "employers_related": {
                                "kind": "bool",
                                "optional": true
                              },
                              "employee_informed": {
                                "kind": "bool",
                                "optional": true
                              },
                              "terms_unchanged": {
                                "kind": "bool",
                                "optional": true
                              },
                              "transferred_employee": {
                                "kind": "bool",
                                "optional": true
                              },
                              "months": {
                                "kind": "int",
                                "min": 0,
                                "optional": true
                              },
                              "payroll_periods": {
                                "kind": "int",
                                "min": 0,
                                "optional": true
                              },
                              "payroll_frequency": {
                                "kind": "enum",
                                "values": [
                                  "MONTHLY",
                                  "SEMI_MONTHLY",
                                  "TEN_DAY",
                                  "INTEGER_MONTHS",
                                  "WEEKLY"
                                ],
                                "optional": true
                              },
                              "reference": {
                                "kind": "text"
                              }
                            }
                          }
                        },
                        "covered_persons": {
                          "kind": "list",
                          "optional": true,
                          "of": {
                            "kind": "object",
                            "fields": {
                              "reference": {
                                "kind": "text"
                              },
                              "relationship": {
                                "kind": "text"
                              },
                              "citizenship": {
                                "kind": "text"
                              },
                              "birth_date": {
                                "kind": "text"
                              },
                              "coverage_from": {
                                "kind": "text"
                              },
                              "coverage_to": {
                                "kind": "text"
                              },
                              "residence_from": {
                                "kind": "text"
                              },
                              "residence_to": {
                                "kind": "text"
                              },
                              "residence_since": {
                                "kind": "text"
                              },
                              "eligibility_code": {
                                "kind": "text"
                              },
                              "principal_class": {
                                "kind": "text"
                              },
                              "principal_qualified_from": {
                                "kind": "text"
                              },
                              "relationship_from": {
                                "kind": "text"
                              },
                              "condition_from": {
                                "kind": "text"
                              },
                              "no_occupation": {
                                "kind": "bool"
                              },
                              "adult_cannot_self_care": {
                                "kind": "bool"
                              },
                              "born_in_jurisdiction": {
                                "kind": "bool"
                              },
                              "residence_review_complete": {
                                "kind": "bool"
                              },
                              "no_livelihood_capacity": {
                                "kind": "bool"
                              },
                              "studying": {
                                "kind": "bool"
                              },
                              "travel": {
                                "kind": "list",
                                "of": {
                                  "kind": "object",
                                  "fields": {
                                    "from": {
                                      "kind": "text"
                                    },
                                    "to": {
                                      "kind": "text"
                                    },
                                    "reference": {
                                      "kind": "text"
                                    }
                                  }
                                }
                              }
                            }
                          }
                        },
                        "child_claims": {
                          "kind": "list",
                          "optional": true,
                          "of": {
                            "kind": "object",
                            "fields": {
                              "year": {
                                "kind": "text"
                              },
                              "relief_class": {
                                "kind": "text"
                              },
                              "full_count": {
                                "kind": "int",
                                "min": 0
                              },
                              "half_count": {
                                "kind": "int",
                                "min": 0
                              },
                              "reference": {
                                "kind": "text"
                              }
                            }
                          }
                        },
                        "deduction_claims": {
                          "kind": "list",
                          "optional": true,
                          "of": {
                            "kind": "object",
                            "fields": {
                              "period": {
                                "kind": "text"
                              },
                              "category": {
                                "kind": "text"
                              },
                              "amount": {
                                "kind": "number"
                              },
                              "source": {
                                "kind": "enum",
                                "values": [
                                  "EMPLOYEE",
                                  "PRIOR_EMPLOYER"
                                ]
                              },
                              "reference": {
                                "kind": "text"
                              },
                              "event_reference": {
                                "kind": "text",
                                "optional": true
                              }
                            }
                          }
                        },
                        "unit_assessments": {
                          "kind": "list",
                          "optional": true,
                          "of": {
                            "kind": "object",
                            "fields": {
                              "period": {
                                "kind": "text"
                              },
                              "gross": {
                                "kind": "number",
                                "min": 0
                              },
                              "units": {
                                "kind": "int",
                                "min": 1
                              },
                              "reference": {
                                "kind": "text"
                              },
                              "payment_class": {
                                "kind": "text",
                                "optional": true
                              },
                              "paid_on": {
                                "kind": "text",
                                "optional": true
                              },
                              "withhold_below_threshold_requested": {
                                "kind": "bool",
                                "optional": true
                              }
                            }
                          }
                        }
                      },
                      "NOT_REGISTERED": {
                        "unit_assessments": {
                          "kind": "list",
                          "optional": true,
                          "of": {
                            "kind": "object",
                            "fields": {
                              "period": {
                                "kind": "text"
                              },
                              "gross": {
                                "kind": "number",
                                "min": 0
                              },
                              "units": {
                                "kind": "int",
                                "min": 1
                              },
                              "reference": {
                                "kind": "text"
                              },
                              "payment_class": {
                                "kind": "text",
                                "optional": true
                              },
                              "paid_on": {
                                "kind": "text",
                                "optional": true
                              },
                              "withhold_below_threshold_requested": {
                                "kind": "bool",
                                "optional": true
                              }
                            }
                          }
                        },
                        "reason": {
                          "kind": "text"
                        },
                        "elections": {
                          "kind": "record",
                          "of": {
                            "kind": "union",
                            "of": [
                              {
                                "kind": "bool"
                              },
                              {
                                "kind": "number"
                              },
                              {
                                "kind": "text"
                              }
                            ]
                          },
                          "optional": true
                        },
                        "declaration_reference": {
                          "kind": "text",
                          "optional": true
                        }
                      }
                    }
                  }
                }
              }
            },
            "status": {
              "kind": "union",
              "by": "kind",
              "arms": {
                "REGISTERED": {
                  "reference_number": {
                    "kind": "text"
                  },
                  "rate_override": {
                    "kind": "number",
                    "min": 0,
                    "optional": true
                  },
                  "since": {
                    "kind": "text",
                    "optional": true
                  },
                  "first_contribution_due_on": {
                    "kind": "text",
                    "optional": true
                  },
                  "instalments": {
                    "kind": "list",
                    "optional": true,
                    "of": {
                      "kind": "object",
                      "fields": {
                        "amount": {
                          "kind": "number"
                        },
                        "from": {
                          "kind": "text"
                        },
                        "to": {
                          "kind": "text"
                        },
                        "reference": {
                          "kind": "text"
                        }
                      }
                    }
                  },
                  "elections": {
                    "kind": "record",
                    "of": {
                      "kind": "union",
                      "of": [
                        {
                          "kind": "bool"
                        },
                        {
                          "kind": "number"
                        },
                        {
                          "kind": "text"
                        }
                      ]
                    },
                    "optional": true
                  },
                  "opening": {
                    "kind": "list",
                    "optional": true,
                    "of": {
                      "kind": "object",
                      "fields": {
                        "history_partition": {
                          "kind": "text",
                          "optional": true
                        },
                        "year": {
                          "kind": "text"
                        },
                        "base": {
                          "kind": "number"
                        },
                        "employee": {
                          "kind": "number"
                        },
                        "employer": {
                          "kind": "number"
                        },
                        "rebate": {
                          "kind": "number",
                          "min": 0,
                          "optional": true
                        },
                        "ordinary": {
                          "kind": "number",
                          "optional": true
                        },
                        "raw_ordinary_wages": {
                          "kind": "number",
                          "min": 0,
                          "optional": true
                        },
                        "raw_additional_wages": {
                          "kind": "number",
                          "min": 0,
                          "optional": true
                        },
                        "wages_through": {
                          "kind": "text",
                          "optional": true
                        },
                        "origin": {
                          "kind": "enum",
                          "values": [
                            "CURRENT_EMPLOYER",
                            "OTHER_EMPLOYER",
                            "APPROVED_RELATED_EMPLOYER"
                          ],
                          "optional": true
                        },
                        "source_system_reference": {
                          "kind": "text",
                          "optional": true
                        },
                        "source_receipt_ids": {
                          "kind": "list",
                          "of": {
                            "kind": "text"
                          },
                          "optional": true
                        },
                        "reconciliation_reference": {
                          "kind": "text",
                          "optional": true
                        },
                        "excludes_workspace_paid_history": {
                          "kind": "bool",
                          "optional": true
                        },
                        "board_approval_reference": {
                          "kind": "text",
                          "optional": true
                        },
                        "employers_related": {
                          "kind": "bool",
                          "optional": true
                        },
                        "employee_informed": {
                          "kind": "bool",
                          "optional": true
                        },
                        "terms_unchanged": {
                          "kind": "bool",
                          "optional": true
                        },
                        "transferred_employee": {
                          "kind": "bool",
                          "optional": true
                        },
                        "months": {
                          "kind": "int",
                          "min": 0,
                          "optional": true
                        },
                        "payroll_periods": {
                          "kind": "int",
                          "min": 0,
                          "optional": true
                        },
                        "payroll_frequency": {
                          "kind": "enum",
                          "values": [
                            "MONTHLY",
                            "SEMI_MONTHLY",
                            "TEN_DAY",
                            "INTEGER_MONTHS",
                            "WEEKLY"
                          ],
                          "optional": true
                        },
                        "reference": {
                          "kind": "text"
                        }
                      }
                    }
                  },
                  "covered_persons": {
                    "kind": "list",
                    "optional": true,
                    "of": {
                      "kind": "object",
                      "fields": {
                        "reference": {
                          "kind": "text"
                        },
                        "relationship": {
                          "kind": "text"
                        },
                        "citizenship": {
                          "kind": "text"
                        },
                        "birth_date": {
                          "kind": "text"
                        },
                        "coverage_from": {
                          "kind": "text"
                        },
                        "coverage_to": {
                          "kind": "text"
                        },
                        "residence_from": {
                          "kind": "text"
                        },
                        "residence_to": {
                          "kind": "text"
                        },
                        "residence_since": {
                          "kind": "text"
                        },
                        "eligibility_code": {
                          "kind": "text"
                        },
                        "principal_class": {
                          "kind": "text"
                        },
                        "principal_qualified_from": {
                          "kind": "text"
                        },
                        "relationship_from": {
                          "kind": "text"
                        },
                        "condition_from": {
                          "kind": "text"
                        },
                        "no_occupation": {
                          "kind": "bool"
                        },
                        "adult_cannot_self_care": {
                          "kind": "bool"
                        },
                        "born_in_jurisdiction": {
                          "kind": "bool"
                        },
                        "residence_review_complete": {
                          "kind": "bool"
                        },
                        "no_livelihood_capacity": {
                          "kind": "bool"
                        },
                        "studying": {
                          "kind": "bool"
                        },
                        "travel": {
                          "kind": "list",
                          "of": {
                            "kind": "object",
                            "fields": {
                              "from": {
                                "kind": "text"
                              },
                              "to": {
                                "kind": "text"
                              },
                              "reference": {
                                "kind": "text"
                              }
                            }
                          }
                        }
                      }
                    }
                  },
                  "child_claims": {
                    "kind": "list",
                    "optional": true,
                    "of": {
                      "kind": "object",
                      "fields": {
                        "year": {
                          "kind": "text"
                        },
                        "relief_class": {
                          "kind": "text"
                        },
                        "full_count": {
                          "kind": "int",
                          "min": 0
                        },
                        "half_count": {
                          "kind": "int",
                          "min": 0
                        },
                        "reference": {
                          "kind": "text"
                        }
                      }
                    }
                  },
                  "deduction_claims": {
                    "kind": "list",
                    "optional": true,
                    "of": {
                      "kind": "object",
                      "fields": {
                        "period": {
                          "kind": "text"
                        },
                        "category": {
                          "kind": "text"
                        },
                        "amount": {
                          "kind": "number"
                        },
                        "source": {
                          "kind": "enum",
                          "values": [
                            "EMPLOYEE",
                            "PRIOR_EMPLOYER"
                          ]
                        },
                        "reference": {
                          "kind": "text"
                        },
                        "event_reference": {
                          "kind": "text",
                          "optional": true
                        }
                      }
                    }
                  },
                  "unit_assessments": {
                    "kind": "list",
                    "optional": true,
                    "of": {
                      "kind": "object",
                      "fields": {
                        "period": {
                          "kind": "text"
                        },
                        "gross": {
                          "kind": "number",
                          "min": 0
                        },
                        "units": {
                          "kind": "int",
                          "min": 1
                        },
                        "reference": {
                          "kind": "text"
                        },
                        "payment_class": {
                          "kind": "text",
                          "optional": true
                        },
                        "paid_on": {
                          "kind": "text",
                          "optional": true
                        },
                        "withhold_below_threshold_requested": {
                          "kind": "bool",
                          "optional": true
                        }
                      }
                    }
                  }
                },
                "NOT_REGISTERED": {
                  "unit_assessments": {
                    "kind": "list",
                    "optional": true,
                    "of": {
                      "kind": "object",
                      "fields": {
                        "period": {
                          "kind": "text"
                        },
                        "gross": {
                          "kind": "number",
                          "min": 0
                        },
                        "units": {
                          "kind": "int",
                          "min": 1
                        },
                        "reference": {
                          "kind": "text"
                        },
                        "payment_class": {
                          "kind": "text",
                          "optional": true
                        },
                        "paid_on": {
                          "kind": "text",
                          "optional": true
                        },
                        "withhold_below_threshold_requested": {
                          "kind": "bool",
                          "optional": true
                        }
                      }
                    }
                  },
                  "reason": {
                    "kind": "text"
                  },
                  "elections": {
                    "kind": "record",
                    "of": {
                      "kind": "union",
                      "of": [
                        {
                          "kind": "bool"
                        },
                        {
                          "kind": "number"
                        },
                        {
                          "kind": "text"
                        }
                      ]
                    },
                    "optional": true
                  },
                  "declaration_reference": {
                    "kind": "text",
                    "optional": true
                  }
                }
              },
              "optional": true
            }
          }
        }
      },
      "employee_recovery_basis": {
        "kind": "object",
        "optional": true,
        "fields": {
          "ordinary_month_base": {
            "kind": "number"
          },
          "ordinary_month_cash": {
            "kind": "number",
            "optional": true
          },
          "ordinary_paid_cash": {
            "kind": "number",
            "optional": true
          },
          "salary_from": {
            "kind": "text"
          },
          "salary_to": {
            "kind": "text"
          },
          "final_salary": {
            "kind": "bool"
          }
        }
      },
      "assessment_month": {
        "kind": "text",
        "optional": true
      },
      "assessment_months": {
        "kind": "int",
        "min": 1,
        "optional": true
      },
      "assessment_frequency": {
        "kind": "enum",
        "values": [
          "MONTHLY",
          "SEMI_MONTHLY",
          "TEN_DAY",
          "INTEGER_MONTHS",
          "WEEKLY"
        ],
        "optional": true
      },
      "employee_amount": {
        "kind": "number"
      },
      "employee_external_payment": {
        "kind": "number",
        "optional": true
      },
      "employer_amount": {
        "kind": "number"
      },
      "rebate_amount": {
        "kind": "number",
        "optional": true
      },
      "rule_when": {
        "kind": "text",
        "optional": true
      },
      "history_partition": {
        "kind": "text",
        "optional": true
      },
      "payment_occasion": {
        "kind": "bool",
        "optional": true
      },
      "remittance_primary_route": {
        "kind": "bool",
        "optional": true
      },
      "remittance_due_on": {
        "kind": "text",
        "optional": true
      },
      "remittance_late_allocation": {
        "kind": "enum",
        "values": [
          "CONTRIBUTION_MONTH_ARREARS"
        ],
        "optional": true
      },
      "remittance_rounding": {
        "kind": "enum",
        "values": [
          "NONE",
          "FLOOR_MAJOR_UNIT"
        ],
        "optional": true
      },
      "earned_period": {
        "kind": "text",
        "optional": true
      },
      "earned_pricing_settings_reference": {
        "kind": "text",
        "optional": true
      },
      "earned_pricing_contribution_reference": {
        "kind": "text",
        "optional": true
      },
      "earned_remittance_due_on": {
        "kind": "text",
        "optional": true
      },
      "earned_remittance_late_allocation": {
        "kind": "enum",
        "values": [
          "CONTRIBUTION_MONTH_ARREARS"
        ],
        "optional": true
      },
      "earned_base_amount": {
        "kind": "number",
        "optional": true
      },
      "earned_ordinary_amount": {
        "kind": "number",
        "optional": true
      },
      "earned_employee_amount": {
        "kind": "number",
        "optional": true
      },
      "earned_employer_amount": {
        "kind": "number",
        "optional": true
      },
      "earned_rebate_amount": {
        "kind": "number",
        "optional": true
      }
    }
  }
} },
		/** Employer-month amounts to remit, kept apart from accrued employer cost. */
		company_remittances: { kind: 'json', shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				scheme_code: { kind: 'text' },
				month: { kind: 'text' },
				currency: { kind: 'text' },
				/** FLOOR_MAJOR_UNIT: the part rounded down; NONE: the part remitted at the actual amount. */
				remittance_rounding: { kind: 'enum', values: ['NONE', 'FLOOR_MAJOR_UNIT'] },
				accrued_amount: { kind: 'number' },
				payable_amount: { kind: 'number' }
			}
		}
	} },
		/** What the engine noticed but did not refuse, one sentence per line. */
		warnings: { kind: 'text', default: '' }
	},
	unique: [{ fields: ['company_id', 'period', 'sequence'] }],
	search: { text: ['period'] }
});
