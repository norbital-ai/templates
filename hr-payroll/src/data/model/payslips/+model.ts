import { model } from '@norbital-ai/bolt';

/**
 * One person's settlement for one run. Base, proration, statutory and adjustments are inlined; the lock over a
 * captured source is the source's own `payslip_id`. `status` moves DRAFT ↔ ON_HOLD → PAID; PAID edits nothing.
 */
export default model({
	description:
		"One person's settlement for one run. Contracted base, the proration segments the calendar produced, the statutory charges over their sum and every adjustment one captured input caused are held here. Year-to-date is a SUM over payslips, never a stored column.",
	icon: 'lucide:receipt',
	label: 'net',
	fields: {
		source_basis: { kind: 'json', optional: true },
		work_capture: { kind: 'json', optional: true },
		/** Original captured IDs resolve through configured runtime records, without native links to retired collections. */
		original_component_partition_id: { kind: 'text', optional: true },
		settled_by_payment_event_id: { kind: 'text', optional: true },

        payment_method: { kind: 'enum', values: ['ACCOUNT','CASH','CHEQUE'], optional: true },
        payment_account_reference: { kind: 'text', optional: true },
        payment_method_source: { kind: 'json', optional: true },
        payment_method_source_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
        payment_method_assessment: { kind: 'json', optional: true },
 original_final_source:{kind:'json',optional:true},
 monthlyChargeAllocation:{kind:'json',optional:true},
		/** The latest contract date this settlement consumed; terms through it are frozen. */
		terms_through: { kind: 'date' },
		salary_from: { kind: 'date', optional: true },
		salary_to: { kind: 'date', optional: true },
		service_basis: { kind: 'json', shape: {
  "kind": "list",
  "of": {
    "kind": "object",
    "fields": {
      "employment_id": {
        "kind": "text"
      },
      "start": {
        "kind": "text"
      },
      "end": {
        "kind": "text",
        "optional": true
      },
      "continuity_fact": {
        "kind": "text",
        "optional": true
      },
      "equivalent": {
        "kind": "bool",
        "optional": true
      },
      "history_id": {
        "kind": "text",
        "optional": true
      },
      "successor_employment_id": {
        "kind": "text",
        "optional": true
      },
      "recorded_on": {
        "kind": "text",
        "optional": true
      },
      "reference": {
        "kind": "text",
        "optional": true
      },
      "transfer": {
        "kind": "object",
        "optional": true,
        "fields": {
          "kind": {
            "kind": "text"
          },
          "effective_on": {
            "kind": "text"
          },
          "authority_reference": {
            "kind": "text"
          },
          "predecessor_company_id": {
            "kind": "text"
          },
          "successor_company_id": {
            "kind": "text"
          },
          "known_on": {
            "kind": "text"
          },
          "rights_preserved": {
            "kind": "bool"
          },
          "employee_consent": {
            "kind": "bool",
            "optional": true
          }
        }
      }
    }
  }
}, optional: true },
		leave_settlements: { kind: 'json', shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				leave_entry_id: { kind: 'text' },
				gross_amount: { kind: 'object', fields: { value: { kind: 'number' }, currency: { kind: 'text' } } },
				charges: { 
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				employer_paid_fraction: { kind: 'number', optional: true },
				event_from_unit: { kind: 'number', optional: true },
				event_units: { kind: 'number', optional: true },
				date: { kind: 'text' },
				days: { kind: 'number' },
				unpaid_days: { kind: 'number', optional: true },
				hours: { kind: 'number', optional: true },
				normal_paid_hours: { kind: 'number', optional: true },
				catalogue_id: { kind: 'text' },
				employment_term_id: { kind: 'text' },
				holiday_id: { kind: 'text', optional: true },
				shift_definition_id: { kind: 'text', optional: true },
 calendar_segment:{kind:'object',optional:true,fields:{key:{kind:'text'},start:{kind:'text'},counted_day:{kind:'number'},segment_days:{kind:'number'}}},
 hourly_budget_hours:{kind:'number',min:0,optional:true},
 person_calendar:{kind:'object',optional:true,fields:{annual_role:{kind:'text'},year:{kind:'text'},country:{kind:'text'},source:{kind:'text'},published_on:{kind:'text'},leave_code:{kind:'text'},nationality_source:{kind:'text'},nationality_on:{kind:'text'}}},
 original_required_minutes:{kind:'number',min:0,optional:true},
				work_day_id: { kind: 'text', optional: true }
			}
		}
	 },
				pay_items: { 
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				original_charge_index:{kind:'int',min:0,optional:true},
 original_statutory_gross:{kind:'number',min:0,optional:true},
 original_remuneration:{kind:'json',optional:true},
 reserved_line: { kind: 'enum', values: ['BASE'], optional: true },
				catalogue_id: { kind: 'text' },
				settings_id: { kind: 'text' },
				code: { kind: 'text' },
				bucket: { kind: 'enum', values: ['EARNING', 'ABSENCE'] },
				date: { kind: 'text', optional: true },
				amount: { kind: 'number' },
				payment_policy: { kind: 'json', optional: true },
				payment_component_only: { kind: 'bool', optional: true },
				payment_component_gross: { kind: 'number', optional: true },
				payment_hold_scope_reference: { kind: 'text', optional: true },
				payment_deduction_reference: { kind: 'text', optional: true },

				quantity: { kind: 'number', optional: true },
				rate: { kind: 'number', optional: true },
				source_facts_json: { kind: 'text', optional: true },
				retained_amount: { kind: 'number', optional: true },
				protected_amount: { kind: 'number', optional: true },
				minimum_amount: { kind: 'number', optional: true },
				protected_fraction: { kind: 'number', optional: true },
				protected_employment_fraction: { kind: 'number', optional: true }
			}
		}
	 }
			}
		}
	}, optional: true },
		statutory_absence_settlements: { kind: 'json', shape: {
  "kind": "list",
  "of": {
    "kind": "object",
    "fields": {
      "caseId": {
        "kind": "text"
      },
      "periodId": {
        "kind": "text"
      },
      "dayId": {
        "kind": "text"
      },
      "date": {
        "kind": "text"
      },
      "kind": {
        "kind": "text"
      },
      "salaryDays": {
        "kind": "number"
      },
      "salary_amount": {
        "kind": "number"
      },
      "sourceIds": {
        "kind": "list",
        "of": {
          "kind": "text"
        }
      }
    }
  }
}, optional: true },
		guaranteed_pay_basis: { kind: 'json', shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				rule_key: { kind: 'text' },
				rule_revision: { kind: 'text' },
				period_from: { kind: 'date' },
				period_to: { kind: 'date' },
				date: { kind: 'date' },
				source_id: { kind: 'text' },
				source_family: {kind:'enum',values:['JOURNEY'],optional:true,help:'Actual original native journey wage decision. Absent retains the original physical work-offer source.'},
				week: { kind: 'date' },
				available_units: { kind: 'number' },
				excluded_quota_units: { kind: 'number' },
				provided_units: { kind: 'number' },
				entitled_units: { kind: 'number' },
				day_amount: { kind: 'number' },
				whole_day_pay: { kind: 'bool' },
				retained_amount: { kind: 'number' },
				settled_units: { kind: 'number' },
				target_amount: { kind: 'number' },
				paid_amount: { kind: 'number' }
			}
		}
	}, optional: true },
		replacement_discharge_source_ids:{kind:'json',shape:{kind:'list',of:{kind:'text'}},optional:true},
		replacement_time: { kind: 'json', shape: { kind: 'list', of: { kind: 'object', fields: {
		correction_observed_at:{kind:'text',optional:true},correction_source_ids:{kind:'list',of:{kind:'text'},optional:true},leave_code:{kind:'text',optional:true},available_from:{kind:'text',optional:true},recorded_at:{kind:'text',optional:true},recorded_on:{kind:'text',optional:true},pay_by:{kind:'text',optional:true}, reserved_on: { kind: 'text', optional: true },
			settled_on:{kind:'text',optional:true}, employment_id: {kind:'text',optional:true}, expires_on: {kind:'text',optional:true}, source_issued_on: {kind:'text',optional:true}, agreement_reference:{kind:'text',optional:true}, year_end:{kind:'text',optional:true},
		work_day_id: { kind: 'text' }, date: { kind: 'text' }, line: { kind: 'text' }, label: { kind: 'text' },
		hours: { kind: 'number', min: 0 }, rate: { kind: 'number', min: 0 }, amount: { kind: 'number', min: 0 }, paid: { kind: 'bool' }
	} } }, optional: true, help: 'Exact frozen replacement-time slices from this payslip’s calculation trace. Declared source policy admits calculated earned or PAID hours; cash outputs reserve exact original hours and become receipts only with the native PAID header and actual paid_at. No manual credit is manufactured.' },
		period_wage_ledger: { kind: 'json', shape: {
  "kind": "object",
  "fields": {
    "source_scope": {
      "kind": "enum",
      "values": [
        "CONTRACTED_WAGE_STEPS"
      ]
    },
    "employee_id": {
      "kind": "text"
    },
    "employment_id": {
      "kind": "text"
    },
    "company_id": {
      "kind": "text"
    },
    "currency": {
      "kind": "text"
    },
    "assessed_on": {
      "kind": "text"
    },
    "cash_scope_complete": {
      "kind": "bool"
    },
    "expected_source_keys": {
      "kind": "list",
      "of": {
        "kind": "text"
      }
    },
    "unavailable_source_keys": {
      "kind": "list",
      "of": {
        "kind": "text"
      }
    },
    "sources": {
      "kind": "list",
      "of": {
        "kind": "object",
        "fields": {
          "component_id": {
            "kind": "text"
          },
          "source_key": {
            "kind": "text"
          },
          "family": {
            "kind": "text"
          },
          "code": {
            "kind": "text"
          },
          "catalogue_id": {
            "kind": "text"
          },
          "settings_id": {
            "kind": "text"
          },
          "from": {
            "kind": "text"
          },
          "through": {
            "kind": "text"
          },
          "signed_amount": {
            "kind": "number"
          },
          "source_ids": {
            "kind": "list",
            "of": {
              "kind": "text"
            }
          },
          "dated_cash": {
            "kind": "list",
            "of": {
              "kind": "object",
              "fields": {
                "date": {
                  "kind": "text"
                },
                "signed_amount": {
                  "kind": "number"
                },
                "source_ids": {
                  "kind": "list",
                  "of": {
                    "kind": "text"
                  }
                },
                "contract_before_absence_gross": {
                  "kind": "number",
                  "optional": true
                },
                "employment_terms_id": {
                  "kind": "text",
                  "optional": true
                },
                "terms_snapshot_key": {
                  "kind": "text",
                  "optional": true
                }
              }
            }
          }
        }
      }
    },
    "work_evidence": {
      "kind": "list",
      "of": {
        "kind": "object",
        "fields": {
          "date": {
            "kind": "text"
          },
          "state": {
            "kind": "enum",
            "values": [
              "CLOSED",
              "UNRECORDED"
            ]
          },
          "actual_worked_hours": {
            "kind": "number",
            "optional": true
          },
          "normal_worked_hours": {
            "kind": "number",
            "optional": true
          },
          "source_ids": {
            "kind": "list",
            "of": {
              "kind": "text"
            }
          }
        }
      }
    }
  }
}, optional: true, help: 'Original calculation date/source gross and separately recorded ordinary-work evidence. Legacy missing captures remain unknown; this is never bank-payment proof.' },
		base: { kind: 'json', shape: {
		kind: 'list',
		of: { kind: 'object', fields: {
			allowance_evidence_ids: { kind: 'list', of: { kind: 'text' }, optional: true, help: 'Actual immutable class-qualified original contract dossier IDs used by this priced allowance.' },
 holiday_wage_sources: { kind: 'list', optional: true, of: { kind: 'object', fields: {
				date: { kind: 'text' }, employment_terms_id: { kind: 'text' }, settings_id: { kind: 'text' },
				expected: { kind: 'number' }, retained: { kind: 'number' }, added: { kind: 'number' }, reference: { kind: 'text' }, authority: { kind: 'text' }
			} } },
			component_code: { kind: 'text' }, amount: { kind: 'number' },
			wage_sources: { kind: 'list', optional: true, of: { kind: 'object', fields: {
				date: { kind: 'text' }, amount: { kind: 'number' }, employment_terms_id: { kind: 'text' },
				catalogue_id: { kind: 'text' }, contract_catalogue_id: { kind: 'text' }, payable_on: { kind: 'text' }, reference: { kind: 'text' }
			} } }
		} }
	} },
		proration: { kind: 'json', shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				component_code: { kind: 'text' },
				term_key: { kind: 'text' },
				from: { kind: 'text' },
				to: { kind: 'text' },
				basis: { kind: 'json', shape: {
		kind: 'union',
		by: 'by',
		arms: {
			CALENDAR_DAYS: { days: { kind: 'number', optional: true } },
			WORKING_DAYS: {},
			FIXED_DAYS: { days: { kind: 'number' } }
		}
	} },
				days: { kind: 'number', min: 0 },
				denominator: { kind: 'number' },
				unpaid_days: { kind: 'number', min: 0 },
				contract_amount: { kind: 'number' },
				prorated_amount: { kind: 'number' }
			}
		}
	} },
		statutory: { kind: 'json', shape: {
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
		adjustments: { kind: 'json', shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
                net_floor_basis: { kind: 'json', optional: true },
                ongoing_monthly_obligation: {kind:'json',optional:true},
                monthly_source_obligation: {kind:'json',optional:true,shape:{kind:'object',fields:{obligation:{kind:'json'},receipts:{kind:'list',of:{kind:'json'}},originalAmount:{kind:'number'},paidBefore:{kind:'number'},paymentAmount:{kind:'number'}}}},
				family: { kind: 'enum', values: ['JOURNEY','WORK_DAY', 'CLAIM', 'ADHOC', 'LEAVE', 'LOAN_REPAYMENT'] },
				source_id: { kind: 'text' },
				wage_attribution: { 
		kind: 'object',
		fields: {
			earned_from: { kind: 'text' },
			earned_to: { kind: 'text' },
			payable_on: { kind: 'text' },
			component_code: { kind: 'text' },
			increment_kind: {
				kind: 'enum',
				values: ['RETROSPECTIVE', 'ADMINISTRATIVE_DELAY'],
				optional: true
			},
			increment_decided_on: { kind: 'text', optional: true },
			post_exit_last_day: { kind: 'text', optional: true },
			post_exit_last_citizenship: { kind: 'enum', values: ['CITIZEN', 'PERMANENT_RESIDENT', 'FOREIGN'], optional: true },
			post_exit_payable_citizenship: { kind: 'enum', values: ['CITIZEN', 'PERMANENT_RESIDENT', 'FOREIGN'], optional: true },
			post_exit_status_reference: { kind: 'text', optional: true },
			purpose: {
				kind: 'enum',
				values: ['PAYMENT', 'CURRENT_WAGE_CORRECTION', 'PRIOR_CASH_REPAYMENT']
			},
			original_payslip_id: { kind: 'text', optional: true },
			original_source_id: { kind: 'text', optional: true },
			dated_cash: {
				kind: 'list',
				optional: true,
				of: {
					kind: 'object',
					fields: {
						date: { kind: 'text' },
						amount: { kind: 'number' },
						quantity: { kind: 'number', optional: true },
						assessed_for: { kind: 'record', of: { kind: 'number' }, optional: true },
						reference: { kind: 'text' },
						basis: { kind: 'enum', optional: true, values: ['BASIC', 'OTHER_NORMAL'] },
						leave_entry_id: { kind: 'text', optional: true }
					}
				}
			},
			evidence_reference: { kind: 'text' }
		}
	, optional: true },
				component_code: { kind: 'text' },
				reserved_line: { kind: 'enum', values: ['BASE'], optional: true },
				label: { kind: 'text' },
				bucket: {
					kind: 'enum',
					values: [
						'EARNING',
						'ABSENCE',
						'DEDUCTION',
						'NON_WAGE_PAYMENT',
						'EMPLOYER_COST',
						'INFORMATION'
					]
				},
				assessed_for: { kind: 'record', of: { kind: 'number' }, optional: true },
				amount: { kind: 'number' },
				quantity: { kind: 'number', optional: true },
				rate: { kind: 'number', optional: true },
				statutory_rule_key: { kind: 'text', optional: true },
				reporting_class: { kind: 'text', optional: true },
				declared_amount_basis: {
					kind: 'object',
					optional: true,
					fields: {
						classification: { kind: 'enum', values: ['DECLARED_DOCUMENTED'] },
						reference_fact: { kind: 'text' },
						amount_fact: { kind: 'text' },
						reference: { kind: 'text' },
						amount: { kind: 'number' },
						rule_date: { kind: 'text' }
					}
				},
				/** A late line's own period: recorded after that period was settled early, paid here. */
				earned_period: { kind: 'text', optional: true }
			}
		}
	} },
		/** An event-ledger slip can be settled only through its frozen payable tranches. */
		payment_mode: { kind: 'enum', values: ['LEGACY', 'EVENT_LEDGER'], default: 'EVENT_LEDGER' },
		status: {
			kind: 'state',
			initial: 'DRAFT',
			states: {
				DRAFT: { to: ['ON_HOLD', 'PAID'] },
				ON_HOLD: { to: ['DRAFT', 'PAID'] },
				PAID: { edit: 'none' }
			}
		},
		/** Settlement date: required with PAID (validated by the transform), never cleared. */
		paid_at: { kind: 'instant', optional: true },
		/** Frozen payment-date scope used by a source-controlled deduction order. */
		order_receipt_on: { kind: 'date', optional: true },
		order_receipt_timezone: { kind: 'text', optional: true },
		currency: { kind: 'currency' },
		gross: { kind: 'money', currency: 'currency' },
		total_deductions: { kind: 'money', currency: 'currency' },
		net: { kind: 'money', currency: 'currency' },
		/** Employee statutory liability not covered by this payroll's funds. */
		unfunded_contributions: { kind: 'money', currency: 'currency', default: 0 },
		/** Employee funds received outside payroll against the shortfall. */
		funding_received: { kind: 'money', currency: 'currency', default: 0 },
		funding_received_on: { kind: 'date', optional: true },
		funding_reference: { kind: 'text', optional: true },
		employer_cost: { kind: 'money', currency: 'currency' }
	},
	unique: [{ fields: ['payroll_run_id', 'employment_id'] }]
});
