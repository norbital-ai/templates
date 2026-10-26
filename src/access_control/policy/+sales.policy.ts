import { policy } from '@norbital-ai/bolt';
export default policy({
	description: 'sales commercial work scoped by order.',
	capabilities: {
		apps: ['operations']
	},
	automations: ['orders_cancel', 'orders_close'],
	grants: {
		ext_sales_orders: {
			read: { order: { is: { direction: { eq: 'sales' }, owner: { eq: { actor: 'id' } } } } },
			history: { order: { is: { direction: { eq: 'sales' }, owner: { eq: { actor: 'id' } } } } }
		},
		document_templates: { read: { status: { eq: 'published' } } },
		transactions: {
			read: { order: { is: { direction: { eq: 'sales' }, owner: { eq: { actor: 'id' } } } } },
			history: { order: { is: { direction: { eq: 'sales' }, owner: { eq: { actor: 'id' } } } } }
		},
		commission_statements: {
			read: { owner: { eq: { actor: 'id' } } },
			history: { owner: { eq: { actor: 'id' } } },
			queries: ['board']
		},
		parties: {
			queries: ['progress'],
			read: true
		},
		products: {
			read: true
		},
		warehouses: {
			read: true
		},
		stock_snapshots: {
			queries: ['erp_availability'],
			read: true
		},
		credit_snapshots: {
			read: true
		},
		commercial_settings: {
			read: true
		},
		pricing_floors: {
			history: true,
			read: true
		},
		commission_rules: {
			read: true
		},
		sys_user: {
			read: true,
			fields: ['id', 'name']
		},
		contacts: {
			read: true,
			create: true,
			update: true
		},
		orders: {
			read: {
				direction: {
					eq: 'sales'
				},
				owner: {
					eq: {
						actor: 'id'
					}
				}
			},
			history: {
				direction: {
					eq: 'sales'
				},
				owner: {
					eq: {
						actor: 'id'
					}
				}
			},
			create: {
				direction: {
					eq: 'sales'
				},
				owner: {
					eq: {
						actor: 'id'
					}
				}
			},
			// a confirmation needs a commercial manager; any other edit of an unconfirmed order is direct
			update: {
				previous: {
					direction: {
						eq: 'sales'
					},
					owner: {
						eq: {
							actor: 'id'
						}
					}
				},
				where: {
					direction: {
						eq: 'sales'
					},
					owner: {
						eq: {
							actor: 'id'
						}
					}
				},
				approval: (write, flow) =>
					write.record.status !== 'confirmed'
						? flow.allow()
						: write.changed.includes('status')
							? flow.step('Commercial review', { teams: ['commercial_managers'] })
							: flow.deny('errors.order_sealed')
			},
			moves: 'all',
			queries: [
				'document_preview',
				'document_versions',
				'confirmation_check',
				'quotation_export',
				'sealed_export',
				'ar_aging',
				'sales_analysis',
				'sales_detail',
				'commission'
			]
		},
		order_lines: {
			read: {
				order: {
					is: {
						direction: {
							eq: 'sales'
						},
						owner: {
							eq: {
								actor: 'id'
							}
						}
					}
				}
			},
			history: {
				order: {
					is: {
						direction: {
							eq: 'sales'
						},
						owner: {
							eq: {
								actor: 'id'
							}
						}
					}
				}
			},
			create: {
				order: {
					is: {
						direction: {
							eq: 'sales'
						},
						owner: {
							eq: {
								actor: 'id'
							}
						}
					}
				}
			},
			update: {
				previous: {
					order: {
						is: {
							direction: {
								eq: 'sales'
							},
							owner: {
								eq: {
									actor: 'id'
								}
							}
						}
					}
				},
				where: {
					order: {
						is: {
							direction: {
								eq: 'sales'
							},
							owner: {
								eq: {
									actor: 'id'
								}
							}
						}
					}
				}
			},
			delete: {
				order: {
					is: {
						direction: {
							eq: 'sales'
						},
						owner: {
							eq: {
								actor: 'id'
							}
						}
					}
				}
			}
		},
		activities: {
			read: {
				order: {
					is: {
						direction: {
							eq: 'sales'
						},
						owner: {
							eq: {
								actor: 'id'
							}
						}
					}
				}
			},
			history: {
				order: {
					is: {
						direction: {
							eq: 'sales'
						},
						owner: {
							eq: {
								actor: 'id'
							}
						}
					}
				}
			},
			create: {
				order: {
					is: {
						direction: {
							eq: 'sales'
						},
						owner: {
							eq: {
								actor: 'id'
							}
						}
					}
				}
			},
			update: {
				previous: {
					order: {
						is: {
							direction: {
								eq: 'sales'
							},
							owner: {
								eq: {
									actor: 'id'
								}
							}
						}
					}
				},
				where: {
					order: {
						is: {
							direction: {
								eq: 'sales'
							},
							owner: {
								eq: {
									actor: 'id'
								}
							}
						}
					}
				}
			}
		},
		source_payments: {
			queries: ['ledger'],
			history: {
				order: {
					is: {
						direction: {
							eq: 'sales'
						},
						owner: {
							eq: {
								actor: 'id'
							}
						}
					}
				}
			},
			read: {
				order: {
					is: {
						direction: {
							eq: 'sales'
						},
						owner: {
							eq: {
								actor: 'id'
							}
						}
					}
				}
			}
		},
		source_sales_lines: {
			history: { order: { is: { direction: { eq: 'sales' }, owner: { eq: { actor: 'id' } } } } },
			read: {
				order: {
					is: {
						direction: {
							eq: 'sales'
						},
						owner: {
							eq: {
								actor: 'id'
							}
						}
					}
				}
			}
		}
	}
});
