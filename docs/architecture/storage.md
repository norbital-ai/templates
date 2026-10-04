> Superseded target: the user's final small-collection/runtime-behaviours instruction in TAKEOVER.md overrides all OPERATIONAL_KEEP and compatibility transition proposals below. This inventory remains evidence of original fields, identity, access and calculation ownership only.

> Reference audit only. The sole active plan is [TAKEOVER.md](../TAKEOVER.md). Historical ownership/implementation proposals are not authorization; the two-schema dynamic-input model overrides them.

# Storage architecture: operational records versus snapshot-defined inputs

Reclassified 2026-10-03 following the corrected architecture requirement. The previous KEEP/CONSOLIDATE classification is superseded: the existence of a dedicated dossier model or an immutable input does **not** justify keeping that input table.

Jurisdiction-authored input dossiers belong in dynamic JSON on the employment profile or governing entity, validated by canonical **employee_input_schema** / **entity_input_schema** JSON schemas in the applicable immutable configuration snapshot. The same schemas drive dynamic forms; there are no fixed per-law source columns or forms. Source implements generic admission, schema resolution, evidence ownership, original-value binding, scope, clocks, and conservation. Country changes modify snapshots, not source models, collections, or country-specific branches. No new universal JSON table is proposed.

This is a read-only source audit of all 243 current models, matching collections, relationships, access grants and library/automation references. Only this document changed. No runtime, data inspection, migration or tests were performed. Classifications describe the **target architecture**; current consumer contracts remain listed to plan a compatible transition.

**INPUT_MOVE_TO_EMPLOYMENT_JSON: 78** · **INPUT_MOVE_TO_ENTITY_JSON: 21** · **OPERATIONAL_KEEP: 133** · **NEEDS_EVIDENCE: 11**.

## Classification semantics

- **INPUT_MOVE_TO_EMPLOYMENT_JSON:** move the complete authored dossier field set below into the actual worker/employment profile's snapshot-schema input namespace. Keep dossier identity, actor scope, source files, documentary chronology and amendments as schema-validated values. A nonemployment recipient or platform worker uses its actual equivalent profile; never invent an employment.
- **INPUT_MOVE_TO_ENTITY_JSON:** move the complete authored dossier field set into the actual payer/operator/authority/other governing entity's snapshot-schema input namespace. Where one dossier names several entities, preserve each original role rather than choosing the company by default.
- **OPERATIONAL_KEEP:** retain generic identity-bearing operational records, captures, cash movements, allocations, workflow occurrences, outputs and configuration-snapshot infrastructure. This does **not** retain hardcoded jurisdiction input columns: any jurisdiction-specific input payload inside these records moves to the profile/entity JSON and the record pins its immutable schema/source reference.
- **NEEDS_EVIDENCE:** resolve mixed actor ownership, input-versus-derived-output fields, or generic evidence/source identity before selecting the exact JSON host. This is a bounded migration decision, not permission to leave dedicated input tables indefinitely.

The detailed manifest names every authored physical field, relationship, identity constraint and current consumer. For input classifications, **every listed authored input field** moves as part of the schema-backed dossier. Derived operational outputs and physical ID/creation/approval/tenant-system metadata are not authored inputs: system metadata maps to generic dossier identity/audit metadata; derived snapshot/outcome fields remain immutable generic operational captures tied to the accepted JSON source. Listed source-parent relationships become explicit typed identity references validated by the generic engine, not unvalidated JSON strings. Original paid captures remain operational frozen outputs.

## Compatible migration boundaries

| Boundary | Target | Preserve |
|---|---|---|
| Employment/recipient qualifications, declarations, contract/retirement/lifecycle sources, authority credit dispositions, reimbursement original books | Employment or actual recipient profile JSON | Original dossier ID; snapshot/schema version and hash; actor and payer; exact scalar attestation; source-file ID/hash/owning field; received/known/effective dates; original/amendment/predecessor identities |
| Employer/entity filing elections, wage source declarations, FX/foreign-wage protocols, authority instruments, annual tax certificate instructions, scheme/legal policy input | Governing entity JSON | Exact entity role, original issuer and instrument; period/currency; competent original reference; signed/issued/known dates; schema-authored required fields and conditions |
| Cash receipts, payment events, allocations, priced settlements, assessment outputs, delivery/filing occurrences, paid payroll, source utilisation ledgers | Generic operational records | Original monetary amounts; exact allocation identity; immutable paid captures; actual recipient; idempotent execution; transaction boundaries; original schema/source pins |
| Mixed original bank-source books and generic evidence | Resolve before migration | Whether each row is an input attestation, actual cash ingestion, or both; actual actor host; original global source identity and all frozen consumers |

A filing's **input protocol/dossier** moves to entity JSON; the actual sent/received filing occurrence and operational delivery receipt stay. An authority decision's **documentary facts** move to profile/entity JSON; its generic execution/allocation outcome stays. Actual money and independently binding legal credit are separate effects even when the source JSON is shared.

## Exact mixed-field boundary

The manifest gives exact current keys; the following exceptions prevent input migration from converting derived output into user-authored JSON:

| Current model | Fields moved as authored snapshot-schema inputs | Fields/effects retained as generic operational outputs |
|---|---|---|
| `employment_terms` | `leave_remuneration_sources`, `leave_remuneration_source_file`, `lifecycle_source_file`, `lifecycle_source_references`, `facts`, source-authored standing/classification/pay/schedule/allowance contract particulars in its manifest | `lifecycle_assessment`, `lifecycle_findings`, derived summaries and consumed effective-term capture; original priced payroll remains unchanged |
| `employments` | jurisdiction-bearing `exit_facts`, lifecycle/retirement source dossier/file/reference fields; exact keys in manifest | generic employer/worker relationship identity, service/effective dates, operational workflow; derived `retirement_assessment`, `lifecycle_assessment`, `lifecycle_findings` and paid captures |
| `deduction_authorizations` | `property_liability` original dossier, `medical_source`, `facts`, original permission/basis/source files, original request/consent/withdrawal terms and documentary amount/currency/component facts | engine-derived `specific_cap_amount`, `property_liability_identity`, `statutory_recovery_identity`, `medical_bill_key`, immutable `snapshot`, reservation and actual recovery/return allocation effects |
| `sg_sdl_cases` | original `reference`, `contribution_month`, `kind` and authority assessment/application/decision documentary fields, including original files/dates | real payment/refund/set-off allocation effects are represented by generic money operations, not assumed from a case marker |
| `payable_tranches`, `payment_events`, `payment_allocations`, `source_cash_payments` | payment-method/source qualification dossier payloads and any jurisdiction-specific documentary extensions | exact original actor/currency/gross/net/tax/deduction amounts, dates, source pins, real cash identity, settlement/allocation state |
| all input-classified families | every non-derived authored field listed in the manifest, including nested typed/custom facts and document identity | derived `snapshot` / `source_snapshot` / projection/calculation/assessment/findings fields and hidden derived identities stay in generic capture/output metadata; never accepted as authoritative input |
| configuration catalogues and `statutory_contributions` | law-specific policy data and JSON schema definitions are snapshot artifacts, not entity user values or source-coded fixed columns | generic immutable snapshot identity, schema/code/lineage identity and lookup/publication infrastructure |

A mixed existing table is not automatically kept just because one derived field remains: migrate its inputs, repoint generic outputs to immutable dossier IDs, then retire the dedicated table once the bounded compatibility contract is satisfied. Exact derived-versus-authored status comes from its current collection transform and listed consumer, not a client's submitted `snapshot` label.

## JSON source identity and dynamic forms

Each accepted dossier resides in its actual profile/entity JSON with a stable source-instance identity and `source_schema` identity/version bound to the immutable snapshot's `employee_input_schema` or `entity_input_schema`. Preserve the schema identifier, snapshot identifier/version/hash, original dossier/legacy ID, actual actor/payer, source-file ownership/hash, approval/knowledge/effective clocks and predecessor/amendment links. This is a generic envelope within the host JSON, **not a new declaration model**. Snapshot-authored JSON schemas define family names, field names, constraints, evidence roles and dynamic form layout; generic engine code interprets them. Existing file ACL/provenance and operational identity references are mapped explicitly during migration.

## Financial refund, credit and restitution target

1. Authority decisions, scope declarations, refund applications, reimbursement original-income/period/rate books, and restitution rights dossiers become schema-backed inputs. Similarity is handled by reusable snapshot schemas and generic interpreters, not additional dedicated tables.
2. Actual incoming/outgoing cash, component allocations, source utilisation, paid band captures and receipt delivery remain operational. A bank refund does not itself reverse salary credit or restore rights; the operational outcome pins its independently qualified decision dossier.
3. The three redelivery operational families currently have similar fields but different native/prior/historical parent identities and uniqueness. They are OPERATIONAL_KEEP for now; a generic operational receipt abstraction can be considered only with injective identity and conservation mapping. This does not justify retaining their separate documentary input tables.
4. Restitution cases/discharges and credit reversals move their original decision/rights facts to profile JSON. Restitution receipts retain actual money identity, kind, amount, sequence and source pins. Original gross, paid net, tax and other deductions remain immutable capture values.
5. Conditional refund allocation/notice corrections are schema-backed amendments tied to the same original source identity. Original physical cash and actual report/notification occurrences are operational, not new monetary entitlements.
6. Country-named native source tables such as wage declarations and foreign-wage declarations do not become permanent generic storage by replacing their country check with a capability flag. Their dossier fields move to entity JSON; the capability and validator belong to the configuration snapshot.

## Migration sequence and compatibility

1. Inventory current dossier IDs, actor hosts, schema shapes, source files, approval/knowledge clocks, predecessors, all relational and dynamic consumers, and paid capture references using the manifest below. Resolve every NEEDS_EVIDENCE host/field boundary.
2. Publish equivalent immutable snapshot JSON schemas and generic admission contracts. Existing identifiers become generic dossier identities; no arbitrary client-generated authoritative attestation and no new country-specific source schema classes.
3. Materialize JSON inputs with exact original values and source provenance. Reject known contradictions; distinguish incomplete historical inputs from accepted evidenced sources. Preserve source hashes and legal retention/hold metadata.
4. Switch current writers and generic consumers together, with an explicit cutover version. Use a bounded read-compatibility resolver for historical IDs while migrating references. Do not silently reprice or reinterpret paid payroll and original cash.
5. Operational frozen outputs retain their original source IDs and schema versions. Provide an injective legacy-ID-to-dossier mapping and verify all referenced files, allocations and predecessor chains. Dynamic snapshots and textual source_kind/source_id references require explicit mapping, not only FK rewrites.
6. Stop new writes to superseded input tables, migrate remaining live references, and retire the compatibility path under documented completion criteria. Dedicated dossier tables are not retained forever. Because model removal is a drop, perform no removal until a separately reviewed migration preserves all operational/history contracts.

## ACL, retention and identity requirements

JSON hosting does not broaden access. Schema-backed dossier sections require the existing actor/entity scope and field/file permissions, including sensitive medical, tax, authority and worker identity records. Keep the canonical historical sys_file.field provenance or an authenticated mapped ownership record; a universal file wildcard is not acceptable. Preserve immutable received/known/effective timestamps, exact attested scalars, independent amendment identities, holds and retention dates. Repeated bank references across inputs and operational events must be conserved once through actual source allocation, never counted once per new JSON object.

## Complete 243-model inventory

F = authored physical fields; J = JSON fields (unshaped count in parentheses); FK/O/In = outgoing/owned/incoming relationship counts. Runtime references are literal name references, including metadata/type registries, not execution coverage. ACL columns identify direct named collection grants. Names are exact existing model directories; classifications are target migration boundaries.

| Model | Decision | F / J | FK / O / In | Collection surface | Runtime files | Direct grant policies |
|---|---|---:|---:|---|---:|---|
| `adhoc_catalogue` | OPERATIONAL_KEEP | 29 / 0 (0) | 1 / 1 / 5 | read, create, update, delete | 36 | employee, hr_controller, hr_manager, leave_encashment_on_exit_automation, scheduled_entries_automation, senior_management, statutory_drift_automation |
| `adhoc_requests` | OPERATIONAL_KEEP | 20 / 1 (1) | 10 / 0 / 10 | read, create, update, actions, delete | 40 | employee, hr_controller, hr_manager, leave_encashment_on_exit_automation, manager, scheduled_entries_automation, senior_management, supervisor |
| `allowance_catalogue` | OPERATIONAL_KEEP | 28 / 0 (0) | 1 / 1 / 0 | read, create, update, delete | 17 | employee, hr_controller, hr_manager, senior_management, statutory_drift_automation |
| `annual_certified_list_assets` | OPERATIONAL_KEEP | 5 / 0 (0) | 2 / 0 / 0 | read, create | 1 | hr_controller, hr_manager, senior_management |
| `annual_certified_lists` | OPERATIONAL_KEEP | 26 / 7 (7) | 2 / 0 / 2 | read, create, update | 1 | hr_controller, hr_manager, senior_management |
| `annual_employer_filings` | OPERATIONAL_KEEP | 20 / 5 (5) | 2 / 0 / 1 | read, create, update | 1 | hr_controller, hr_manager, senior_management |
| `annual_income_documents` | OPERATIONAL_KEEP | 46 / 7 (7) | 3 / 0 / 1 | read, create, update | 3 | hr_controller, hr_manager, senior_management |
| `annual_monthly_return_receipts` | OPERATIONAL_KEEP | 6 / 1 (1) | 0 / 0 / 0 | read, create | 1 | no direct named grant found |
| `annual_remittance_returns` | OPERATIONAL_KEEP | 24 / 6 (6) | 2 / 0 / 1 | read, create, update | 1 | hr_controller, hr_manager, senior_management |
| `annual_tax_assessments` | OPERATIONAL_KEEP | 20 / 6 (6) | 3 / 0 / 4 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `annual_tax_credit_payroll_instructions` | INPUT_MOVE_TO_ENTITY_JSON | 2 / 0 (0) | 2 / 1 / 0 | read, create, update | 3 | hr_controller, hr_manager, senior_management |
| `annual_tax_credit_payroll_sources` | INPUT_MOVE_TO_ENTITY_JSON | 13 / 0 (0) | 3 / 0 / 2 | read, create, update | 5 | hr_controller, hr_manager, senior_management |
| `annual_tax_credit_settlements` | OPERATIONAL_KEEP | 22 / 0 (0) | 5 / 1 / 0 | read, create, update | 9 | hr_controller, hr_manager, senior_management |
| `annual_tax_settlement_events` | OPERATIONAL_KEEP | 26 / 7 (7) | 6 / 0 / 1 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `annual_tax_settlement_vouchers` | OPERATIONAL_KEEP | 15 / 4 (4) | 1 / 0 / 1 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `approved_tax_credit_certificates` | INPUT_MOVE_TO_ENTITY_JSON | 22 / 0 (0) | 2 / 0 / 3 | read, queries, create, update | 4 | hr_controller, hr_manager, senior_management |
| `benefit_case_assessment_losses` | OPERATIONAL_KEEP | 4 / 0 (0) | 1 / 0 / 0 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `benefit_case_assessment_recipients` | OPERATIONAL_KEEP | 12 / 0 (0) | 1 / 0 / 2 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `benefit_case_assessments` | OPERATIONAL_KEEP | 17 / 0 (0) | 2 / 0 / 9 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `benefit_case_authority_applications` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 22 / 0 (0) | 2 / 0 / 1 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `benefit_case_authority_procedures` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 13 / 0 (0) | 2 / 0 / 1 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `benefit_case_cash_return_allocations` | OPERATIONAL_KEEP | 3 / 0 (0) | 2 / 0 / 0 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `benefit_case_cash_returns` | OPERATIONAL_KEEP | 10 / 0 (0) | 1 / 0 / 1 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `benefit_case_claimant_receipt_scopes` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 8 / 0 (0) | 2 / 0 / 1 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `benefit_case_claimant_receipts` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 9 / 0 (0) | 2 / 0 / 0 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `benefit_case_credit_dispositions` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 7 / 0 (0) | 2 / 0 / 0 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `benefit_case_credit_scopes` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 8 / 0 (0) | 2 / 0 / 2 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `benefit_case_cutoffs` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 9 / 0 (0) | 1 / 1 / 0 | read, create | 1 | hr_controller, hr_manager, senior_management |
| `benefit_case_decisions` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 14 / 0 (0) | 2 / 1 / 1 | read, queries, create | 1 | hr_controller, hr_manager, senior_management |
| `benefit_case_earnings` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 9 / 0 (0) | 2 / 1 / 1 | read, create | 6 | hr_controller, hr_manager, senior_management |
| `benefit_case_employee_recovery_allocations` | OPERATIONAL_KEEP | 5 / 0 (0) | 3 / 0 / 1 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `benefit_case_employee_recovery_receipts` | OPERATIONAL_KEEP | 7 / 0 (0) | 2 / 0 / 1 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `benefit_case_expense_portions` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 13 / 0 (0) | 1 / 1 / 1 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `benefit_case_expenses` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 16 / 0 (0) | 2 / 1 / 2 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `benefit_case_government_refund_allocations` | OPERATIONAL_KEEP | 5 / 0 (0) | 2 / 0 / 0 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `benefit_case_government_refund_receipts` | OPERATIONAL_KEEP | 8 / 0 (0) | 1 / 0 / 1 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `benefit_case_incident_notices` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 21 / 0 (0) | 2 / 0 / 1 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `benefit_case_liability_agreements` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 8 / 0 (0) | 2 / 0 / 2 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `benefit_case_liability_allocations` | OPERATIONAL_KEEP | 6 / 0 (0) | 3 / 0 / 0 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `benefit_case_liability_parties` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 8 / 0 (0) | 1 / 0 / 1 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `benefit_case_liable_earnings` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 10 / 0 (0) | 2 / 0 / 1 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `benefit_case_member_losses` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 9 / 0 (0) | 3 / 0 / 1 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `benefit_case_movements` | OPERATIONAL_KEEP | 7 / 0 (0) | 2 / 0 / 0 | read, create, update | 5 | hr_controller, hr_manager, senior_management |
| `benefit_case_period_days` | OPERATIONAL_KEEP | 16 / 0 (0) | 1 / 1 / 1 | read, create | 5 | hr_controller, hr_manager, senior_management |
| `benefit_case_periods` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 13 / 0 (0) | 4 / 1 / 4 | read, create | 9 | hr_controller, hr_manager, senior_management |
| `benefit_case_plans` | OPERATIONAL_KEEP | 16 / 0 (0) | 2 / 1 / 3 | read, create, queries | 3 | hr_controller, hr_manager, senior_management |
| `benefit_case_qualifications` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 14 / 0 (0) | 2 / 1 / 1 | read, create, queries | 2 | hr_controller, hr_manager, senior_management |
| `benefit_case_refund_orders` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 8 / 0 (0) | 2 / 0 / 2 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `benefit_case_refund_portions` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 4 / 0 (0) | 2 / 0 / 1 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `benefit_case_reimbursement_claims` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 8 / 1 (0) | 2 / 0 / 2 | read, create | 6 | hr_controller, hr_manager, senior_management |
| `benefit_case_reimbursement_decisions` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 7 / 0 (0) | 2 / 0 / 2 | read, create | 5 | hr_controller, hr_manager, senior_management |
| `benefit_case_reimbursement_employer_claims` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 7 / 0 (0) | 2 / 0 / 1 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `benefit_case_reimbursement_employer_scopes` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 8 / 1 (0) | 2 / 0 / 2 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `benefit_case_reimbursement_months` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 7 / 0 (0) | 2 / 0 / 1 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `benefit_case_reimbursement_premiums` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 11 / 0 (0) | 4 / 0 / 1 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `benefit_case_reimbursement_rates` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 10 / 0 (0) | 2 / 0 / 2 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `benefit_case_reimbursement_receipt_allocations` | OPERATIONAL_KEEP | 4 / 0 (0) | 2 / 0 / 1 | read, create | 6 | hr_controller, hr_manager, senior_management |
| `benefit_case_reimbursement_receipts` | OPERATIONAL_KEEP | 7 / 0 (0) | 1 / 0 / 1 | read, create | 6 | hr_controller, hr_manager, senior_management |
| `benefit_cases` | OPERATIONAL_KEEP | 20 / 0 (0) | 2 / 0 / 21 | read, queries, create, update | 29 | hr_controller, hr_manager, leave_encashment_on_exit_automation, obligation_calendar_automation, scheduled_entries_automation, senior_management |
| `claim_catalogue` | OPERATIONAL_KEEP | 13 / 0 (0) | 1 / 1 / 1 | read, create, update, delete | 14 | employee, hr_controller, hr_manager, senior_management, statutory_drift_automation |
| `claim_requests` | OPERATIONAL_KEEP | 12 / 1 (1) | 3 / 0 / 0 | read, create, update, delete | 13 | employee, hr_controller, hr_manager, manager, senior_management, supervisor |
| `clearance_return_filings` | INPUT_MOVE_TO_ENTITY_JSON | 29 / 8 (8) | 2 / 0 / 0 | read, create, update, actions | 5 | hr_controller, hr_manager, senior_management |
| `companies` | OPERATIONAL_KEEP | 17 / 0 (0) | 0 / 0 / 119 | read, create, update, delete | 78 | employee, holiday_import_automation, hr_controller, hr_manager, kiosk, late_arrival_notice_automation, leave_encashment_on_exit_automation, manager, obligation_calendar_automation, scheduled_entries_automation, senior_management, supervisor |
| `company_facts` | INPUT_MOVE_TO_ENTITY_JSON | 2 / 0 (0) | 1 / 1 / 0 | read, create, update, delete | 7 | employee, hr_controller, hr_manager, leave_encashment_on_exit_automation, manager, obligation_calendar_automation, scheduled_entries_automation, senior_management, supervisor |
| `component_payment_agreements` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 9 / 1 (1) | 5 / 0 / 2 | read, create, queries | 2 | hr_controller, hr_manager, senior_management |
| `component_payment_allocations` | OPERATIONAL_KEEP | 5 / 0 (0) | 5 / 0 / 0 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `component_release_receipts` | OPERATIONAL_KEEP | 13 / 1 (1) | 3 / 0 / 0 | read, create | 2 | hr_controller, hr_manager |
| `component_suspension_instructions` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 13 / 1 (1) | 3 / 0 / 1 | read, create | 3 | hr_controller, hr_manager |
| `conditional_refund_cash_corrections` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 7 / 2 (2) | 4 / 0 / 1 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `conditional_refund_cash_sources` | OPERATIONAL_KEEP | 19 / 2 (2) | 2 / 0 / 1 | read, create | 6 | hr_controller, hr_manager, senior_management |
| `conditional_refund_notice_corrections` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 8 / 1 (1) | 4 / 0 / 1 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `conditional_refund_notices` | OPERATIONAL_KEEP | 7 / 1 (1) | 4 / 0 / 1 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `conditional_refund_reports` | OPERATIONAL_KEEP | 13 / 1 (1) | 2 / 0 / 1 | read, create, update | 1 | hr_controller, hr_manager, senior_management |
| `contribution_statement_months` | INPUT_MOVE_TO_ENTITY_JSON | 7 / 0 (0) | 1 / 1 / 0 | read, create, update | 1 | hr_controller, hr_manager, senior_management |
| `deduction_authorization_restrictions` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 6 / 0 (0) | 4 / 0 / 0 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `deduction_authorization_withdrawals` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 4 / 0 (0) | 4 / 0 / 0 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `deduction_authorizations` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 27 / 5 (5) | 4 / 0 / 4 | read, create | 8 | hr_controller, hr_manager, senior_management |
| `earnings_pool_members` | OPERATIONAL_KEEP | 17 / 0 (0) | 4 / 1 / 1 | read, create, update | 2 | hr_controller, hr_manager, senior_management |
| `earnings_pools` | OPERATIONAL_KEEP | 18 / 0 (0) | 1 / 0 / 1 | read, create, update, queries | 2 | hr_controller, hr_manager, senior_management |
| `employees` | OPERATIONAL_KEEP | 25 / 0 (0) | 1 / 0 / 90 | read, create, update, delete, queries, actions | 39 | employee, hr_controller, hr_manager, kiosk, late_arrival_notice_automation, leave_encashment_on_exit_automation, manager, obligation_calendar_automation, scheduled_entries_automation, senior_management, supervisor |
| `employer_assessment_events` | OPERATIONAL_KEEP | 26 / 3 (3) | 6 / 0 / 3 | read, create | 2 | hr_controller, hr_manager |
| `employer_assessment_policies` | NEEDS_EVIDENCE | 26 / 0 (0) | 1 / 1 / 1 | read, create, update, delete | 3 | hr_controller, hr_manager |
| `employer_assessments` | OPERATIONAL_KEEP | 26 / 4 (4) | 3 / 0 / 2 | read, create, queries | 5 | hr_controller, hr_manager |
| `employment_history` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 8 / 0 (0) | 4 / 1 / 9 | read, queries, create, update, delete | 20 | employee, hr_controller, hr_manager, leave_encashment_on_exit_automation, manager, scheduled_entries_automation, senior_management, supervisor |
| `employment_income_events` | OPERATIONAL_KEEP | 35 / 3 (3) | 6 / 0 / 4 | read, create, update, actions, queries | 8 | hr_controller, hr_manager, senior_management |
| `employment_inquiries` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 10 / 0 (0) | 3 / 0 / 1 | read, queries, create | 1 | hr_controller, hr_manager, senior_management |
| `employment_inquiry_authorities` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 13 / 0 (0) | 6 / 0 / 2 | read, create | 1 | hr_controller, hr_manager, senior_management |
| `employment_statutory_facts` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 7 / 2 (2) | 3 / 1 / 0 | read, create, update, delete | 14 | employee, hr_controller, hr_manager, leave_encashment_on_exit_automation, manager, scheduled_entries_automation, senior_management, supervisor |
| `employment_terms` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 39 / 4 (4) | 3 / 1 / 1 | read, create, update, delete | 47 | employee, hr_controller, hr_manager, kiosk, leave_encashment_on_exit_automation, manager, obligation_calendar_automation, scheduled_entries_automation, senior_management, supervisor |
| `employment_wage_periods` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 34 / 1 (1) | 3 / 1 / 2 | read, queries, create, update, delete | 12 | hr_controller, hr_manager, manager, senior_management, supervisor |
| `employments` | OPERATIONAL_KEEP | 19 / 6 (6) | 2 / 0 / 70 | read, create, update, delete | 124 | employee, hr_controller, hr_manager, kiosk, late_arrival_notice_automation, leave_encashment_on_exit_automation, manager, obligation_calendar_automation, scheduled_entries_automation, senior_management, supervisor |
| `external_original_bank_source_corrections` | NEEDS_EVIDENCE | 11 / 2 (2) | 4 / 0 / 1 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `external_original_bank_sources` | NEEDS_EVIDENCE | 19 / 2 (2) | 2 / 0 / 1 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `fact_evidence` | NEEDS_EVIDENCE | 7 / 1 (1) | 1 / 1 / 0 | read, create, update, delete | 41 | hr_controller, hr_manager, leave_encashment_on_exit_automation, obligation_calendar_automation, scheduled_entries_automation, senior_management |
| `historical_bank_sources` | OPERATIONAL_KEEP | 12 / 2 (2) | 3 / 0 / 4 | read, create | 7 | hr_controller, hr_manager, senior_management |
| `historical_prior_credit_redeliveries` | OPERATIONAL_KEEP | 16 / 1 (1) | 9 / 0 / 1 | read, create, actions | 6 | hr_controller, hr_manager, senior_management |
| `historical_prior_credit_reversals` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 9 / 1 (1) | 7 / 0 / 2 | read, create | 5 | hr_controller, hr_manager, senior_management |
| `historical_wage_cash_returns` | OPERATIONAL_KEEP | 16 / 1 (1) | 6 / 0 / 1 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `income_distribution_pools` | OPERATIONAL_KEEP | 17 / 1 (1) | 2 / 0 / 1 | read, create, actions | 2 | hr_controller, hr_manager, obligation_calendar_automation |
| `income_inventory_filings` | OPERATIONAL_KEEP | 8 / 1 (1) | 1 / 0 / 0 | read, create, update | 2 | hr_controller, hr_manager, senior_management |
| `income_recipients` | OPERATIONAL_KEEP | 10 / 0 (0) | 2 / 0 / 2 | read, create, update | 5 | hr_controller, hr_manager, obligation_calendar_automation, senior_management |
| `income_reporting_registrations` | INPUT_MOVE_TO_ENTITY_JSON | 11 / 2 (2) | 1 / 0 / 0 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `income_return_filings` | OPERATIONAL_KEEP | 36 / 13 (13) | 1 / 0 / 4 | read, create, update, queries | 9 | hr_controller, hr_manager, senior_management |
| `insurance_policy_dispositions` | INPUT_MOVE_TO_ENTITY_JSON | 37 / 8 (8) | 5 / 0 / 2 | read, queries, create | 2 | hr_controller, hr_manager, senior_management |
| `insurance_policy_restatement_registers` | INPUT_MOVE_TO_ENTITY_JSON | 18 / 2 (2) | 0 / 0 / 1 | read, create, queries | 2 | hr_controller, hr_manager, senior_management |
| `insurance_policy_restatements` | INPUT_MOVE_TO_ENTITY_JSON | 28 / 6 (6) | 5 / 0 / 1 | read, create, queries | 3 | hr_controller, hr_manager, senior_management |
| `insurance_policy_vouchers` | OPERATIONAL_KEEP | 16 / 2 (2) | 0 / 0 / 2 | read, create, queries | 2 | hr_controller, hr_manager, senior_management |
| `jurisdiction_holidays` | INPUT_MOVE_TO_ENTITY_JSON | 17 / 1 (1) | 1 / 0 / 0 | read, create, update, delete, queries, actions | 20 | employee, holiday_import_automation, hr_controller, hr_manager, leave_encashment_on_exit_automation, manager, scheduled_entries_automation, senior_management, supervisor |
| `jurisdiction_settings` | OPERATIONAL_KEEP | 27 / 0 (0) | 1 / 0 / 20 | read, create, update, delete, actions | 109 | employee, hr_controller, hr_manager, kiosk, late_arrival_notice_automation, leave_encashment_on_exit_automation, manager, obligation_calendar_automation, scheduled_entries_automation, senior_management, statutory_drift_automation, supervisor |
| `leave_catalogue` | OPERATIONAL_KEEP | 36 / 0 (0) | 1 / 1 / 2 | read, create, update, delete | 21 | employee, hr_controller, hr_manager, leave_encashment_on_exit_automation, manager, scheduled_entries_automation, senior_management, statutory_drift_automation, supervisor |
| `leave_contact_records` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 10 / 0 (0) | 1 / 0 / 0 | read, create | 1 | hr_controller, hr_manager, senior_management |
| `leave_entries` | OPERATIONAL_KEEP | 37 / 1 (0) | 10 / 0 / 8 | read, create, queries | 31 | employee, hr_controller, hr_manager, late_arrival_notice_automation, leave_encashment_on_exit_automation, manager, scheduled_entries_automation, senior_management, supervisor |
| `leave_transfer_opening_sources` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 21 / 0 (0) | 4 / 0 / 1 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `loan_catalogue` | OPERATIONAL_KEEP | 15 / 0 (0) | 1 / 1 / 1 | read, create, update, delete | 11 | employee, hr_controller, hr_manager, senior_management, statutory_drift_automation |
| `loan_repayments` | OPERATIONAL_KEEP | 4 / 0 (0) | 3 / 1 / 0 | read, delete | 10 | hr_controller, hr_manager, obligation_calendar_automation, senior_management |
| `loans` | OPERATIONAL_KEEP | 19 / 1 (1) | 2 / 0 / 1 | read, create, update, delete | 19 | employee, hr_controller, hr_manager, obligation_calendar_automation, senior_management |
| `medical_copayment_movements` | OPERATIONAL_KEEP | 9 / 0 (0) | 7 / 1 / 2 | read, actions, create | 2 | hr_controller, hr_manager, senior_management |
| `medical_copayment_return_instructions` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 7 / 0 (0) | 5 / 0 / 0 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `noncontract_settlements` | OPERATIONAL_KEEP | 7 / 0 (0) | 2 / 0 / 0 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `notice_compensation_cases` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 38 / 10 (10) | 4 / 0 / 2 | read, update, create, queries, actions | 2 | hr_controller, hr_manager |
| `notice_compensation_receipts` | OPERATIONAL_KEEP | 5 / 0 (0) | 4 / 0 / 0 | read, create | 1 | hr_controller, hr_manager |
| `obligation_instances` | OPERATIONAL_KEEP | 19 / 0 (0) | 4 / 1 / 1 | read, create, update | 6 | hr_controller, hr_manager, obligation_calendar_automation, scheduled_entries_automation, senior_management |
| `original_cash_successor_bindings` | NEEDS_EVIDENCE | 9 / 1 (1) | 6 / 0 / 1 | read, actions, create | 4 | hr_controller, hr_manager, senior_management |
| `original_component_partitions` | OPERATIONAL_KEEP | 5 / 2 (2) | 4 / 0 / 1 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `original_financial_component_sources` | NEEDS_EVIDENCE | 9 / 2 (2) | 8 / 0 / 0 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `original_wage_cash_corrections` | NEEDS_EVIDENCE | 9 / 2 (2) | 4 / 0 / 1 | read, create, queries | 2 | hr_controller, hr_manager, senior_management |
| `original_wage_cash_receipts` | OPERATIONAL_KEEP | 16 / 1 (1) | 5 / 0 / 2 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `original_wage_cash_returns` | OPERATIONAL_KEEP | 16 / 1 (1) | 4 / 0 / 0 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `original_wage_cash_scopes` | NEEDS_EVIDENCE | 6 / 2 (2) | 4 / 0 / 0 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `payable_tranches` | OPERATIONAL_KEEP | 15 / 0 (0) | 1 / 1 / 3 | read | 19 | employee, hr_controller, hr_manager, senior_management |
| `payment_allocations` | OPERATIONAL_KEEP | 9 / 0 (0) | 2 / 1 / 9 | read | 16 | employee, hr_controller, hr_manager, senior_management |
| `payment_events` | OPERATIONAL_KEEP | 21 / 3 (3) | 2 / 0 / 7 | read, create | 15 | hr_controller, hr_manager, senior_management |
| `payment_holds` | OPERATIONAL_KEEP | 21 / 0 (0) | 1 / 1 / 0 | read, queries, create, update, delete | 6 | hr_controller, hr_manager, leave_encashment_on_exit_automation, manager, senior_management, supervisor |
| `payroll_runs` | OPERATIONAL_KEEP | 15 / 1 (0) | 3 / 0 / 2 | read, create, update, delete | 37 | employee, hr_controller, hr_manager, leave_encashment_on_exit_automation, manager, obligation_calendar_automation, scheduled_entries_automation, senior_management, supervisor |
| `payslip_explanations` | OPERATIONAL_KEEP | 1 / 1 (0) | 1 / 1 / 0 | read | 3 | no direct named grant found |
| `payslip_journey_sources` | OPERATIONAL_KEEP | 12 / 1 (1) | 2 / 0 / 0 | read | 5 | hr_controller, hr_manager |
| `payslip_service_periods` | OPERATIONAL_KEEP | 0 / 0 (0) | 3 / 1 / 0 | read | 2 | hr_controller, hr_manager, senior_management |
| `payslip_statutory_scope_sources` | OPERATIONAL_KEEP | 0 / 0 (0) | 2 / 1 / 0 | read | 2 | hr_controller, hr_manager, senior_management |
| `payslip_wage_periods` | OPERATIONAL_KEEP | 0 / 0 (0) | 2 / 1 / 0 | read | 3 | hr_controller, hr_manager, senior_management |
| `payslip_work_compliance_sources` | OPERATIONAL_KEEP | 0 / 0 (0) | 2 / 1 / 0 | read | 2 | hr_controller, hr_manager, senior_management |
| `payslips` | OPERATIONAL_KEEP | 35 / 5 (4) | 4 / 1 / 30 | read, queries, update, delete | 108 | employee, hr_controller, hr_manager, leave_encashment_on_exit_automation, manager, obligation_calendar_automation, scheduled_entries_automation, senior_management, supervisor |
| `period_work_assessments` | OPERATIONAL_KEEP | 17 / 0 (0) | 4 / 0 / 2 | read, queries, create | 5 | hr_controller, hr_manager, senior_management |
| `period_work_clock_sources` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 9 / 3 (0) | 2 / 0 / 0 | read, create | 5 | hr_controller, hr_manager, senior_management |
| `person_facts` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 6 / 1 (1) | 2 / 1 / 0 | read, create, update, delete | 16 | employee, hr_controller, hr_manager, leave_encashment_on_exit_automation, manager, obligation_calendar_automation, scheduled_entries_automation, senior_management, supervisor |
| `platform_benefits` | OPERATIONAL_KEEP | 14 / 2 (2) | 2 / 0 / 0 | read, queries, create | 2 | hr_controller, hr_manager |
| `platform_cash_records` | OPERATIONAL_KEEP | 20 / 1 (1) | 5 / 0 / 1 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `platform_cpf_assessments` | OPERATIONAL_KEEP | 18 / 3 (3) | 4 / 0 / 2 | read, queries, create | 3 | hr_controller, hr_manager |
| `platform_cpf_queries` | OPERATIONAL_KEEP | 10 / 1 (1) | 2 / 0 / 1 | read, create | 2 | hr_controller, hr_manager |
| `platform_cpf_refund_adjustments` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 10 / 1 (1) | 3 / 0 / 1 | read, queries, create | 2 | hr_controller, hr_manager |
| `platform_cpf_refund_scopes` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 11 / 2 (2) | 2 / 0 / 1 | read, queries, create | 2 | hr_controller, hr_manager |
| `platform_cpf_refunds` | OPERATIONAL_KEEP | 23 / 1 (1) | 4 / 0 / 2 | read, queries, create | 2 | hr_controller, hr_manager |
| `platform_earning_slip_deliveries` | OPERATIONAL_KEEP | 10 / 1 (1) | 3 / 0 / 0 | read, create | 1 | hr_controller, hr_manager, senior_management |
| `platform_earning_slips` | OPERATIONAL_KEEP | 11 / 1 (1) | 5 / 0 / 1 | read, queries, create | 2 | hr_controller, hr_manager, senior_management |
| `platform_operator_notifications` | OPERATIONAL_KEEP | 10 / 0 (0) | 1 / 0 / 0 | read, create | 1 | hr_controller, hr_manager, senior_management |
| `platform_operator_scopes` | INPUT_MOVE_TO_ENTITY_JSON | 34 / 0 (0) | 4 / 0 / 2 | read, queries, create | 1 | hr_controller, hr_manager, senior_management |
| `platform_operators` | OPERATIONAL_KEEP | 17 / 0 (0) | 0 / 0 / 13 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `platform_tasks` | OPERATIONAL_KEEP | 15 / 2 (2) | 3 / 0 / 0 | read, queries, create | 2 | hr_controller, hr_manager, senior_management |
| `platform_workers` | OPERATIONAL_KEEP | 8 / 0 (0) | 0 / 0 / 12 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `presence_periods` | OPERATIONAL_KEEP | 4 / 0 (0) | 1 / 1 / 0 | read, create, update, delete | 5 | hr_controller, hr_manager, manager, senior_management, supervisor |
| `prior_authority_credit_reversals` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 9 / 1 (1) | 6 / 0 / 1 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `prior_statutory_credit_restorations` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 8 / 1 (1) | 5 / 0 / 1 | read, create, actions | 3 | hr_controller, hr_manager, senior_management |
| `prior_statutory_credit_reversals` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 12 / 1 (1) | 6 / 0 / 1 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `prior_wage_credit_redeliveries` | OPERATIONAL_KEEP | 17 / 1 (1) | 6 / 0 / 1 | read, create, actions | 5 | hr_controller, hr_manager, senior_management |
| `prior_wage_credit_reversals` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 9 / 1 (1) | 6 / 0 / 1 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `prior_wage_credit_scopes` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 7 / 2 (2) | 3 / 0 / 6 | read, create | 7 | hr_controller, hr_manager, senior_management |
| `receivable_authority_refunds` | OPERATIONAL_KEEP | 16 / 1 (1) | 3 / 0 / 1 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `receivable_credit_corrections` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 9 / 1 (1) | 6 / 0 / 0 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `receivable_direction_changes` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 11 / 1 (1) | 2 / 0 / 1 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `receivable_directions` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 29 / 0 (0) | 1 / 0 / 5 | read, create, queries | 6 | hr_controller, hr_manager, senior_management |
| `receivable_distribution_returns` | OPERATIONAL_KEEP | 13 / 0 (0) | 4 / 0 / 2 | read, create | 6 | hr_controller, hr_manager, senior_management |
| `receivable_distributions` | OPERATIONAL_KEEP | 17 / 0 (0) | 6 / 0 / 4 | read, create, actions | 6 | hr_controller, hr_manager, senior_management |
| `receivable_procedure_events` | NEEDS_EVIDENCE | 12 / 1 (1) | 2 / 0 / 0 | read, create, queries | 1 | hr_controller, hr_manager, senior_management |
| `receivable_remittance_reversals` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 9 / 1 (1) | 4 / 0 / 0 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `receivable_remittances` | OPERATIONAL_KEEP | 14 / 0 (0) | 1 / 0 / 3 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `recipient_cash_dispositions` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 18 / 2 (2) | 4 / 0 / 0 | read, create | 4 | hr_controller, hr_manager |
| `recipient_cash_reassessments` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 28 / 7 (7) | 4 / 0 / 2 | read, create, actions | 4 | hr_controller, hr_manager |
| `recipient_cash_vouchers` | OPERATIONAL_KEEP | 12 / 2 (2) | 1 / 0 / 1 | read, create | 3 | hr_controller, hr_manager |
| `recipient_income_events` | OPERATIONAL_KEEP | 36 / 4 (4) | 3 / 0 / 3 | read, create, update, queries, actions | 7 | hr_controller, hr_manager, senior_management |
| `reference_rows` | OPERATIONAL_KEEP | 8 / 0 (0) | 1 / 1 / 0 | read, create, update, delete | 15 | employee, hr_controller, hr_manager, obligation_calendar_automation, senior_management, statutory_drift_automation |
| `registered_settlement_heads` | INPUT_MOVE_TO_ENTITY_JSON | 29 / 1 (1) | 5 / 0 / 6 | read, create, queries, actions | 4 | hr_controller, hr_manager, senior_management |
| `replacement_restitution_cases` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 24 / 1 (0) | 4 / 0 / 3 | read, create | 2 | employee, hr_controller, hr_manager, manager, senior_management, supervisor |
| `replacement_restitution_discharges` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 54 / 3 (0) | 6 / 0 / 0 | read, create | 2 | employee, hr_controller, hr_manager, leave_encashment_on_exit_automation, manager, scheduled_entries_automation, senior_management, supervisor |
| `replacement_restitution_receipts` | OPERATIONAL_KEEP | 20 / 1 (0) | 4 / 0 / 2 | read, create | 1 | employee, hr_controller, hr_manager, manager, senior_management, supervisor |
| `replacement_statutory_outcomes` | OPERATIONAL_KEEP | 17 / 1 (0) | 7 / 0 / 0 | read, create | 2 | employee, hr_controller, hr_manager, manager, senior_management, supervisor |
| `reporting_transfers` | INPUT_MOVE_TO_ENTITY_JSON | 24 / 3 (3) | 6 / 0 / 0 | read, update, create | 4 | hr_controller, hr_manager, senior_management |
| `rosters` | OPERATIONAL_KEEP | 1 / 0 (0) | 1 / 0 / 0 | read, create, delete | 13 | hr_controller, hr_manager, manager, senior_management, supervisor |
| `settlement_enforcement_orders` | INPUT_MOVE_TO_ENTITY_JSON | 12 / 1 (1) | 4 / 0 / 2 | read, create, queries | 3 | hr_controller, hr_manager, senior_management |
| `settlement_monetary_directions` | INPUT_MOVE_TO_ENTITY_JSON | 12 / 1 (1) | 5 / 0 / 1 | read, create, queries | 2 | hr_controller, hr_manager, senior_management |
| `settlement_registration_events` | INPUT_MOVE_TO_ENTITY_JSON | 16 / 0 (0) | 5 / 0 / 3 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `settlement_reregistrations` | INPUT_MOVE_TO_ENTITY_JSON | 7 / 1 (1) | 5 / 0 / 0 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `settlement_wage_sources` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 13 / 2 (2) | 7 / 0 / 2 | read, create, actions | 4 | hr_controller, hr_manager, senior_management |
| `settlement_wage_statutory_discharges` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 10 / 1 (1) | 7 / 0 / 2 | read, create, actions | 4 | hr_controller, hr_manager, senior_management |
| `sg_cpf_recoveries` | OPERATIONAL_KEEP | 16 / 0 (0) | 1 / 0 / 1 | read, create, update, actions | 1 | hr_controller, hr_manager |
| `sg_cpf_refund_cases` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 32 / 1 (1) | 3 / 0 / 0 | read, create, update | 1 | hr_controller, hr_manager |
| `sg_cpf_wage_declarations` | INPUT_MOVE_TO_ENTITY_JSON | 15 / 0 (0) | 2 / 0 / 1 | read, create, update | 1 | hr_controller, hr_manager |
| `sg_sdl_cases` | INPUT_MOVE_TO_ENTITY_JSON | 28 / 0 (0) | 1 / 0 / 0 | read, create, update | 1 | hr_controller, hr_manager |
| `sg_sdl_foreign_wages` | INPUT_MOVE_TO_ENTITY_JSON | 22 / 0 (0) | 1 / 0 / 0 | read, create | 1 | hr_controller, hr_manager |
| `shift_definitions` | OPERATIONAL_KEEP | 4 / 0 (0) | 1 / 0 / 1 | read, create, update, delete | 13 | employee, hr_controller, hr_manager, kiosk, late_arrival_notice_automation, leave_encashment_on_exit_automation, manager, scheduled_entries_automation, senior_management, supervisor |
| `shift_patterns` | OPERATIONAL_KEEP | 4 / 0 (0) | 1 / 0 / 1 | read, create, update, delete | 14 | employee, hr_controller, hr_manager, kiosk, leave_encashment_on_exit_automation, manager, scheduled_entries_automation, senior_management, supervisor |
| `source_cash_payments` | OPERATIONAL_KEEP | 33 / 2 (2) | 6 / 0 / 7 | read, actions, create | 20 | hr_controller, hr_manager, senior_management |
| `statutory_account_credit_sources` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 21 / 0 (0) | 3 / 0 / 0 | read, create | 2 | hr_controller, hr_manager |
| `statutory_compensation_receipts` | OPERATIONAL_KEEP | 15 / 0 (0) | 1 / 0 / 0 | read, create | 1 | hr_controller, hr_manager, senior_management |
| `statutory_compensation_remainders` | OPERATIONAL_KEEP | 7 / 1 (1) | 2 / 0 / 0 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `statutory_compensation_settlements` | OPERATIONAL_KEEP | 19 / 1 (0) | 6 / 0 / 1 | read, create, update, actions | 4 | hr_controller, hr_manager, senior_management |
| `statutory_contributions` | OPERATIONAL_KEEP | 62 / 9 (4) | 1 / 1 / 5 | read, create, update, delete | 29 | employee, hr_controller, hr_manager, leave_encashment_on_exit_automation, manager, scheduled_entries_automation, senior_management, statutory_drift_automation, supervisor |
| `statutory_employee_refund_liabilities` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 10 / 1 (1) | 4 / 0 / 0 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `statutory_employee_refunds` | OPERATIONAL_KEEP | 16 / 1 (1) | 5 / 0 / 1 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `statutory_personal_assessments` | OPERATIONAL_KEEP | 25 / 4 (4) | 2 / 0 / 1 | read, create, queries | 2 | hr_controller, hr_manager, senior_management |
| `statutory_personal_receipts` | OPERATIONAL_KEEP | 12 / 4 (4) | 4 / 0 / 0 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `statutory_refund_receipts` | OPERATIONAL_KEEP | 20 / 1 (1) | 4 / 0 / 3 | read, create | 6 | hr_controller, hr_manager, senior_management |
| `statutory_remittance_acknowledgements` | OPERATIONAL_KEEP | 8 / 2 (2) | 1 / 0 / 0 | read, create | 2 | hr_controller, hr_manager |
| `statutory_remittance_allocations` | OPERATIONAL_KEEP | 4 / 0 (0) | 2 / 1 / 0 | read | 1 | hr_controller, hr_manager, senior_management |
| `statutory_remittance_events` | OPERATIONAL_KEEP | 8 / 0 (0) | 1 / 0 / 1 | read, create | 1 | hr_controller, hr_manager, senior_management |
| `statutory_remittances` | OPERATIONAL_KEEP | 27 / 4 (4) | 3 / 0 / 5 | read, create, update | 13 | hr_controller, hr_manager |
| `statutory_wage_record_deliveries` | OPERATIONAL_KEEP | 5 / 1 (1) | 3 / 0 / 0 | read, create | 1 | hr_controller, hr_manager, senior_management |
| `statutory_wage_record_issues` | OPERATIONAL_KEEP | 8 / 2 (2) | 3 / 0 / 1 | read, create | 1 | hr_controller, hr_manager, senior_management |
| `statutory_wage_records` | OPERATIONAL_KEEP | 29 / 7 (5) | 6 / 0 / 2 | read, create | 1 | hr_controller, hr_manager, senior_management |
| `tax_clearance_cases` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 14 / 0 (0) | 2 / 0 / 1 | read, create, actions | 3 | hr_controller, hr_manager, leave_encashment_on_exit_automation, senior_management |
| `tax_credit_correction_cases` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 19 / 0 (0) | 3 / 0 / 0 | read, create, update | 5 | hr_controller, hr_manager, senior_management |
| `training_service_recoveries` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 9 / 2 (2) | 4 / 0 / 0 | read, queries, create | 1 | hr_controller, hr_manager, senior_management |
| `training_service_recovery_cash` | OPERATIONAL_KEEP | 9 / 1 (1) | 3 / 0 / 0 | read, create | 1 | hr_controller, hr_manager, senior_management |
| `valuation_forex_policies` | NEEDS_EVIDENCE | 8 / 1 (1) | 1 / 0 / 2 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `wage_assessment_charge_allocations` | OPERATIONAL_KEEP | 12 / 2 (2) | 7 / 0 / 0 | read, create | 2 | hr_controller, hr_manager, senior_management |
| `wage_credit_redeliveries` | OPERATIONAL_KEEP | 17 / 1 (1) | 6 / 0 / 1 | read, create, actions | 5 | hr_controller, hr_manager, senior_management |
| `wage_debt_payments` | OPERATIONAL_KEEP | 5 / 0 (0) | 9 / 0 / 2 | read, create | 11 | hr_controller, hr_manager |
| `wage_debts` | OPERATIONAL_KEEP | 21 / 2 (2) | 6 / 0 / 21 | read, actions, create | 11 | hr_controller, hr_manager, obligation_calendar_automation |
| `wage_journey_sources` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 20 / 5 (1) | 5 / 0 / 2 | read, queries, create, actions | 4 | hr_controller, hr_manager |
| `wage_paid_credit_reversals` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 10 / 1 (1) | 7 / 0 / 1 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `wage_source_cash_returns` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 16 / 1 (1) | 6 / 0 / 2 | read, create | 5 | hr_controller, hr_manager, senior_management |
| `wage_work_report_filings` | OPERATIONAL_KEEP | 7 / 0 (0) | 0 / 0 / 0 | read, create | 1 | no direct named grant found |
| `wage_work_reports` | OPERATIONAL_KEEP | 18 / 2 (1) | 1 / 0 / 0 | read, create, queries | 1 | hr_controller, hr_manager |
| `work_day_credit_revisions` | OPERATIONAL_KEEP | 11 / 3 (0) | 3 / 0 / 1 | read, create | 3 | employee, hr_controller, hr_manager, leave_encashment_on_exit_automation, manager, scheduled_entries_automation, senior_management, supervisor |
| `work_days` | OPERATIONAL_KEEP | 19 / 1 (0) | 4 / 0 / 3 | read, create, update, delete, actions | 44 | employee, hr_controller, hr_manager, kiosk, late_arrival_notice_automation, leave_encashment_on_exit_automation, manager, scheduled_entries_automation, senior_management, supervisor |
| `workforce_permit_audits` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 9 / 0 (0) | 2 / 0 / 1 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `workforce_permit_cases` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 35 / 0 (0) | 3 / 0 / 3 | read, create, queries, actions | 4 | hr_controller, hr_manager, senior_management |
| `workforce_permit_determinations` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 15 / 0 (0) | 1 / 0 / 0 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `workforce_permit_rules` | NEEDS_EVIDENCE | 24 / 0 (0) | 0 / 0 / 1 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `workforce_permit_uses` | OPERATIONAL_KEEP | 2 / 0 (0) | 2 / 1 / 0 | read | 3 | hr_controller, hr_manager, senior_management |
| `workforce_permit_worker_decisions` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 10 / 0 (0) | 1 / 0 / 0 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `workforce_permit_workers` | INPUT_MOVE_TO_EMPLOYMENT_JSON | 21 / 0 (0) | 4 / 0 / 3 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `workforce_register_members` | OPERATIONAL_KEEP | 9 / 0 (0) | 2 / 0 / 0 | read, create | 3 | hr_controller, hr_manager, senior_management |
| `workforce_registers` | OPERATIONAL_KEEP | 7 / 0 (0) | 1 / 0 / 1 | read, create | 4 | hr_controller, hr_manager, senior_management |
| `worksites` | OPERATIONAL_KEEP | 6 / 0 (0) | 1 / 1 / 2 | read, create, update, delete | 14 | employee, hr_controller, hr_manager, leave_encashment_on_exit_automation, manager, scheduled_entries_automation, senior_management, supervisor |


## Exact field, relationship and consumer manifest

### adhoc_catalogue

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `code:text`, `distribution_worker_fraction:decimal`, `distribution_equal_fraction:decimal`, `distribution_member_facts:custom`, `distribution_calendar_month:bool`, `debt_fine_start_day:int`, `debt_fine_initial_end_day:int`, `debt_fine_initial_rate:decimal`, `debt_fine_later_rate:decimal`, `debt_fine_cap_fraction:decimal`, `debt_fine_automatic_max_days:int`, `earnings_pool_kind:text`, `name:text`, `authority:text`, `destination:enum`, `direction:enum`, `bands:custom`, `eligibility:text`, `qualifies_when:text`, `evidence:enum`, `request_requirements:custom`, `request_facts:custom`, `source_award_policy:custom`, `assessed_for:custom`, `assessment_ceiling:custom`, `counts_toward:custom`, `reduces_unpaid_salary:bool`, `raised_by:enum`, `schedule:custom`.
- Identity constraints: unique [{ fields: ['settings_id', 'code'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `adhoc_catalogue.settings_id → jurisdiction_settings [owned]`.
- Collection: `src/data/collection/adhoc_catalogue/+collection.ts`. Runtime consumer examples: `src/lib/assessment-exemption.ts`, `src/lib/catalogue-offer.ts`, `src/lib/catalogue-source-scope.ts` (remaining literal references counted in the inventory).

### adhoc_requests

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `fact_dossier:json:opaque`, `recovery_cost_class:text`, `recovery_cost_reference:text`, `deduction_allocation_reference:text`, `one_time_deduction_key:text`, `deduction_allocation_reference:text`, `entitlement_identity_key:text`, `amount:decimal`, `event_date:date`, `reason:text`, `evidence_file:file`, `as_adjustment_entry:bool`, `late_wage:custom`, `wage_attribution:custom`, `facts:custom`, `monthly_charge_allocation:custom`, `source_award_allocation:custom`, `source_cash_dispositions:custom`, `debt_settlement_reference:text`, `pay_period:text`.
- Identity constraints: unique [{fields:['settlement_wage_source_id']},{fields:['one_time_deduction_key']},{fields:['deduction_authorization_id','deduction_allocation_reference'],where:{deduction_authorization_id:{isNull:false}}},{ fields: ['entitlement_identity_key'] }, { fields: ['notice_compensation_case_id'] }, {fields:['distribution_pool_id','employment_id']},{ fields: ['wage_debt_id', 'debt_settlement_reference'] }, { fields: ['sg_cpf_recovery_id'] }, { fields: ['earnings_pool_member_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `adhoc_requests.settlement_wage_source_id → settlement_wage_sources [restrict/default]`, `adhoc_requests.deduction_authorization_id → deduction_authorizations [restrict/default]`, `adhoc_requests.notice_compensation_case_id → notice_compensation_cases [restrict/default]`, `adhoc_requests.earnings_pool_member_id → earnings_pool_members [restrict/default]`, `adhoc_requests.sg_cpf_recovery_id → sg_cpf_recoveries [restrict/default]`, `adhoc_requests.wage_debt_id → wage_debts [restrict/default]`, `adhoc_requests.distribution_pool_id → income_distribution_pools [restrict/default]`, `adhoc_requests.employment_id → employments [restrict/default]`, `adhoc_requests.catalogue_id → adhoc_catalogue [restrict/default]`, `adhoc_requests.payslip_id → payslips [restrict/default]`.
- Collection: `src/data/collection/adhoc_requests/+collection.ts`. Runtime consumer examples: `src/lib/assessment-exemption.ts`, `src/lib/component-payment-agreement.ts`, `src/lib/conditional-annual-source.ts` (remaining literal references counted in the inventory).

### allowance_catalogue

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `code:text`, `name:text`, `authority:text`, `destination:enum`, `direction:enum`, `bands:custom`, `eligibility:text`, `valid_when:text`, `validation_message:text`, `counts_toward:custom`, `npl_prorates:bool`, `request_facts:custom`, `calculation_basis:enum`, `weekly_proration:custom`, `weekly_allocation_reference_fact:text`, `contract_weekly_hours_fact:text`, `contract_weekly_days_fact:text`, `holiday_forfeit_full_unpaid_day:bool`, `guaranteed_normal_amount:text`, `guaranteed_normal_valid_when:text`, `guaranteed_normal_validation_message:text`, `guaranteed_leave_when:text`, `monthly_equivalent_fact:text`, `monthly_equivalent_reference_fact:text`, `holiday_paid_hours:text`, `hourly_month_weeks:decimal`, `outpatient_sick_pay:enum`, `owed:bool`.
- Identity constraints: unique [{ fields: ['settings_id', 'code'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `allowance_catalogue.settings_id → jurisdiction_settings [owned]`.
- Collection: `src/data/collection/allowance_catalogue/+collection.ts`. Runtime consumer examples: `src/lib/catalogue-offer.ts`, `src/lib/catalogue-source-scope.ts`, `src/lib/datatypes/contract_allowances.ts` (remaining literal references counted in the inventory).

### annual_certified_list_assets

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `purpose:enum`, `page_number:int`, `certificate_id:text`, `file:file`.
- Identity constraints: unique [{fields:['list_id','reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `annual_certified_list_assets.list_id → annual_certified_lists [restrict/default]`, `annual_certified_list_assets.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/annual_certified_list_assets/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### annual_certified_lists

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `basis_year:int`, `revision:int`, `correction_reference:text`, `correction_file:file`, `particulars:json:opaque`, `employee_particulars:json:opaque`, `particulars_file:file`, `history_reference:text`, `history_file:file`, `prepared_on:date`, `due_on:date`, `page_count:int`, `certificate_ids:json:opaque`, `official_payload:json:opaque`, `printable_html:text`, `source_snapshot:json:opaque`, `state:state`, `signer:text`, `signed_on:date`, `page_signatures:json:opaque`, `continuation_reference:text`, `submitted_on:date`, `received_reference:text`, `received_file:file`, `certificate_duplicate_files:json:opaque`, `sworn_declaration_file:file`.
- Identity constraints: unique [{fields:['company_id','basis_year'],where:{state:{eq:'SUBMITTED'},amends_id:{isNull:true}}},{fields:['amends_id'],where:{state:{eq:'SUBMITTED'},amends_id:{isNull:false}}}]; noOverlap —.
- Explicit state: state.
- Relationships: `annual_certified_lists.amends_id → annual_certified_lists [restrict/default]`, `annual_certified_lists.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/annual_certified_lists/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### annual_employer_filings

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `basis_year:int`, `revision:int`, `particulars:json:opaque`, `employee_particulars:json:opaque`, `particulars_file:file`, `history_reference:text`, `history_file:file`, `correction_reference:text`, `correction_file:file`, `prepared_on:date`, `due_on:date`, `filename:text`, `official_payload:json:opaque`, `transport_text:text`, `transport_bytes:json:opaque`, `source_snapshot:json:opaque`, `state:state`, `submitted_on:date`, `submission_reference:text`, `submission_file:file`.
- Identity constraints: unique [{fields:['company_id','basis_year'],where:{state:{eq:'SUBMITTED'},amends_id:{isNull:true}}},{fields:['amends_id'],where:{state:{eq:'SUBMITTED'},amends_id:{isNull:false}}}]; noOverlap —.
- Explicit state: state.
- Relationships: `annual_employer_filings.company_id → companies [restrict/default]`, `annual_employer_filings.amends_id → annual_employer_filings [restrict/default]`.
- Collection: `src/data/collection/annual_employer_filings/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### annual_income_documents

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `revision:int`, `correction_reason:text`, `correction_reference:text`, `correction_file:file`, `correction_source_ids:json:opaque`, `basis_year:int`, `pure_compensation:bool`, `employer_count:int`, `residency_code:text`, `spouse_qualified:bool`, `declaration_file:file`, `history_complete:bool`, `history_reference:text`, `history_file:file`, `particulars:json:opaque`, `prepared_on:date`, `document:json:opaque`, `official_payload:json:opaque`, `issued_payload:json:opaque`, `submitted_payload:json:opaque`, `employer_signer_name:text`, `employee_signer_name:text`, `employer_signed_on:date`, `employee_signed_on:date`, `employer_declarant_name:text`, `employee_declarant_name:text`, `employer_declared_on:date`, `employee_declared_on:date`, `employer_declaration_file:file`, `employee_declaration_file:file`, `source_snapshot:json:opaque`, `certificate_due_on:date`, `substituted_submission_due_on:date`, `retain_through_on:date`, `state:state`, `issued_on:date`, `issue_reference:text`, `issue_file:file`, `employer_signature_file:file`, `employee_signature_file:file`, `submitted_on:date`, `submission_reference:text`, `submission_file:file`, `employer_return_filed_on:date`, `employer_return_reference:text`, `employer_return_file:file`.
- Identity constraints: unique [{ fields: ['replaces_id'], where: { state: { in: ['ISSUED', 'SUBMITTED'] }, replaces_id: { isNull: false } } }, { fields: ['company_id', 'employee_id', 'basis_year'], where: { state: { in: ['ISSUED', 'SUBMITTED'] }, replaces_id: { isNull: true } } }]; noOverlap —.
- Explicit state: state.
- Relationships: `annual_income_documents.replaces_id → annual_income_documents [restrict/default]`, `annual_income_documents.company_id → companies [restrict/default]`, `annual_income_documents.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/annual_income_documents/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/run/annual-document-loader.ts`, `src/lib/payroll/run/annual-employer-export.ts`.

### annual_monthly_return_receipts

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `month:text`, `reference:text`, `filed_on:date`, `file:file`, `native_remittance_ids:json:opaque`, `no_adjustments_or_penalties:boolean`.
- Identity constraints: unique [{fields:['company_id','month','reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: none declared.
- Collection: `src/data/collection/annual_monthly_return_receipts/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### annual_remittance_returns

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `basis_year:int`, `revision:int`, `particulars:json:opaque`, `employee_particulars:json:opaque`, `particulars_file:file`, `history_reference:text`, `history_file:file`, `monthly_receipts:json:opaque`, `correction_reference:text`, `correction_file:file`, `prepared_on:date`, `due_on:date`, `official_payload:json:opaque`, `source_snapshot:json:opaque`, `signed_payload:json:opaque`, `state:state`, `signer:text`, `signer_tin:text`, `signer_title:text`, `signed_on:date`, `signature_file:file`, `submitted_on:date`, `submission_reference:text`, `submission_file:file`.
- Identity constraints: unique [{fields:['company_id','basis_year'],where:{state:{eq:'SUBMITTED'},amends_id:{isNull:true}}},{fields:['amends_id'],where:{state:{eq:'SUBMITTED'},amends_id:{isNull:false}}}]; noOverlap —.
- Explicit state: state.
- Relationships: `annual_remittance_returns.company_id → companies [restrict/default]`, `annual_remittance_returns.amends_id → annual_remittance_returns [restrict/default]`.
- Collection: `src/data/collection/annual_remittance_returns/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### annual_tax_assessments

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `issuer_qualification:json:opaque`, `issuer_evidence_file:file`, `issuer_document:json:opaque`, `recorded_on:date`, `authority_payment_identity:text`, `authority_account_reference:text`, `basis_year:int`, `taxpayer_tax_identifier:text`, `currency:currency`, `assessed_on:date`, `reference:text`, `authority_name:text`, `direction:enum`, `amount:money`, `reconciled_movement_ids:json:opaque`, `evidence_file:file`, `authority_source:json:opaque`, `filing_source:json:opaque`, `reconciled_movements:json:opaque`, `sequence:int`.
- Identity constraints: unique [{fields:['company_id','basis_year','sequence']},{fields:['company_id','reference']},{fields:['supersedes_id'],where:{supersedes_id:{isNull:false}}}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `annual_tax_assessments.company_id → companies [restrict/default]`, `annual_tax_assessments.filing_id → income_return_filings [restrict/default]`, `annual_tax_assessments.supersedes_id → annual_tax_assessments [restrict/default]`.
- Collection: `src/data/collection/annual_tax_assessments/+collection.ts`. Runtime consumer examples: `src/lib/annual-authority-document.ts`, `src/lib/annual-settlement-vouchers.ts`, `src/lib/annual-tax-settlement.ts` (remaining literal references counted in the inventory).

### annual_tax_credit_payroll_instructions

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `sequence:int`, `application_reference:text`.
- Identity constraints: unique [{ fields: ['source_id', 'certificate_id'] }, { fields: ['source_id', 'sequence'] }, { fields: ['source_id', 'application_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `annual_tax_credit_payroll_instructions.source_id → annual_tax_credit_payroll_sources [owned]`, `annual_tax_credit_payroll_instructions.certificate_id → approved_tax_credit_certificates [restrict/default]`.
- Collection: `src/data/collection/annual_tax_credit_payroll_instructions/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/world.ts`, `src/lib/tax-credits/pipeline.ts`.

### annual_tax_credit_payroll_sources

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `tax_year:int`, `tax_scheme_code:text`, `currency:currency`, `application_on:date`, `annual_tax_due:decimal`, `assessment_reference:text`, `assessment_file:file`, `prior_withheld_and_remitted:decimal`, `history_complete:bool`, `history_reference:text`, `history_file:file`, `instruction_reference:text`, `instruction_file:file`.
- Identity constraints: unique [{ fields: ['company_id', 'employee_id', 'tax_year', 'tax_scheme_code'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `annual_tax_credit_payroll_sources.company_id → companies [restrict/default]`, `annual_tax_credit_payroll_sources.employee_id → employees [restrict/default]`, `annual_tax_credit_payroll_sources.payslip_id → payslips [restrict/default]`.
- Collection: `src/data/collection/annual_tax_credit_payroll_sources/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/run/graph.ts`, `src/lib/payroll/run/rerun.ts` (remaining literal references counted in the inventory).

### annual_tax_credit_settlements

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `currency:currency`, `application_origin:enum`, `annual_sequence:int`, `certificate_sequence:int`, `tax_year:int`, `applied_on:date`, `application_reference:text`, `annual_tax_due:decimal`, `actually_withheld_and_remitted:decimal`, `withholding_remittance_reference:text`, `withholding_remittance_file:file`, `annual_assessment_reference:text`, `annual_assessment_file:file`, `credit_available_before:decimal`, `credit_applied:decimal`, `credit_carry:decimal`, `net_annual_tax:decimal`, `refund_due:decimal`, `refund_paid_on:date`, `refund_amount_paid:decimal`, `refund_payment_reference:text`, `refund_payment_file:file`.
- Identity constraints: unique [{ fields: ['company_id', 'employee_id', 'tax_year', 'annual_sequence'] }, { fields: ['certificate_id', 'certificate_sequence'] }, { fields: ['certificate_id', 'tax_year'] }, { fields: ['company_id', 'employee_id', 'application_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `annual_tax_credit_settlements.payroll_source_id → annual_tax_credit_payroll_sources [restrict/default]`, `annual_tax_credit_settlements.company_id → companies [restrict/default]`, `annual_tax_credit_settlements.employee_id → employees [restrict/default]`, `annual_tax_credit_settlements.certificate_id → approved_tax_credit_certificates [restrict/default]`, `annual_tax_credit_settlements.year_end_payslip_id → payslips [owned]`.
- Collection: `src/data/collection/annual_tax_credit_settlements/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/run/annual-document-loader.ts`, `src/lib/payroll/run/annual-employer-export.ts` (remaining literal references counted in the inventory).

### annual_tax_settlement_events

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `basis_year:int`, `taxpayer_tax_identifier:text`, `currency:currency`, `moved_on:date`, `reference:text`, `kind:enum`, `amount:money`, `counterparty_reference:text`, `sender_identity:text`, `counterparty_identity:text`, `counterparty_account_reference:text`, `target_obligation_reference:text`, `recorded_on:date`, `credit_sequence:int`, `credit_source:json:opaque`, `payment_sequence:int`, `target_allocation_source:json:opaque`, `reversal_sequence:int`, `reversal_source:json:opaque`, `credit_destination:json:opaque`, `credit_destination:json:opaque`, `voucher_line_id:text`, `evidence_file:file`, `assessment_source:json:opaque`, `evidence_source:json:opaque`, `sequence:int`.
- Identity constraints: unique [{fields:['reversed_application_id','reversal_sequence'],where:{reversed_application_id:{isNull:false}}},{fields:['voucher_register_id','voucher_line_id'],where:{voucher_register_id:{isNull:false}}},{fields:['credit_movement_id','credit_sequence'],where:{credit_movement_id:{isNull:false}}},{fields:['paid_obligation_id','payment_sequence'],where:{paid_obligation_id:{isNull:false}}},{fields:['assessment_id','sequence']},{fields:['company_id','reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `annual_tax_settlement_events.voucher_register_id → annual_tax_settlement_vouchers [restrict/default]`, `annual_tax_settlement_events.credit_movement_id → annual_tax_settlement_events [restrict/default]`, `annual_tax_settlement_events.company_id → companies [restrict/default]`, `annual_tax_settlement_events.target_assessment_id → annual_tax_assessments [restrict/default]`, `annual_tax_settlement_events.paid_obligation_id → annual_tax_assessments [restrict/default]`, `annual_tax_settlement_events.assessment_id → annual_tax_assessments [restrict/default]`.
- Collection: `src/data/collection/annual_tax_settlement_events/+collection.ts`. Runtime consumer examples: `src/lib/annual-authority-document.ts`, `src/lib/annual-settlement-vouchers.ts`, `src/lib/annual-tax-settlement.ts` (remaining literal references counted in the inventory).

### annual_tax_settlement_vouchers

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `issuer_evidence_file:file`, `issuer_document:json:opaque`, `posted_issuer_qualification:json:opaque`, `currency:currency`, `moved_on:date`, `source_kind:enum`, `source_system_reference:text`, `reference:text`, `whole_amount:money`, `source_scope:enum`, `lines:json:opaque`, `evidence_file:file`, `recorded_on:date`, `document_sha256:text`, `evidence_source:json:opaque`.
- Identity constraints: unique [{fields:['source_system_reference','reference']},{fields:['document_sha256']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `annual_tax_settlement_vouchers.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/annual_tax_settlement_vouchers/+collection.ts`. Runtime consumer examples: `src/lib/annual-authority-document.ts`, `src/lib/annual-settlement-vouchers.ts`, `src/lib/every-field.ts`.

### approved_tax_credit_certificates

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `currency:currency`, `credit_kind:text`, `tax_scheme_code:text`, `certificate_reference:text`, `issuer_reference:text`, `issued_on:date`, `contribution_year:int`, `amount:decimal`, `expires_on:date`, `validity_reference:text`, `compensation_tax_authorised:bool`, `contributor_classification_reference:text`, `certificate_state:enum`, `cancelled_on:date`, `cancellation_reference:text`, `cancellation_file:file`, `authenticity_checked_on:date`, `authenticity_reference:text`, `external_utilised_amount:decimal`, `external_history_complete:bool`, `external_history_reference:text`, `evidence_file:file`.
- Identity constraints: unique [{ fields: ['issuer_reference', 'certificate_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `approved_tax_credit_certificates.company_id → companies [restrict/default]`, `approved_tax_credit_certificates.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/approved_tax_credit_certificates/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/world.ts`, `src/lib/tax-credits/pipeline.ts` (remaining literal references counted in the inventory).

### benefit_case_assessment_losses

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `injury_reference:text`, `loss_share:decimal`, `accepted_report_reference:text`, `accepted_report_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_assessment_id', 'injury_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_assessment_losses.benefit_case_assessment_id → benefit_case_assessments [restrict/default]`.
- Collection: `src/data/collection/benefit_case_assessment_losses/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/assessment-sources.ts`, `src/lib/every-field.ts`.

### benefit_case_assessment_recipients

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `portion_reference:text`, `recipient_kind:enum`, `recipient_reference:text`, `amount:decimal`, `authority_reference:text`, `authority_on:date`, `authority_file:file`, `payment_due_basis:enum`, `payment_due_on:date`, `payment_due_authority_on:date`, `payment_due_reference:text`, `payment_due_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_assessment_id', 'portion_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_assessment_recipients.benefit_case_assessment_id → benefit_case_assessments [restrict/default]`.
- Collection: `src/data/collection/benefit_case_assessment_recipients/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/assessment-sources.ts`, `src/lib/every-field.ts`, `src/lib/payroll/run/clearance-filing.ts`.

### benefit_case_assessments

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `assessment_kind:enum`, `assessment_on:date`, `accepted_report_reference:text`, `accepted_report_file:file`, `loss_share:decimal`, `incapacity_kind:enum`, `incapacitated_for_all_pre_accident_work:bool`, `loss_basis:enum`, `injury_count:int`, `authority_kind:enum`, `authority_reference:text`, `authority_file:file`, `served_on:date`, `effective_on:date`, `due_on:date`, `amount:decimal`, `currency:currency`.
- Identity constraints: unique [{ fields: ['supersedes_assessment_id'] }, { fields: ['benefit_case_id', 'authority_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_assessments.benefit_case_id → benefit_cases [restrict/default]`, `benefit_case_assessments.supersedes_assessment_id → benefit_case_assessments [restrict/default]`.
- Collection: `src/data/collection/benefit_case_assessments/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/assessment-sources.ts`, `src/lib/benefit-cases/lump-sum-assessment.ts`, `src/lib/every-field.ts`.

### benefit_case_authority_applications

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `application_reference:text`, `application_kind:enum`, `lodged_on:date`, `lodged_at:instant`, `known_on:date`, `lodgement_file:file`, `granted_at:instant`, `set_aside_ground:enum`, `set_aside_not_applicant:bool`, `fraud_not_applicant:bool`, `appeal_scope_covered_through_at:instant`, `appeal_scope_known_on:date`, `appeal_scope_expected_count:int`, `appeal_scope_reference:text`, `appeal_scope_file:file`, `appeal_scope_ids:list`, `appeal_lodged_at:instant`, `appeal_disposed_at:instant`, `decision_kind:enum`, `decision_on:date`, `decision_reference:text`, `decision_file:file`.
- Identity constraints: unique [{ fields: ['supersedes_authority_application_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_authority_applications.benefit_case_assessment_id → benefit_case_assessments [restrict/default]`, `benefit_case_authority_applications.supersedes_authority_application_id → benefit_case_authority_applications [restrict/default]`.
- Collection: `src/data/collection/benefit_case_authority_applications/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/application-sources.ts`, `src/lib/benefit-cases/authority-continuation.ts`, `src/lib/every-field.ts`.

### benefit_case_authority_procedures

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `basis:enum`, `known_on:date`, `procedure_reference:text`, `procedure_file:file`, `objection_count:int`, `latest_objection_on:date`, `all_withdrawn_on:date`, `order_basis:enum`, `prior_notice_issued:bool`, `set_aside_application_count:int`, `order_on:date`, `order_reference:text`, `order_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_assessment_id', 'procedure_reference'] }, { fields: ['supersedes_procedure_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_authority_procedures.benefit_case_assessment_id → benefit_case_assessments [restrict/default]`, `benefit_case_authority_procedures.supersedes_procedure_id → benefit_case_authority_procedures [restrict/default]`.
- Collection: `src/data/collection/benefit_case_authority_procedures/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/authority-procedures.ts`, `src/lib/every-field.ts`.

### benefit_case_cash_return_allocations

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `allocation_reference:text`, `amount:decimal`, `allocation_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_cash_return_id', 'benefit_case_refund_portion_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_cash_return_allocations.benefit_case_cash_return_id → benefit_case_cash_returns [restrict/default]`, `benefit_case_cash_return_allocations.benefit_case_refund_portion_id → benefit_case_refund_portions [restrict/default]`.
- Collection: `src/data/collection/benefit_case_cash_return_allocations/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/refund-sources.ts`, `src/lib/every-field.ts`, `src/lib/payroll/run/clearance-filing.ts`.

### benefit_case_cash_returns

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `bank_reference:text`, `payer_kind:enum`, `payer_reference:text`, `credited_on:date`, `known_on:date`, `currency:currency`, `amount:decimal`, `credited_account_reference:text`, `returning_party_reference:text`, `bank_file:file`.
- Identity constraints: unique [{ fields: ['company_id', 'payer_kind', 'payer_reference', 'bank_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_cash_returns.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/benefit_case_cash_returns/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/refund-sources.ts`, `src/lib/every-field.ts`, `src/lib/payroll/run/clearance-filing.ts`.

### benefit_case_claimant_receipt_scopes

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `claimant_reference:text`, `source_on:date`, `covered_through_on:date`, `covered_through_at:instant`, `known_on:date`, `scope_reference:text`, `expected_receipt_count:int`, `scope_file:file`.
- Identity constraints: unique [{ fields: ['supersedes_receipt_scope_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_claimant_receipt_scopes.benefit_case_assessment_id → benefit_case_assessments [restrict/default]`, `benefit_case_claimant_receipt_scopes.supersedes_receipt_scope_id → benefit_case_claimant_receipt_scopes [restrict/default]`.
- Collection: `src/data/collection/benefit_case_claimant_receipt_scopes/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/application-sources.ts`, `src/lib/every-field.ts`.

### benefit_case_claimant_receipts

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `receipt_reference:text`, `received_on:date`, `received_at:instant`, `known_on:date`, `currency:currency`, `amount:decimal`, `receipt_kind:enum`, `claimant_reference:text`, `evidence_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_assessment_id', 'receipt_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_claimant_receipts.benefit_case_assessment_id → benefit_case_assessments [restrict/default]`, `benefit_case_claimant_receipts.payment_allocation_id → payment_allocations [restrict/default]`.
- Collection: `src/data/collection/benefit_case_claimant_receipts/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/application-sources.ts`, `src/lib/every-field.ts`.

### benefit_case_credit_dispositions

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `disposition:enum`, `currency:currency`, `credit_amount:decimal`, `return_allocation_ids:list`, `authority_reference:text`, `authority_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_credit_scope_id', 'payment_allocation_id'] }, { fields: ['benefit_case_credit_scope_id', 'reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_credit_dispositions.benefit_case_credit_scope_id → benefit_case_credit_scopes [restrict/default]`, `benefit_case_credit_dispositions.payment_allocation_id → payment_allocations [restrict/default]`.
- Collection: `src/data/collection/benefit_case_credit_dispositions/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/credit-sources.ts`, `src/lib/every-field.ts`, `src/lib/payroll/run/clearance-filing.ts`.

### benefit_case_credit_scopes

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `authority_on:date`, `known_on:date`, `covered_through_on:date`, `currency:currency`, `expected_count:int`, `authority_reference:text`, `authority_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_assessment_id', 'reference'] }, { fields: ['supersedes_credit_scope_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_credit_scopes.benefit_case_assessment_id → benefit_case_assessments [restrict/default]`, `benefit_case_credit_scopes.supersedes_credit_scope_id → benefit_case_credit_scopes [restrict/default]`.
- Collection: `src/data/collection/benefit_case_credit_scopes/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/credit-sources.ts`, `src/lib/every-field.ts`, `src/lib/payroll/run/clearance-filing.ts`.

### benefit_case_cutoffs

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `cutoff_reference:text`, `payroll_period:text`, `salary_window:period`, `leave_slice:period`, `pay_on:date`, `premium_basis:enum`, `premium_shares:custom`, `premium_reference:text`, `premium_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_plan_id', 'cutoff_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_cutoffs.benefit_case_plan_id → benefit_case_plans [owned]`.
- Collection: `src/data/collection/benefit_case_cutoffs/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### benefit_case_decisions

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `lifecycle:state`, `decision_source_key:text`, `component_code:text`, `decision_kind:enum`, `decision_status:enum`, `decided_on:date`, `compensation_from:date`, `compensation_through:date`, `decision_reference:text`, `authority:text`, `authority_reference:text`, `decision_file:file`, `currency:currency`, `amount:decimal`.
- Identity constraints: unique [ { fields: ['decision_source_key'], where: { decision_source_key: { isNull: false } } }, { fields: ['benefit_case_id', 'component_code'], where: { decision_kind: { eq: 'ORIGINAL' } } }, { fields: ['benefit_case_id', 'component_code', 'decision_reference', 'decided_on'], where: { decision_kind: { eq: 'SUPPLEMENT' } } }, { fields: ['supersedes_decision_id'], where: { supersedes_decision_id: { isNull: false } } } ]; noOverlap —.
- Explicit state: lifecycle.
- Relationships: `benefit_case_decisions.benefit_case_id → benefit_cases [owned]`, `benefit_case_decisions.supersedes_decision_id → benefit_case_decisions [restrict/default]`.
- Collection: `src/data/collection/benefit_case_decisions/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### benefit_case_earnings

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `earned_range:period`, `component_kind:text`, `currency:currency`, `amount:decimal`, `classification_reference:text`, `employer_scope:enum`, `employer_reference:text`, `source_reference:text`, `evidence_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_id', 'source_reference'] }, { fields: ['supersedes_earning_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_earnings.benefit_case_id → benefit_cases [owned]`, `benefit_case_earnings.supersedes_earning_id → benefit_case_earnings [restrict/default]`.
- Collection: `src/data/collection/benefit_case_earnings/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/certified-assessment.ts`, `src/lib/benefit-cases/earning-basis.ts`, `src/lib/benefit-cases/lump-sum-assessment.ts` (remaining literal references counted in the inventory).

### benefit_case_employee_recovery_allocations

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `known_on:date`, `amount:money`, `currency:currency`, `attribution_file:file`.
- Identity constraints: unique [ { "fields": [ "recovery_receipt_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_employee_recovery_allocations.recovery_receipt_id → benefit_case_employee_recovery_receipts [restrict/default]`, `benefit_case_employee_recovery_allocations.original_paid_period_id → benefit_case_periods [restrict/default]`, `benefit_case_employee_recovery_allocations.government_receipt_allocation_id → benefit_case_reimbursement_receipt_allocations [restrict/default]`.
- Collection: `src/data/collection/benefit_case_employee_recovery_allocations/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/reimbursement-recovery-admission.ts`, `src/lib/benefit-cases/reimbursement-recovery.ts`, `src/lib/every-field.ts` (remaining literal references counted in the inventory).

### benefit_case_employee_recovery_receipts

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `known_on:date`, `amount:money`, `currency:currency`, `recovered_on:date`, `expected_allocation_count:int`, `bank_file:file`.
- Identity constraints: unique [ { "fields": [ "company_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_employee_recovery_receipts.company_id → companies [restrict/default]`, `benefit_case_employee_recovery_receipts.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/benefit_case_employee_recovery_receipts/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/reimbursement-recovery-admission.ts`, `src/lib/benefit-cases/reimbursement-recovery.ts`, `src/lib/every-field.ts` (remaining literal references counted in the inventory).

### benefit_case_expense_portions

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `portion_reference:text`, `recipient_kind:enum`, `recipient_reference:text`, `amount:decimal`, `source_amount:decimal`, `conversion_rate:decimal`, `conversion_on:date`, `conversion_reference:text`, `conversion_file:file`, `funding_reference:text`, `funding_paid_on:date`, `provider_due_on:date`, `evidence_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_expense_id', 'portion_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_expense_portions.benefit_case_expense_id → benefit_case_expenses [owned]`.
- Collection: `src/data/collection/benefit_case_expense_portions/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/expense-sources.ts`, `src/lib/every-field.ts`.

### benefit_case_expenses

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `invoice_reference:text`, `allocation_sequence:int`, `allocation_reference:text`, `allocation_on:date`, `treatment_on:date`, `currency:currency`, `source_currency:currency`, `source_amount:decimal`, `invoice_amount:decimal`, `treatment_kind:text`, `provider_reference:text`, `necessary_treatment_reference:text`, `practitioner_registration_reference:text`, `treatment_country:text`, `original_bill_received_on:date`, `evidence_file:file`.
- Identity constraints: unique [{ fields: ['supersedes_expense_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_expenses.benefit_case_id → benefit_cases [owned]`, `benefit_case_expenses.supersedes_expense_id → benefit_case_expenses [restrict/default]`.
- Collection: `src/data/collection/benefit_case_expenses/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/expense-sources.ts`, `src/lib/every-field.ts`.

### benefit_case_government_refund_allocations

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `known_on:date`, `amount:money`, `currency:currency`, `attribution_file:file`.
- Identity constraints: unique [ { "fields": [ "refund_receipt_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_government_refund_allocations.refund_receipt_id → benefit_case_government_refund_receipts [restrict/default]`, `benefit_case_government_refund_allocations.recovery_allocation_id → benefit_case_employee_recovery_allocations [restrict/default]`.
- Collection: `src/data/collection/benefit_case_government_refund_allocations/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/reimbursement-recovery-admission.ts`, `src/lib/benefit-cases/reimbursement-recovery.ts`, `src/lib/every-field.ts` (remaining literal references counted in the inventory).

### benefit_case_government_refund_receipts

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `known_on:date`, `amount:money`, `currency:currency`, `paid_on:date`, `expected_allocation_count:int`, `bank_file:file`, `government_recipient_reference:text`.
- Identity constraints: unique [ { "fields": [ "company_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_government_refund_receipts.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/benefit_case_government_refund_receipts/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/reimbursement-recovery-admission.ts`, `src/lib/benefit-cases/reimbursement-recovery.ts`, `src/lib/every-field.ts` (remaining literal references counted in the inventory).

### benefit_case_incident_notices

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `known_on:date`, `incident_kind:enum`, `accident_on:date`, `employer_first_notice_on:date`, `employer_notice_reference:text`, `employer_notice_file:file`, `certification_received_on:date`, `certification_reference:text`, `certification_file:file`, `fatal_on:date`, `fatal_notified_at:instant`, `fatal_notification_reference:text`, `fatal_notification_file:file`, `commissioner_filed_on:date`, `commissioner_channel:enum`, `commissioner_reference:text`, `commissioner_file:file`, `insurer_written_on:date`, `insurer_reference:text`, `insurer_file:file`.
- Identity constraints: unique [{ fields: ['supersedes_incident_notice_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_incident_notices.benefit_case_id → benefit_cases [restrict/default]`, `benefit_case_incident_notices.supersedes_incident_notice_id → benefit_case_incident_notices [restrict/default]`.
- Collection: `src/data/collection/benefit_case_incident_notices/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/incident-sources.ts`, `src/lib/every-field.ts`.

### benefit_case_liability_agreements

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `agreed_on:date`, `source_on:date`, `agreement_reference:text`, `agreement_file:file`, `complete_party_scope_reference:text`, `complete_party_scope_file:file`, `liable_party_count:int`, `currency:currency`.
- Identity constraints: unique [{ fields: ['benefit_case_id', 'agreement_reference'] }, { fields: ['supersedes_agreement_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_liability_agreements.benefit_case_id → benefit_cases [restrict/default]`, `benefit_case_liability_agreements.supersedes_agreement_id → benefit_case_liability_agreements [restrict/default]`.
- Collection: `src/data/collection/benefit_case_liability_agreements/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/agreement.ts`, `src/lib/every-field.ts`.

### benefit_case_liability_allocations

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `target_kind:enum`, `amount:decimal`, `allocation_reference:text`, `authority_on:date`, `authority_reference:text`, `authority_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_liability_party_id', 'allocation_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_liability_allocations.benefit_case_liability_party_id → benefit_case_liability_parties [restrict/default]`, `benefit_case_liability_allocations.benefit_case_assessment_recipient_id → benefit_case_assessment_recipients [restrict/default]`, `benefit_case_liability_allocations.benefit_case_period_day_id → benefit_case_period_days [restrict/default]`.
- Collection: `src/data/collection/benefit_case_liability_allocations/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/allocations.ts`, `src/lib/every-field.ts`.

### benefit_case_liability_parties

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `party_kind:enum`, `party_reference:text`, `liability_reference:text`, `liability_file:file`, `amount:decimal`, `signed_on:date`, `signature_reference:text`, `signature_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_liability_agreement_id', 'party_kind', 'party_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_liability_parties.benefit_case_liability_agreement_id → benefit_case_liability_agreements [restrict/default]`.
- Collection: `src/data/collection/benefit_case_liability_parties/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/agreement.ts`, `src/lib/every-field.ts`.

### benefit_case_liable_earnings

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `earned_on:date`, `source_on:date`, `party_kind:enum`, `party_reference:text`, `liability_reference:text`, `liability_file:file`, `currency:currency`, `amount:decimal`, `source_reference:text`, `evidence_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_id', 'source_reference'] }, { fields: ['supersedes_earning_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_liable_earnings.benefit_case_id → benefit_cases [restrict/default]`, `benefit_case_liable_earnings.supersedes_earning_id → benefit_case_liable_earnings [restrict/default]`.
- Collection: `src/data/collection/benefit_case_liable_earnings/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/liable-earnings.ts`, `src/lib/every-field.ts`.

### benefit_case_member_losses

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `member_kind:enum`, `prior_side:enum`, `remaining_side:enum`, `prior_compensation_basis:enum`, `assessment_on:date`, `assessment_reference:text`, `assessment_file:file`, `prior_authority_reference:text`, `prior_authority_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_id', 'assessment_reference'] }, { fields: ['supersedes_member_loss_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_member_losses.benefit_case_id → benefit_cases [restrict/default]`, `benefit_case_member_losses.prior_benefit_case_id → benefit_cases [restrict/default]`, `benefit_case_member_losses.supersedes_member_loss_id → benefit_case_member_losses [restrict/default]`.
- Collection: `src/data/collection/benefit_case_member_losses/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/lump-sum-assessment.ts`, `src/lib/every-field.ts`.

### benefit_case_movements

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `kind:text`, `direction:enum`, `paid_on:date`, `amount:decimal`, `payment_reference:text`, `planned_leave_span_at_payment:period`, `evidence_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_id', 'kind', 'payment_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_movements.benefit_case_id → benefit_cases [restrict/default]`, `benefit_case_movements.benefit_case_plan_id → benefit_case_plans [restrict/default]`.
- Collection: `src/data/collection/benefit_case_movements/+collection.ts`. Runtime consumer examples: `src/lib/award-cash-channel.ts`, `src/lib/benefit-cases/payroll-guard.ts`, `src/lib/every-field.ts` (remaining literal references counted in the inventory).

### benefit_case_period_days

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `date:date`, `working_day:bool`, `rest_day:bool`, `public_holiday:bool`, `paid_leave:bool`, `actual_wage_amount:decimal`, `actual_employer_pension_amount:decimal`, `employer_pension_reference:text`, `supersedes_day_id:text`, `compensation_slot_lineage:text`, `compensation_slot:int`, `compensation_slot_key:text`, `worked_wage_amount:decimal`, `nonwork_wage_amount:decimal`, `split_wage_reference:text`, `wage_reference:text`.
- Identity constraints: unique [{ fields: ['benefit_case_period_id', 'date'] }, { fields: ['compensation_slot_key'] }, { fields: ['supersedes_day_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_period_days.benefit_case_period_id → benefit_case_periods [owned]`.
- Collection: `src/data/collection/benefit_case_period_days/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/certified-assessment.ts`, `src/lib/benefit-cases/certified-periods.ts`, `src/lib/every-field.ts` (remaining literal references counted in the inventory).

### benefit_case_periods

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `period_reference:text`, `period_kind:text`, `effective_range:period`, `certified_on:date`, `original_certificate_received_on:date`, `pay_due_on:date`, `pay_due_reference:text`, `certificate_reference:text`, `certificate_file:file`, `paid_gross_cost:decimal`, `paid_employer_premium_cost:decimal`, `consumed_units:decimal`, `unit:enum`.
- Identity constraints: unique [{ fields: ['benefit_case_id', 'period_reference'] }, { fields: ['supersedes_period_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_periods.supersedes_period_id → benefit_case_periods [restrict/default]`, `benefit_case_periods.benefit_case_id → benefit_cases [owned]`, `benefit_case_periods.leave_entry_id → leave_entries [restrict/default]`, `benefit_case_periods.payslip_id → payslips [restrict/default]`.
- Collection: `src/data/collection/benefit_case_periods/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/certified-assessment.ts`, `src/lib/benefit-cases/certified-periods.ts`, `src/lib/benefit-cases/reimbursement-lifecycle.ts` (remaining literal references counted in the inventory).

### benefit_case_plans

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `basis_method:enum`, `monthly_full_pay_basis:decimal`, `qualifying_allowances_assessed:bool`, `basis_reference:text`, `basis_file:file`, `plan_number:int`, `plan_created_on:date`, `application_on_at_plan:date`, `advance_due_on:date`, `event_basis_kind:enum`, `event_basis_on:date`, `candidate_amount:decimal`, `candidate_compensable_days:int`, `candidate_window_from:text`, `candidate_window_through:text`, `history_snapshot:text`.
- Identity constraints: unique [{ fields: ['benefit_case_id', 'plan_number'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_plans.benefit_case_id → benefit_cases [owned]`, `benefit_case_plans.supersedes_plan_id → benefit_case_plans [restrict/default]`.
- Collection: `src/data/collection/benefit_case_plans/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/ui/leave/benefit-case-advance-status.svelte`, `src/lib/ui/leave/benefit-case-facts-field.svelte`.

### benefit_case_qualifications

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `lifecycle:state`, `source_key:text`, `qualification_code:text`, `decision_kind:enum`, `status:enum`, `scope:enum`, `from:date`, `through:date`, `decided_on:date`, `received_on:date`, `reference:text`, `authority:text`, `authority_reference:text`, `source_file:file`.
- Identity constraints: unique [ { fields: ['source_key'], where: { source_key: { isNull: false } } }, { fields: ['benefit_case_id', 'qualification_code'], where: { decision_kind: { eq: 'ORIGINAL' } } }, { fields: ['supersedes_qualification_id'], where: { supersedes_qualification_id: { isNull: false } } } ]; noOverlap —.
- Explicit state: lifecycle, status.
- Relationships: `benefit_case_qualifications.benefit_case_id → benefit_cases [owned]`, `benefit_case_qualifications.supersedes_qualification_id → benefit_case_qualifications [restrict/default]`.
- Collection: `src/data/collection/benefit_case_qualifications/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/qualifications.ts`, `src/lib/every-field.ts`.

### benefit_case_refund_orders

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `authority_reference:text`, `authority_on:date`, `effective_on:date`, `known_on:date`, `authority_basis:enum`, `currency:currency`, `amount:decimal`, `authority_file:file`.
- Identity constraints: unique [{ fields: ['supersedes_refund_order_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_refund_orders.benefit_case_id → benefit_cases [restrict/default]`, `benefit_case_refund_orders.supersedes_refund_order_id → benefit_case_refund_orders [restrict/default]`.
- Collection: `src/data/collection/benefit_case_refund_orders/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/refund-sources.ts`, `src/lib/every-field.ts`, `src/lib/payroll/run/clearance-filing.ts`.

### benefit_case_refund_portions

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `portion_reference:text`, `amount:decimal`, `allocation_reference:text`, `allocation_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_refund_order_id', 'payment_allocation_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_refund_portions.benefit_case_refund_order_id → benefit_case_refund_orders [restrict/default]`, `benefit_case_refund_portions.payment_allocation_id → payment_allocations [restrict/default]`.
- Collection: `src/data/collection/benefit_case_refund_portions/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/refund-sources.ts`, `src/lib/every-field.ts`, `src/lib/payroll/run/clearance-filing.ts`.

### benefit_case_reimbursement_claims

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `claim_reference:text`, `claim_kind:enum`, `submitted_on:date`, `currency:currency`, `submitted_amount:money`, `paid_period_ids:json:shaped`, `claim_file:file`, `known_on:date`.
- Identity constraints: unique [ { "fields": [ "benefit_case_id", "claim_reference" ], "where": { "supersedes_claim_id": { "isNull": true } } }, { "fields": [ "supersedes_claim_id" ], "where": { "supersedes_claim_id": { "isNull": false } } } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_reimbursement_claims.benefit_case_id → benefit_cases [restrict/default]`, `benefit_case_reimbursement_claims.supersedes_claim_id → benefit_case_reimbursement_claims [restrict/default]`.
- Collection: `src/data/collection/benefit_case_reimbursement_claims/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/reimbursement-lifecycle.ts`, `src/lib/benefit-cases/reimbursement-recovery-admission.ts`, `src/lib/benefit-cases/reimbursement-recovery.ts` (remaining literal references counted in the inventory).

### benefit_case_reimbursement_decisions

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `decision_reference:text`, `decision_on:date`, `known_on:date`, `result:enum`, `currency:currency`, `approved_amount:money`, `decision_file:file`.
- Identity constraints: unique [ { "fields": [ "benefit_case_reimbursement_claim_id" ], "where": { "supersedes_decision_id": { "isNull": true } } }, { "fields": [ "supersedes_decision_id" ], "where": { "supersedes_decision_id": { "isNull": false } } } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_reimbursement_decisions.benefit_case_reimbursement_claim_id → benefit_case_reimbursement_claims [restrict/default]`, `benefit_case_reimbursement_decisions.supersedes_decision_id → benefit_case_reimbursement_decisions [restrict/default]`.
- Collection: `src/data/collection/benefit_case_reimbursement_decisions/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/reimbursement-lifecycle.ts`, `src/lib/benefit-cases/reimbursement-recovery-admission.ts`, `src/lib/benefit-cases/reimbursement-recovery.ts` (remaining literal references counted in the inventory).

### benefit_case_reimbursement_employer_claims

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `employer_reference:text`, `claim_reference:text`, `currency:currency`, `unapportioned_amount:money`, `submitted_on:date`, `known_on:date`, `claim_file:file`.
- Identity constraints: unique [{fields:['benefit_case_reimbursement_employer_scope_id','employer_reference','claim_reference'],where:{supersedes_employer_claim_id:{isNull:true}}},{fields:['supersedes_employer_claim_id']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_reimbursement_employer_claims.benefit_case_reimbursement_employer_scope_id → benefit_case_reimbursement_employer_scopes [restrict/default]`, `benefit_case_reimbursement_employer_claims.supersedes_employer_claim_id → benefit_case_reimbursement_employer_claims [restrict/default]`.
- Collection: `src/data/collection/benefit_case_reimbursement_employer_claims/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/reimbursement-employer-admission.ts`, `src/lib/benefit-cases/reimbursement-employer-sources.ts`, `src/lib/every-field.ts`.

### benefit_case_reimbursement_employer_scopes

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `episode_reference:text`, `currency:currency`, `scope_reference:text`, `source_on:date`, `known_on:date`, `complete_episode:bool`, `expected_employer_references:json:shaped`, `scope_file:file`.
- Identity constraints: unique [{fields:['benefit_case_id','scope_reference'],where:{supersedes_scope_id:{isNull:true}}},{fields:['supersedes_scope_id']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_reimbursement_employer_scopes.benefit_case_id → benefit_cases [restrict/default]`, `benefit_case_reimbursement_employer_scopes.supersedes_scope_id → benefit_case_reimbursement_employer_scopes [restrict/default]`.
- Collection: `src/data/collection/benefit_case_reimbursement_employer_scopes/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/reimbursement-employer-admission.ts`, `src/lib/benefit-cases/reimbursement-employer-sources.ts`, `src/lib/every-field.ts`.

### benefit_case_reimbursement_months

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference_month_on:date`, `currency:currency`, `expected_component_count:int`, `expected_premium_count:int`, `known_on:date`, `scope_reference:text`, `scope_file:file`.
- Identity constraints: unique [{fields:['benefit_case_id','scope_reference']},{fields:['supersedes_month_id']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_reimbursement_months.benefit_case_id → benefit_cases [restrict/default]`, `benefit_case_reimbursement_months.supersedes_month_id → benefit_case_reimbursement_months [restrict/default]`.
- Collection: `src/data/collection/benefit_case_reimbursement_months/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/reimbursement-months.ts`, `src/lib/benefit-cases/reimbursement-source-admission.ts`, `src/lib/every-field.ts` (remaining literal references counted in the inventory).

### benefit_case_reimbursement_premiums

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference_month_on:date`, `premium_scheme:text`, `allocation_reference:text`, `source_kind:enum`, `source_on:date`, `source_issuer_reference:text`, `currency:currency`, `amount:decimal`, `known_on:date`, `source_reference:text`, `source_file:file`.
- Identity constraints: unique [{fields:['payslip_id','premium_scheme','allocation_reference'],where:{supersedes_premium_id:{isNull:true}}},{fields:["benefit_case_id", "source_reference"]},{fields:['supersedes_premium_id']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_reimbursement_premiums.benefit_case_id → benefit_cases [restrict/default]`, `benefit_case_reimbursement_premiums.reimbursement_rate_id → benefit_case_reimbursement_rates [restrict/default]`, `benefit_case_reimbursement_premiums.payslip_id → payslips [restrict/default]`, `benefit_case_reimbursement_premiums.supersedes_premium_id → benefit_case_reimbursement_premiums [restrict/default]`.
- Collection: `src/data/collection/benefit_case_reimbursement_premiums/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/reimbursement-months.ts`, `src/lib/benefit-cases/reimbursement-source-admission.ts`, `src/lib/every-field.ts` (remaining literal references counted in the inventory).

### benefit_case_reimbursement_rates

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference_month_on:date`, `component_reference:text`, `component_kind:text`, `payroll_component_code:text`, `currency:currency`, `monthly_amount:decimal`, `known_on:date`, `classification_reference:text`, `source_reference:text`, `source_file:file`.
- Identity constraints: unique [{fields:["benefit_case_id", "source_reference"]},{fields:['supersedes_rate_id']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_reimbursement_rates.benefit_case_id → benefit_cases [restrict/default]`, `benefit_case_reimbursement_rates.supersedes_rate_id → benefit_case_reimbursement_rates [restrict/default]`.
- Collection: `src/data/collection/benefit_case_reimbursement_rates/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/reimbursement-months.ts`, `src/lib/benefit-cases/reimbursement-source-admission.ts`, `src/lib/every-field.ts` (remaining literal references counted in the inventory).

### benefit_case_reimbursement_receipt_allocations

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `allocation_reference:text`, `amount:decimal`, `known_on:date`, `allocation_file:file`.
- Identity constraints: unique [ { "fields": [ "benefit_case_reimbursement_receipt_id", "allocation_reference" ] }, { "fields": [ "benefit_case_reimbursement_receipt_id", "benefit_case_reimbursement_decision_id" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_reimbursement_receipt_allocations.benefit_case_reimbursement_receipt_id → benefit_case_reimbursement_receipts [restrict/default]`, `benefit_case_reimbursement_receipt_allocations.benefit_case_reimbursement_decision_id → benefit_case_reimbursement_decisions [restrict/default]`.
- Collection: `src/data/collection/benefit_case_reimbursement_receipt_allocations/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/reimbursement-lifecycle.ts`, `src/lib/benefit-cases/reimbursement-recovery-admission.ts`, `src/lib/benefit-cases/reimbursement-recovery.ts` (remaining literal references counted in the inventory).

### benefit_case_reimbursement_receipts

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `receipt_reference:text`, `received_on:date`, `known_on:date`, `currency:currency`, `amount:money`, `expected_allocation_count:int`, `bank_file:file`.
- Identity constraints: unique [ { "fields": [ "company_id", "receipt_reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_case_reimbursement_receipts.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/benefit_case_reimbursement_receipts/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/reimbursement-lifecycle.ts`, `src/lib/benefit-cases/reimbursement-recovery-admission.ts`, `src/lib/benefit-cases/reimbursement-recovery.ts` (remaining literal references counted in the inventory).

### benefit_cases

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `case_type:text`, `case_reference:text`, `application_on:date`, `expected_event_on:date`, `event_kind:text`, `event_on:date`, `leave_from:date`, `leave_through:date`, `facts:custom`, `event_quota_book:custom`, `event_quota_book_file:file`, `notified_on:date`, `notification_reference:text`, `documented_award_components:custom`, `award_amount:decimal`, `awarded_on:date`, `award_reference:text`, `award_file:file`, `award_cash_channel:custom`, `award_cash_channel_source_file:file`.
- Identity constraints: unique [ { fields: ['employee_id', 'case_reference'] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `benefit_cases.employee_id → employees [restrict/default]`, `benefit_cases.employment_id → employments [restrict/default]`.
- Collection: `src/data/collection/benefit_cases/+collection.ts`. Runtime consumer examples: `src/lib/award-cash-channel.ts`, `src/lib/benefit-cases/benefit.ts`, `src/lib/benefit-cases/lump-sum-assessment.ts` (remaining literal references counted in the inventory).

### claim_catalogue

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `code:text`, `name:text`, `authority:text`, `destination:enum`, `direction:enum`, `bands:custom`, `eligibility:text`, `qualifies_when:text`, `evidence:enum`, `request_requirements:custom`, `request_facts:custom`, `assessed_for:custom`, `counts_toward:custom`.
- Identity constraints: unique [{ fields: ['settings_id', 'code'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `claim_catalogue.settings_id → jurisdiction_settings [owned]`.
- Collection: `src/data/collection/claim_catalogue/+collection.ts`. Runtime consumer examples: `src/lib/catalogue-offer.ts`, `src/lib/catalogue-source-scope.ts`, `src/lib/every-field.ts` (remaining literal references counted in the inventory).

### claim_requests

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `fact_dossier:json:opaque`, `recovery_cost_class:text`, `recovery_cost_reference:text`, `entitlement_identity_key:text`, `amount:decimal`, `incurred_on:date`, `description:text`, `evidence_file:file`, `due_on:date`, `facts:custom`, `as_adjustment_entry:bool`, `pay_period:text`.
- Identity constraints: unique [{ fields: ['entitlement_identity_key'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `claim_requests.employment_id → employments [restrict/default]`, `claim_requests.catalogue_id → claim_catalogue [restrict/default]`, `claim_requests.payslip_id → payslips [restrict/default]`.
- Collection: `src/data/collection/claim_requests/+collection.ts`. Runtime consumer examples: `src/lib/employment-contract.ts`, `src/lib/every-field.ts`, `src/lib/expressions/contexts.ts` (remaining literal references counted in the inventory).

### clearance_return_filings

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `form_metadata:json:opaque`, `form_metadata_evidence_file:file`, `official_payloads:json:opaque`, `as_of:date`, `through_on:date`, `submission:text`, `form:text`, `authorised:json:opaque`, `baseline_ids:json:opaque`, `baseline_key:text`, `source_snapshot:json:opaque`, `records:json:opaque`, `full_record:json:opaque`, `projection:enum`, `withheld_amount:decimal`, `no_withholding_reason:text`, `withholding_evidence_file:file`, `retain_through_on:date`, `state:state`, `submitted_on:date`, `accepted_on:date`, `acceptance_reference:text`, `acceptance_evidence_file:file`, `release_mode:enum`, `directive_on:date`, `directive_reference:text`, `protected_liability_permissions:json:opaque`, `protected_liability_permission_evidence_file:file`, `directive_evidence_file:file`.
- Identity constraints: unique [{ fields: ['employment_id','baseline_key'], where: { state: { in: ['ACCEPTED','CLEARED'] } } }]; noOverlap —.
- Explicit state: state.
- Relationships: `clearance_return_filings.employment_id → employments [restrict/default]`, `clearance_return_filings.clearance_case_id → tax_clearance_cases [restrict/default]`.
- Collection: `src/data/collection/clearance_return_filings/+collection.ts`. Runtime consumer examples: `src/lib/employment-contract.ts`, `src/lib/every-field.ts`, `src/lib/payroll/run/clearance-filing.ts` (remaining literal references counted in the inventory).

### companies

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `settings_code:text`, `name:text`, `registration_number:text`, `pay_cutoff_day:int`, `late_arrival_grace_minutes:int`, `pay_frequency:enum`, `pay_cycle_months:int`, `pay_cycle_anchor:text`, `instalment_statutory_cutoff:enum`, `semi_monthly_statutory_cutoff:enum`, `risk_class:text`, `region:text`, `facts:custom`, `holiday_source:custom`, `workbook_layout:enum`, `disbursement_account:custom`, `effective_range:period`.
- Identity constraints: unique —; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: none declared.
- Collection: `src/data/collection/companies/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/benefit.ts`, `src/lib/benefit-cases/lump-sum-assessment.ts`, `src/lib/benefit-cases/payroll-guard.ts` (remaining literal references counted in the inventory).

### company_facts

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `facts:custom`, `effective_range:period`.
- Identity constraints: unique —; noOverlap [{ key: ['company_id'], period: 'effective_range', name: 'company_facts_no_overlap' }].
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `company_facts.company_id → companies [owned]`.
- Collection: `src/data/collection/company_facts/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/facts-owed.ts`, `src/lib/leave/context.ts` (remaining literal references counted in the inventory).

### component_payment_agreements

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `agreed_on:date`, `evidence_file:file`, `instalments:custom`, `currency:currency`, `original_due_on:date`, `component_amount:money`, `agreed_amount:money`, `snapshot:json:opaque`.
- Identity constraints: unique [{fields:['supersedes_id'],where:{supersedes_id:{isNull:false}}},{fields:['adhoc_request_id'],where:{supersedes_id:{isNull:true}}}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `component_payment_agreements.employment_id → employments [restrict/default]`, `component_payment_agreements.employee_id → employees [restrict/default]`, `component_payment_agreements.company_id → companies [restrict/default]`, `component_payment_agreements.adhoc_request_id → adhoc_requests [restrict/default]`, `component_payment_agreements.supersedes_id → component_payment_agreements [restrict/default]`.
- Collection: `src/data/collection/component_payment_agreements/+collection.ts`. Runtime consumer examples: `src/lib/component-payment-agreement.ts`, `src/lib/every-field.ts`.

### component_payment_allocations

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `instalment_reference:text`, `reference:text`, `evidence_file:file`, `currency:currency`, `amount:money`.
- Identity constraints: unique [{fields:['source_cash_payment_id','component_payment_agreement_id','instalment_reference','reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `component_payment_allocations.employment_id → employments [restrict/default]`, `component_payment_allocations.employee_id → employees [restrict/default]`, `component_payment_allocations.company_id → companies [restrict/default]`, `component_payment_allocations.component_payment_agreement_id → component_payment_agreements [restrict/default]`, `component_payment_allocations.source_cash_payment_id → source_cash_payments [restrict/default]`.
- Collection: `src/data/collection/component_payment_allocations/+collection.ts`. Runtime consumer examples: `src/lib/component-payment-agreement.ts`, `src/lib/every-field.ts`.

### component_release_receipts

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `original_hold_reference:text`, `scope_reference:text`, `original_component_reference:text`, `original_due_on:date`, `currency:currency`, `original_component_gross:money`, `original_component_deductions:money`, `effective_on:date`, `recorded_on:date`, `source_reference:text`, `evidence_file:file`, `facts:json:opaque`.
- Identity constraints: unique [{ fields: ['scope_reference', 'original_hold_reference', 'reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `component_release_receipts.company_id → companies [restrict/default]`, `component_release_receipts.employment_id → employments [restrict/default]`, `component_release_receipts.instruction_id → component_suspension_instructions [restrict/default]`.
- Collection: `src/data/collection/component_release_receipts/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/component-release.ts`.

### component_suspension_instructions

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `scope_reference:text`, `held_on:date`, `recorded_on:date`, `source_reference:text`, `evidence_file:file`, `facts:json:opaque`, `component_payment_basis:custom`, `original_component_reference:text`, `original_due_on:date`, `currency:currency`, `original_component_gross:money`, `original_component_deductions:money`.
- Identity constraints: unique [{ fields: ['scope_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `component_suspension_instructions.company_id → companies [restrict/default]`, `component_suspension_instructions.employment_id → employments [restrict/default]`, `component_suspension_instructions.payable_tranche_id → payable_tranches [restrict/default]`.
- Collection: `src/data/collection/component_suspension_instructions/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/component-release.ts`, `src/lib/ui/component-payment-facts.svelte`.

### conditional_refund_cash_corrections

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `reason:text`, `allocations:json:opaque`, `component_allocation_file:file`, `known_on:date`, `predecessor_key:text`, `snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "predecessor_key" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `conditional_refund_cash_corrections.conditional_refund_cash_source_id → conditional_refund_cash_sources [restrict/default]`, `conditional_refund_cash_corrections.supersedes_correction_id → conditional_refund_cash_corrections [restrict/default]`, `conditional_refund_cash_corrections.company_id → companies [restrict/default]`, `conditional_refund_cash_corrections.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/conditional_refund_cash_corrections/+collection.ts`. Runtime consumer examples: `src/lib/conditional-refund-cash-corrections.ts`, `src/lib/conditional-refund-cash-source.ts`, `src/lib/every-field.ts`.

### conditional_refund_cash_sources

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `authority_refund_file:file`, `source_system:text`, `source_payment_id:text`, `reference:text`, `payer_reference:text`, `recipient_reference:text`, `paid_on:date`, `received_on:date`, `known_on:date`, `bank_file:file`, `parties_file:file`, `component_allocation_file:file`, `currency:currency`, `cash_amount:money`, `origin:enum`, `complete_refund_register:boolean`, `allocations:json:opaque`, `snapshot:json:opaque`, `qualification:enum`.
- Identity constraints: unique [ { "fields": [ "source_system", "source_payment_id" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `conditional_refund_cash_sources.company_id → companies [restrict/default]`, `conditional_refund_cash_sources.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/conditional_refund_cash_sources/+collection.ts`. Runtime consumer examples: `src/lib/conditional-annual-source.ts`, `src/lib/conditional-authority-refunds.ts`, `src/lib/conditional-original-refunds.ts` (remaining literal references counted in the inventory).

### conditional_refund_notice_corrections

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `sent_on:date`, `recipient_reference:text`, `reason:text`, `evidence_file:file`, `known_on:date`, `predecessor_key:text`, `snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "predecessor_key" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `conditional_refund_notice_corrections.conditional_refund_notice_id → conditional_refund_notices [restrict/default]`, `conditional_refund_notice_corrections.supersedes_correction_id → conditional_refund_notice_corrections [restrict/default]`, `conditional_refund_notice_corrections.company_id → companies [restrict/default]`, `conditional_refund_notice_corrections.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/conditional_refund_notice_corrections/+collection.ts`. Runtime consumer examples: `src/lib/conditional-notice-corrections.ts`, `src/lib/every-field.ts`.

### conditional_refund_notices

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `refund_on:date`, `reference:text`, `sent_on:date`, `recipient_reference:text`, `evidence_file:file`, `known_on:date`, `snapshot:json:opaque`.
- Identity constraints: unique [{"fields":["conditional_refund_report_id","original_income_event_id","refund_on"]}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `conditional_refund_notices.conditional_refund_report_id → conditional_refund_reports [restrict/default]`, `conditional_refund_notices.company_id → companies [restrict/default]`, `conditional_refund_notices.employee_id → employees [restrict/default]`, `conditional_refund_notices.original_income_event_id → employment_income_events [restrict/default]`.
- Collection: `src/data/collection/conditional_refund_notices/+collection.ts`. Runtime consumer examples: `src/lib/conditional-notice-corrections.ts`, `src/lib/every-field.ts`.

### conditional_refund_reports

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `basis_year:int`, `due_on:date`, `sent_late:bool`, `prepared_on:date`, `retain_through_on:date`, `snapshot:json:opaque`, `state:state`, `sent_on:date`, `sent_reference:text`, `sent_file:file`, `acknowledged_on:date`, `acknowledgement_reference:text`, `acknowledgement_file:file`.
- Identity constraints: unique [{"fields":["income_return_filing_id"]}]; noOverlap —.
- Explicit state: state.
- Relationships: `conditional_refund_reports.income_return_filing_id → income_return_filings [restrict/default]`, `conditional_refund_reports.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/conditional_refund_reports/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### contribution_statement_months

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `scheme_code:text`, `coverage_month:text`, `credited_amount:decimal`, `insured_wage_base:decimal`, `paid_on:date`, `source_reference:text`, `evidence_file:file`.
- Identity constraints: unique [{ fields: ['employee_id', 'scheme_code', 'coverage_month'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `contribution_statement_months.employee_id → employees [owned]`.
- Collection: `src/data/collection/contribution_statement_months/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### deduction_authorization_restrictions

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `effective_on:date`, `known_on:date`, `reference:text`, `evidence_file:file`, `currency:currency`, `maximum_recoverable_amount:money`.
- Identity constraints: unique [{fields:['deduction_authorization_id','effective_on']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `deduction_authorization_restrictions.employment_id → employments [restrict/default]`, `deduction_authorization_restrictions.employee_id → employees [restrict/default]`, `deduction_authorization_restrictions.company_id → companies [restrict/default]`, `deduction_authorization_restrictions.deduction_authorization_id → deduction_authorizations [restrict/default]`.
- Collection: `src/data/collection/deduction_authorization_restrictions/+collection.ts`. Runtime consumer examples: `src/lib/deduction-authorization.ts`, `src/lib/every-field.ts`, `src/lib/payroll/money.ts` (remaining literal references counted in the inventory).

### deduction_authorization_withdrawals

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `received_on:date`, `effective_on:date`, `evidence_file:file`.
- Identity constraints: unique [{fields:['deduction_authorization_id']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `deduction_authorization_withdrawals.employment_id → employments [restrict/default]`, `deduction_authorization_withdrawals.employee_id → employees [restrict/default]`, `deduction_authorization_withdrawals.company_id → companies [restrict/default]`, `deduction_authorization_withdrawals.deduction_authorization_id → deduction_authorizations [restrict/default]`.
- Collection: `src/data/collection/deduction_authorization_withdrawals/+collection.ts`. Runtime consumer examples: `src/lib/deduction-authorization.ts`, `src/lib/every-field.ts`, `src/lib/payroll/money.ts` (remaining literal references counted in the inventory).

### deduction_authorizations

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move the exact dossier field set below to snapshot-schema JSON on the actual worker profile; keep derived authorization-budget consumption in the generic operational allocation ledger.
- Fields: `property_liability:json:opaque`, `property_liability_identity:text`, `medical_bill_key:text`, `medical_source:json:opaque`, `specific_cap_amount:money`, `facts:custom`, `reference:text`, `authorized_on:date`, `effective_on:date`, `expires_on:date`, `purpose:text`, `employer_can_collect:bool`, `permission_file:file`, `basis:enum`, `source_file:file`, `beneficial_to_employee:bool`, `withdrawal_right:bool`, `components:json:opaque`, `statutory_recovery:json:opaque`, `recovery_wage_statement_file:file`, `recovery_payment_file:file`, `recovery_omission_file:file`, `recovery_conditions_file:file`, `statutory_recovery_identity:text`, `currency:currency`, `amount:money`, `snapshot:json:opaque`.
- Identity constraints: unique [{fields:['company_id','employee_id','property_liability_identity'],where:{property_liability_identity:{isNull:false}}},{fields:['medical_bill_key']},{fields:['company_id','employee_id','reference']},{fields:['company_id','employee_id','statutory_recovery_identity'],where:{statutory_recovery_identity:{isNull:false}}}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `deduction_authorizations.property_liability_catalogue_id → adhoc_catalogue [restrict/default]`, `deduction_authorizations.employment_id → employments [restrict/default]`, `deduction_authorizations.employee_id → employees [restrict/default]`, `deduction_authorizations.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/deduction_authorizations/+collection.ts`. Runtime consumer examples: `src/lib/deduction-authorization.ts`, `src/lib/every-field.ts`, `src/lib/medical-copayment-ledger.ts` (remaining literal references counted in the inventory).

### earnings_pool_members

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `worker_reference:text`, `managerial:bool`, `classification_reference:text`, `service_units:decimal`, `service_reference:text`, `service_file:file`, `payment_route:enum`, `provider_transfer_on:date`, `provider_transfer_amount:decimal`, `provider_transfer_reference:text`, `provider_transfer_file:file`, `worker_statutory_withheld:decimal`, `worker_withholding_reference:text`, `worker_paid_on:date`, `worker_amount_paid:decimal`, `worker_payment_reference:text`, `worker_payment_file:file`.
- Identity constraints: unique [{ fields: ['pool_id', 'worker_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `earnings_pool_members.pool_id → earnings_pools [owned]`, `earnings_pool_members.employee_id → employees [restrict/default]`, `earnings_pool_members.employment_id → employments [restrict/default]`, `earnings_pool_members.provider_company_id → companies [restrict/default]`.
- Collection: `src/data/collection/earnings_pool_members/+collection.ts`. Runtime consumer examples: `src/lib/earnings-pools/requests.ts`, `src/lib/every-field.ts`.

### earnings_pools

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `pool_kind:text`, `collection_from:date`, `collection_to:date`, `currency:currency`, `collected_amount:decimal`, `collection_reference:text`, `collection_file:file`, `unit_basis:enum`, `covered_roster_complete:bool`, `covered_roster_reference:text`, `covered_roster_file:file`, `cycle_basis:enum`, `previous_distribution_on:date`, `previous_distribution_reference:text`, `distribution_due_on:date`, `residual_policy_reference:text`, `state:state`, `allocations:custom`.
- Identity constraints: unique [{ fields: ['company_id', 'collection_reference'] }]; noOverlap —.
- Explicit state: state.
- Relationships: `earnings_pools.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/earnings_pools/+collection.ts`. Runtime consumer examples: `src/lib/earnings-pools/requests.ts`, `src/lib/every-field.ts`.

### employees

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `name:text`, `date_of_birth:date`, `gender:enum`, `marital_status:enum`, `solo_parent:bool`, `disabled:bool`, `receiving_pension:bool`, `race:text`, `religion:text`, `spouse_status:enum`, `children:custom`, `nationality:text`, `identity_number:text`, `dependents_count:int`, `email:text`, `phone:text`, `address:text`, `location:point`, `face_embedding:vector`, `face_photo:file`, `face_enrollment_status:enum`, `face_consent_at:instant`, `face_enrolled_at:instant`, `face_last_match_at:instant`, `face_match_count:int`.
- Identity constraints: unique —; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `employees.user_id → sys_user [restrict/default]`.
- Collection: `src/data/collection/employees/+collection.ts`. Runtime consumer examples: `src/lib/checks.ts`, `src/lib/coded-fields.ts`, `src/lib/component_entry_cap_subject.ts` (remaining literal references counted in the inventory).

### employer_assessment_events

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `lifecycle:state`, `agency_remittance_id:text`, `agency_remittance_source:text`, `agency_remittance_key:text`, `agency_paid_payslip_id:text`, `agency_paid_statutory_index:int`, `agency_bank_source:json:opaque`, `agency_bank_event_id:text`, `agency_bank_component_identity:text`, `agency_bank_source_key:text`, `agency_bank_component_key:text`, `agency_allocation:json:opaque`, `agency_receipt_key:text`, `action_code:text`, `deposit_sequence:int`, `kind:enum`, `amount:decimal`, `event_on:date`, `currency:currency`, `reference:text`, `evidence_file:file`, `facts:custom`, `declared_facts:json:opaque`, `settings_code:text`, `due_on:date`, `action_authority:text`.
- Identity constraints: unique [ { fields: ['agency_remittance_key'], where: { agency_remittance_key: { isNull: false } } }, { fields: ['agency_bank_source_key'], where: { agency_bank_source_key: { isNull: false } } }, { fields: ['agency_bank_component_key'], where: { agency_bank_component_key: { isNull: false } } }, { fields: ['agency_receipt_key'], where: { agency_receipt_key: { isNull: false } } }, { fields: ['assessment_id', 'reference'] }, { fields: ['deposit_id', 'deposit_sequence'], where: { deposit_id: { isNull: false } } }, { fields: ['reverses_event_id'], where: { reverses_event_id: { isNull: false } } } ]; noOverlap —.
- Explicit state: lifecycle.
- Relationships: `employer_assessment_events.deposit_id → employer_assessment_events [restrict/default]`, `employer_assessment_events.agency_source_history_id → employment_history [restrict/default]`, `employer_assessment_events.agency_employee_id → employees [restrict/default]`, `employer_assessment_events.assessment_id → employer_assessments [restrict/default]`, `employer_assessment_events.original_payment_event_id → employer_assessment_events [restrict/default]`, `employer_assessment_events.reverses_event_id → employer_assessment_events [restrict/default]`.
- Collection: `src/data/collection/employer_assessment_events/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/world.ts`.

### employer_assessment_policies

- Target: **NEEDS_EVIDENCE**. Separate immutable configuration-snapshot policy definitions from entity-authored original source values. Both must be snapshot-driven; resolve whether any generic operational identity remains before retiring the dedicated policy model.
- Fields: `currency:currency`, `assessment_basis:enum`, `currency:currency`, `agency_assessment:custom`, `assessment_basis:enum`, `code:text`, `name:text`, `authority:text`, `facts:custom`, `worker_facts:custom`, `eligible_when:text`, `company_base:text`, `member_source_kind:text`, `member_source_calculation:text`, `member_scope_fact:text`, `member_year_date_fact:text`, `member_total_fact:text`, `member_class_fact:text`, `member_rate_numerator_fact:text`, `member_rate_denominator_fact:text`, `worker_base:text`, `charge:text`, `scope_expression:text`, `year_date_expression:text`, `due_expression:text`, `actions:custom`.
- Identity constraints: unique [{ fields: ['settings_id', 'code'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `employer_assessment_policies.settings_id → jurisdiction_settings [owned]`.
- Collection: `src/data/collection/employer_assessment_policies/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/settings_clone.ts`, `src/lib/ui/assessment-declarations.svelte.ts`.

### employer_assessments

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `lifecycle:state`, `assessment_basis:enum`, `currency:currency`, `assessment_basis:enum`, `currency:currency`, `reference:text`, `year:int`, `kind:enum`, `assessed_on:date`, `facts:custom`, `declared_facts:json:opaque`, `settings_code:text`, `worker_declarations:json:opaque`, `workers:custom`, `evidence_file:file`, `policy_code:text`, `assessment_scope:text`, `agency_source_keys:json:opaque`, `employee_collection_due:decimal`, `fund_remittance_due:decimal`, `member_source_group_key:text`, `policy_snapshot:json:opaque`, `assessed_base:decimal`, `employer_charge:decimal`, `change_amount:decimal`, `due_on:date`.
- Identity constraints: unique [ { fields: ['member_source_group_key'], where: { member_source_group_key: { isNull: false } } }, { fields: ['company_id', 'reference'] }, { fields: ['company_id', 'year', 'policy_code', 'assessment_scope'], where: { supersedes_assessment_id: { isNull: true }, assessment_basis: { ne: 'AGENCY_ASSESSMENT' } } }, { fields: ['supersedes_assessment_id'], where: { supersedes_assessment_id: { isNull: false } } } ]; noOverlap —.
- Explicit state: lifecycle.
- Relationships: `employer_assessments.company_id → companies [restrict/default]`, `employer_assessments.policy_id → employer_assessment_policies [restrict/default]`, `employer_assessments.supersedes_assessment_id → employer_assessments [restrict/default]`.
- Collection: `src/data/collection/employer_assessments/+collection.ts`. Runtime consumer examples: `src/lib/employer-assessments.ts`, `src/lib/employer-member-base.ts`, `src/lib/every-field.ts` (remaining literal references counted in the inventory).

### employment_history

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `kind:text`, `settings_code:text`, `source_company_id:id`, `recorded_on:date`, `reference:text`, `effective_range:period`, `facts:custom`, `summary:text`.
- Identity constraints: unique —; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `employment_history.employee_id → employees [owned]`, `employment_history.source_company_id → companies [restrict/default]`, `employment_history.predecessor_employment_id → employments [restrict/default]`, `employment_history.successor_employment_id → employments [restrict/default]`.
- Collection: `src/data/collection/employment_history/+collection.ts`. Runtime consumer examples: `src/lib/checks.ts`, `src/lib/component_entry_cap_subject.ts`, `src/lib/declared-fact-evidence.ts` (remaining literal references counted in the inventory).

### employment_income_events

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `valuation_forex_quote_file:file`, `valuation_forex:json:opaque`, `kind:text`, `lifecycle_baseline_key:text`, `amount:decimal`, `event_on:date`, `facts:custom`, `special_metadata:json:opaque`, `special_payloads:json:opaque`, `evidence_file:file`, `source_component_code:text`, `report_on:date`, `income_item:text`, `reportable_amount:decimal`, `taxable:bool`, `withholding_amount:decimal`, `withholding_due_on:date`, `clearance_trigger_type:text`, `special_return:text`, `special_due_on:date`, `accepted_on:date`, `acceptance_reference:text`, `acceptance_evidence_file:file`, `withholding_remitted_on:date`, `withholding_remitted_amount:decimal`, `withholding_payment_reference:text`, `special_accepted_on:date`, `special_acceptance_reference:text`, `special_acceptance_evidence_file:file`, `cash_paid_on:date`, `cash_gross:decimal`, `cash_employee_net:decimal`, `cash_payment_reference:text`, `cash_payment_evidence_file:file`, `withholding_payment_evidence_file:file`.
- Identity constraints: unique [{ fields: ['source_adhoc_request_id'], where: { source_adhoc_request_id: { isNull: false }, supersedes_event_id: { isNull: true } } }, { fields: ['predecessor_event_id', 'lifecycle_baseline_key'], where: { predecessor_event_id: { isNull: false } } }, { fields: ['supersedes_event_id'], where: { supersedes_event_id: { isNull: false } } }, { fields: ['source_payslip_id', 'source_component_code'], where: { source_payslip_id: { isNull: false } } }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `employment_income_events.valuation_forex_policy_id → valuation_forex_policies [restrict/default]`, `employment_income_events.predecessor_event_id → employment_income_events [restrict/default]`, `employment_income_events.supersedes_event_id → employment_income_events [restrict/default]`, `employment_income_events.source_adhoc_request_id → adhoc_requests [restrict/default]`, `employment_income_events.employment_id → employments [restrict/default]`, `employment_income_events.source_payslip_id → payslips [restrict/default]`.
- Collection: `src/data/collection/employment_income_events/+collection.ts`. Runtime consumer examples: `src/lib/conditional-original-qualification.ts`, `src/lib/conditional-refund-cash-source.ts`, `src/lib/employment-contract.ts` (remaining literal references counted in the inventory).

### employment_inquiries

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `recorded_on:date`, `inquiry_reference:text`, `source_settings_code:text`, `source_start_on:date`, `source_through_on:date`, `known_on:date`, `source_file:file`, `suspension_pay_fraction:decimal`, `pay_policy_reference:text`, `pay_policy_file:file`.
- Identity constraints: unique [{fields:['employment_id','inquiry_reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `employment_inquiries.employment_id → employments [restrict/default]`, `employment_inquiries.employee_id → employees [restrict/default]`, `employment_inquiries.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/employment_inquiries/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### employment_inquiry_authorities

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `recorded_on:date`, `authority_kind:enum`, `authority_reference:text`, `authority_on:date`, `known_on:date`, `authority_file:file`, `effective_from_on:date`, `application_received_on:date`, `application_receipt_reference:text`, `extension_through_on:date`, `employee_heard:bool`, `hearing_reference:text`, `hearing_file:file`.
- Identity constraints: unique [{fields:['supersedes_inquiry_authority_id']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `employment_inquiry_authorities.employment_inquiry_id → employment_inquiries [restrict/default]`, `employment_inquiry_authorities.employment_id → employments [restrict/default]`, `employment_inquiry_authorities.employee_id → employees [restrict/default]`, `employment_inquiry_authorities.company_id → companies [restrict/default]`, `employment_inquiry_authorities.supersedes_inquiry_authority_id → employment_inquiry_authorities [restrict/default]`, `employment_inquiry_authorities.misconduct_finding_id → employment_inquiry_authorities [restrict/default]`.
- Collection: `src/data/collection/employment_inquiry_authorities/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### employment_statutory_facts

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `election_cessation_source:json:opaque`, `election_cessation_file:file`, `unit_assessment_source:json:opaque`, `unit_assessment_source_file:file`, `status:custom`, `effective_range:period`, `summary:text`.
- Identity constraints: unique —; noOverlap [ { key: ['employee_id', 'statutory_contribution_id', 'employment_id'], period: 'effective_range', name: 'employment_statutory_facts_no_overlap' } ].
- Explicit state: status.
- Relationships: `employment_statutory_facts.employee_id → employees [owned]`, `employment_statutory_facts.employment_id → employments [restrict/default]`, `employment_statutory_facts.statutory_contribution_id → statutory_contributions [restrict/default]`.
- Collection: `src/data/collection/employment_statutory_facts/+collection.ts`. Runtime consumer examples: `src/lib/component_entry_cap_subject.ts`, `src/lib/declared-fact-evidence.ts`, `src/lib/every-field.ts` (remaining literal references counted in the inventory).

### employment_terms

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `leave_remuneration_sources:json:opaque`, `leave_remuneration_source_file:file`, `lifecycle_source_file:file`, `lifecycle_source_references:json:opaque`, `lifecycle_assessment:json:opaque`, `lifecycle_findings:json:opaque`, `residency_status:enum`, `residency_since:date`, `pass_type:text`, `tax_residency:text`, `currency:currency`, `base_salary:money`, `worksite:text`, `worksite_sector:text`, `allowances:custom`, `contractual_calendar:custom`, `pay_frequency:enum`, `work_classification:text`, `statutory_work_category:text`, `weather_dependent_piece:bool`, `employment_type:enum`, `notice_days:int`, `department:text`, `job_title:text`, `payroll_group:text`, `proration:custom`, `paid_rest_days:bool`, `grade:text`, `ordinary_hours_per_week:decimal`, `comparable_full_time_daily_hours:decimal`, `comparable_full_time_weekly_hours:decimal`, `comparable_full_time_presence:enum`, `opening_attendance_through:date`, `opening_unexcused_absence_days:int`, `opening_attendance_reference:text`, `facts:custom`, `leave_cash_declarations:custom`, `effective_range:period`, `summary:text`.
- Identity constraints: unique —; noOverlap [ { key: ['employment_id'], period: 'effective_range', name: 'employment_terms_no_overlap' } ].
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `employment_terms.employment_id → employments [owned]`, `employment_terms.shift_pattern_id → shift_patterns [restrict/default]`, `employment_terms.worksite_id → worksites [restrict/default]`.
- Collection: `src/data/collection/employment_terms/+collection.ts`. Runtime consumer examples: `src/lib/component_entry_cap_subject.ts`, `src/lib/datatypes/cpf_wage_allocations.ts`, `src/lib/datatypes/holiday_snapshots.ts` (remaining literal references counted in the inventory).

### employment_wage_periods

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `period:period`, `currency:currency`, `normal_wages:money`, `ordinary_wages:money`, `basic_ordinary_wages:money`, `statutory_wages:money`, `statutory_fixed_calendar_wages:money`, `statutory_fixed_calendar_reference:text`, `exact_basic_wages:money`, `exact_gross_wages:money`, `regular_remuneration:money`, `total_remuneration:money`, `remuneration_reference:text`, `remuneration_basis:enum`, `exact_received_basic_wages:money`, `received_wage_components:custom`, `received_component_basis:enum`, `received_component_gross_source:json:opaque`, `received_component_file:file`, `received_wage_reference:text`, `earned_workdays:custom`, `earned_workday_from:date`, `earned_workday_through:date`, `earned_workday_file:file`, `statutory_worked_hours:decimal`, `rate_equivalent_days:decimal`, `rate_wage_reference:text`, `statutory_worked_days:int`, `average_wage_treatment:enum`, `average_wage_reference:text`, `ordinary_days:decimal`, `due_on:date`, `paid_on:date`, `reference:text`.
- Identity constraints: unique [{ fields: ['gross_correction_predecessor_id'], where: { gross_correction_predecessor_id: { isNull: false } } }]; noOverlap [ { key: ['employment_id'], period: 'period', where: { gross_correction_predecessor_id: { isNull: true } }, name: 'employment_wage_periods_no_overlap' } ].
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `employment_wage_periods.gross_correction_predecessor_id → employment_wage_periods [restrict/default]`, `employment_wage_periods.received_payslip_id → payslips [restrict/default]`, `employment_wage_periods.employment_id → employments [owned]`.
- Collection: `src/data/collection/employment_wage_periods/+collection.ts`. Runtime consumer examples: `src/lib/component_entry_cap_subject.ts`, `src/lib/datatypes/earned_workdays.ts`, `src/lib/every-field.ts` (remaining literal references counted in the inventory).

### employments

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `retirement_source:json:opaque`, `retirement_source_file:file`, `retirement_source_references:json:opaque`, `retirement_assessment:json:opaque`, `lifecycle_source_file:file`, `lifecycle_source_references:json:opaque`, `lifecycle_assessment:json:opaque`, `lifecycle_findings:json:opaque`, `employee_number:text`, `contract_number:seq`, `bank:custom`, `effective_range:period`, `signed_contract_end:date`, `prior_service_months:int`, `exit_ground:text`, `exit_facts:custom`, `comments:text`, `encashment_due_on:date`, `encashment_raised_at:instant`.
- Identity constraints: unique —; noOverlap [ // one contract per person and entity on any date { key: ['company_id', 'employee_id'], period: 'effective_range', name: 'employments_no_overlap' }, // an employee number names one person per entity on any date { key: ['company_id', 'employee_number'], period: 'effective_range', name: 'employments_number_no_overlap' } ].
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `employments.employee_id → employees [restrict/default]`, `employments.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/employments/+collection.ts`. Runtime consumer examples: `src/lib/advance-salary.ts`, `src/lib/assessment-exemption.ts`, `src/lib/benefit-cases/benefit.ts` (remaining literal references counted in the inventory).

### external_original_bank_source_corrections

- Target: **NEEDS_EVIDENCE**. Resolve input/operation split and actual actor host before selecting profile versus entity JSON. Preserve old IDs and paid references during a bounded migration; not an indefinite KEEP.
- Fields: `actual_conversion_file:file`, `reference:text`, `documented_on:date`, `known_on:date`, `currency:currency`, `cash_amount:money`, `allocations:json:opaque`, `snapshot:json:opaque`, `qualification:enum`, `original_payroll_register_file:file`, `component_allocation_file:file`.
- Identity constraints: unique [ { "fields": [ "external_original_bank_source_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `external_original_bank_source_corrections.company_id → companies [restrict/default]`, `external_original_bank_source_corrections.employee_id → employees [restrict/default]`, `external_original_bank_source_corrections.external_original_bank_source_id → external_original_bank_sources [restrict/default]`, `external_original_bank_source_corrections.supersedes_correction_id → external_original_bank_source_corrections [restrict/default]`.
- Collection: `src/data/collection/external_original_bank_source_corrections/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/external-original-bank-corrections.ts`.

### external_original_bank_sources

- Target: **NEEDS_EVIDENCE**. Resolve input/operation split and actual actor host before selecting profile versus entity JSON. Preserve old IDs and paid references during a bounded migration; not an indefinite KEEP.
- Fields: `actual_conversion_file:file`, `source_system:text`, `source_payment_id:text`, `reference:text`, `payer_reference:text`, `recipient_reference:text`, `paid_on:date`, `received_on:date`, `known_on:date`, `bank_file:file`, `original_payroll_register_file:file`, `component_allocation_file:file`, `parties_file:file`, `currency:currency`, `cash_amount:money`, `complete_original_bank_register:boolean`, `allocations:json:opaque`, `snapshot:json:opaque`, `qualification:enum`.
- Identity constraints: unique [ { "fields": [ "source_system", "source_payment_id" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `external_original_bank_sources.company_id → companies [restrict/default]`, `external_original_bank_sources.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/external_original_bank_sources/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/external-original-bank-corrections.ts`, `src/lib/external-original-bank.ts`.

### fact_evidence

- Target: **NEEDS_EVIDENCE**. Resolve input/operation split and actual actor host before selecting profile versus entity JSON. Preserve old IDs and paid references during a bounded migration; not an indefinite KEEP.
- Fields: `fact_key:text`, `attested_value:json:opaque`, `reference:text`, `file:file`, `received_on:date`, `document_type:text`, `expires_on:date`.
- Identity constraints: unique —; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `fact_evidence.subject → undefined [owned]`.
- Collection: `src/data/collection/fact_evidence/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/benefit.ts`, `src/lib/benefit-cases/certified-assessment.ts`, `src/lib/benefit-cases/reimbursement-fact-sources.ts` (remaining literal references counted in the inventory).

### historical_bank_sources

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `recipient_reference:text`, `received_on:date`, `paid_on:date`, `known_on:date`, `allocations:json:opaque`, `currency:currency`, `cash_amount:money`, `snapshot:json:opaque`, `bank_file:file`, `complete_allocation_file:file`, `recipient_identity_file:file`.
- Identity constraints: unique [ { "fields": [ "payment_event_id" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `historical_bank_sources.payment_event_id → payment_events [restrict/default]`, `historical_bank_sources.company_id → companies [restrict/default]`, `historical_bank_sources.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/historical_bank_sources/+collection.ts`. Runtime consumer examples: `src/lib/conditional-annual-source.ts`, `src/lib/conditional-original-qualification.ts`, `src/lib/every-field.ts` (remaining literal references counted in the inventory).

### historical_prior_credit_redeliveries

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `source_system:text`, `source_payment_id:text`, `payment_reference:text`, `allocation_reference:text`, `payer_reference:text`, `recipient_reference:text`, `paid_on:date`, `available_on:date`, `known_on:date`, `cash_amount:money`, `receipt_cash_total:money`, `bank_file:file`, `employee_receipt_file:file`, `parties_file:file`, `currency:currency`, `snapshot:json:opaque`.
- Identity constraints: unique [{"fields":["native_payment_allocation_id"]}, { "fields": [ "source_system", "source_payment_id", "allocation_reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `historical_prior_credit_redeliveries.native_payment_allocation_id → payment_allocations [restrict/default]`, `historical_prior_credit_redeliveries.original_cash_successor_binding_id → original_cash_successor_bindings [restrict/default]`, `historical_prior_credit_redeliveries.payer_company_id → companies [restrict/default]`, `historical_prior_credit_redeliveries.historical_prior_credit_reversal_id → historical_prior_credit_reversals [restrict/default]`, `historical_prior_credit_redeliveries.historical_bank_source_id → historical_bank_sources [restrict/default]`, `historical_prior_credit_redeliveries.payment_allocation_id → payment_allocations [restrict/default]`, `historical_prior_credit_redeliveries.company_id → companies [restrict/default]`, `historical_prior_credit_redeliveries.employee_id → employees [restrict/default]`, `historical_prior_credit_redeliveries.wage_debt_id → wage_debts [restrict/default]`.
- Collection: `src/data/collection/historical_prior_credit_redeliveries/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/historical-credit-lifecycle.ts`, `src/lib/original-credit-reservations.ts` (remaining literal references counted in the inventory).

### historical_prior_credit_reversals

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `authority_reference:text`, `issued_on:date`, `known_on:date`, `effective_on:date`, `credit_reversal_amount:money`, `authority_file:file`, `currency:currency`, `snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "historical_wage_cash_return_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `historical_prior_credit_reversals.historical_wage_cash_return_id → historical_wage_cash_returns [restrict/default]`, `historical_prior_credit_reversals.prior_wage_credit_scope_id → prior_wage_credit_scopes [restrict/default]`, `historical_prior_credit_reversals.historical_bank_source_id → historical_bank_sources [restrict/default]`, `historical_prior_credit_reversals.payment_allocation_id → payment_allocations [restrict/default]`, `historical_prior_credit_reversals.company_id → companies [restrict/default]`, `historical_prior_credit_reversals.employee_id → employees [restrict/default]`, `historical_prior_credit_reversals.wage_debt_id → wage_debts [restrict/default]`.
- Collection: `src/data/collection/historical_prior_credit_reversals/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/historical-credit-lifecycle.ts`, `src/lib/prior-wage-credit-projection.ts` (remaining literal references counted in the inventory).

### historical_wage_cash_returns

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `source_system:text`, `source_payment_id:text`, `payment_reference:text`, `allocation_reference:text`, `payer_reference:text`, `recipient_reference:text`, `paid_on:date`, `available_on:date`, `known_on:date`, `cash_amount:money`, `receipt_cash_total:money`, `bank_file:file`, `employer_receipt_file:file`, `parties_file:file`, `currency:currency`, `snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "source_system", "source_payment_id", "allocation_reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `historical_wage_cash_returns.prior_wage_credit_scope_id → prior_wage_credit_scopes [restrict/default]`, `historical_wage_cash_returns.historical_bank_source_id → historical_bank_sources [restrict/default]`, `historical_wage_cash_returns.payment_allocation_id → payment_allocations [restrict/default]`, `historical_wage_cash_returns.company_id → companies [restrict/default]`, `historical_wage_cash_returns.employee_id → employees [restrict/default]`, `historical_wage_cash_returns.wage_debt_id → wage_debts [restrict/default]`.
- Collection: `src/data/collection/historical_wage_cash_returns/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/historical-credit-lifecycle.ts`, `src/lib/paid-wage-credit-lifecycle.ts`.

### income_distribution_pools

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `catalogue_code:text`, `reference:text`, `collection_start:date`, `collection_end:date`, `collected_total:decimal`, `source_reference:text`, `allocation_reference:text`, `evidence_file:file`, `facts:custom`, `members:custom`, `worker_fraction:decimal`, `equal_fraction:decimal`, `distributable_declared_amount:decimal`, `distributable_residual_reference:text`, `employer_residual_topup:decimal`, `distributable:decimal`, `allocation_snapshot:json:opaque`.
- Identity constraints: unique [{ fields: ['company_id','reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `income_distribution_pools.company_id → companies [restrict/default]`, `income_distribution_pools.catalogue_id → adhoc_catalogue [restrict/default]`.
- Collection: `src/data/collection/income_distribution_pools/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/automation/+obligation_calendar.automation.ts`.

### income_inventory_filings

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `as_of:date`, `return_code:text`, `due_on:date`, `records:json:opaque`, `state:state`, `accepted_on:date`, `acceptance_reference:text`, `acceptance_evidence_file:file`.
- Identity constraints: unique —; noOverlap —.
- Explicit state: state.
- Relationships: `income_inventory_filings.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/income_inventory_filings/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/run/income-reporting.ts`.

### income_recipients

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `name:text`, `identity_type:text`, `identity_number:text`, `date_of_birth:date`, `sex:text`, `nationality:text`, `designation:text`, `engagement_from:date`, `engagement_to:date`, `evidence_file:file`.
- Identity constraints: unique [{ fields: ['company_id','identity_number'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `income_recipients.company_id → companies [restrict/default]`, `income_recipients.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/income_recipients/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/run/clearance-filing.ts`, `src/lib/payroll/run/income-reporting.ts` (remaining literal references counted in the inventory).

### income_reporting_registrations

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `original_year_source:json:opaque`, `basis_year_through:int`, `authority_delivery:enum`, `authority_name:text`, `authority_schema_version:text`, `authority_source:json:opaque`, `basis_year_from:int`, `registered_on:date`, `registration_reference:text`, `notice_on:date`, `evidence_file:file`.
- Identity constraints: unique [{ fields: ['company_id', 'registration_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `income_reporting_registrations.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/income_reporting_registrations/+collection.ts`. Runtime consumer examples: `src/lib/annual-authority-document.ts`, `src/lib/every-field.ts`, `src/lib/payroll/run/income-reporting.ts`.

### income_return_filings

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `recipient_sources:custom`, `recipient_source_evidence_file:file`, `reporting_transfer_ids:json:opaque`, `form_metadata_source:json:opaque`, `form_metadata:json:opaque`, `form_metadata_evidence_file:file`, `official_payloads:json:opaque`, `basis_year:int`, `submission:enum`, `delivery:text`, `correction_projection:enum`, `correction_sequence:int`, `correction_source:json:opaque`, `authority_filing:bool`, `authority_source:json:opaque`, `acceptance_source:json:opaque`, `electronic:bool`, `authorised:json:opaque`, `baseline_ids:json:opaque`, `baseline_key:text`, `appendix_records:json:opaque`, `delivery_payloads:json:opaque`, `identity_corrections:json:opaque`, `identity_evidence_file:file`, `schema_version:text`, `due_on:date`, `records:json:opaque`, `state:state`, `submitted_on:date`, `accepted_on:date`, `acceptance_reference:text`, `acceptance_evidence_file:file`, `issued_on:date`, `employee_notice_reference:text`, `employee_notice_evidence_file:file`, `retain_through_on:date`.
- Identity constraints: unique [{ fields: ['company_id', 'basis_year', 'baseline_key'], where: { state: { in: ['ACCEPTED', 'ISSUED'] } } }]; noOverlap —.
- Explicit state: state.
- Relationships: `income_return_filings.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/income_return_filings/+collection.ts`. Runtime consumer examples: `src/lib/annual-authority-document.ts`, `src/lib/annual-form-metadata.ts`, `src/lib/annual-tax-settlement.ts` (remaining literal references counted in the inventory).

### insurance_policy_dispositions

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `repayment_snapshot:json:opaque`, `bank_currency:currency`, `bank_cash_amount:money`, `opening_voucher_bindings:custom`, `voucher_snapshot:json:opaque`, `opening_voucher_snapshots:json:opaque`, `reference:text`, `settings_code:text`, `action:enum`, `currency:currency`, `event_on:date`, `cash_payer:text`, `cash_recipient:text`, `cash_channel:text`, `source_key:text`, `fee_key:text`, `bank_key:text`, `tax_key:text`, `root_key:text`, `tax_payer:text`, `tax_recipient:text`, `tax_channel:text`, `tax_paid_on:date`, `principal:money`, `taxable_basis:money`, `exempt_basis:money`, `gross:money`, `tax_withheld:money`, `other_deductions:money`, `net:money`, `tax_remitted:money`, `tax_refunded:money`, `source_pin:json:opaque`, `opening_pins:json:opaque`, `opening_source_snapshots:json:opaque`, `source_snapshot:json:opaque`, `evidence_snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "history_id" ] }, { "fields": [ "source_key" ] }, { "fields": [ "bank_key" ] }, { "fields": [ "tax_key" ] }, { "fields": [ "root_key" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `insurance_policy_dispositions.bank_voucher_id → insurance_policy_vouchers [restrict/default]`, `insurance_policy_dispositions.tax_voucher_id → insurance_policy_vouchers [restrict/default]`, `insurance_policy_dispositions.employee_id → employees [restrict/default]`, `insurance_policy_dispositions.history_id → employment_history [restrict/default]`, `insurance_policy_dispositions.original_id → insurance_policy_dispositions [restrict/default]`.
- Collection: `src/data/collection/insurance_policy_dispositions/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/insurance-policy-source.ts`.

### insurance_policy_restatement_registers

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `authority:text`, `decision_namespace:text`, `decision_reference:text`, `approval_reference:text`, `approved_on:date`, `component_count:int`, `components:custom`, `totals:custom`, `original_totals:custom`, `principal_disposition:text`, `signed_file:file`, `register_file:file`, `decision_key:text`, `decision_reference_key:text`, `signed_document_key:text`, `component_snapshots:json:opaque`, `file_snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "decision_key" ] }, { "fields": [ "signed_document_key" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: none declared.
- Collection: `src/data/collection/insurance_policy_restatement_registers/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/insurance-policy-restatement-registers.ts`.

### insurance_policy_restatements

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `component_key:text`, `register_snapshot:json:opaque`, `reference:text`, `settings_code:text`, `signed_file:file`, `authority:text`, `approval_reference:text`, `signature_reference:text`, `source_key:text`, `predecessor_key:text`, `original_history_id:text`, `previous_history_id:text`, `authority_role:enum`, `cash_disposition:enum`, `source_position:enum`, `currency:currency`, `sequence:int`, `approved_on:date`, `knowledge_on:date`, `effect_on:date`, `principal:money`, `taxable_basis:money`, `exempt_basis:money`, `source_snapshot:json:opaque`, `evidence_snapshot:json:opaque`, `original_snapshot:json:opaque`, `prior_snapshot:json:opaque`, `file_snapshot:json:opaque`.
- Identity constraints: unique [ {"fields":["component_key"]}, { "fields": [ "history_id" ] }, { "fields": [ "source_key" ] }, { "fields": [ "predecessor_key" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `insurance_policy_restatements.employee_id → employees [restrict/default]`, `insurance_policy_restatements.history_id → employment_history [restrict/default]`, `insurance_policy_restatements.decision_register_id → insurance_policy_restatement_registers [restrict/default]`, `insurance_policy_restatements.original_id → insurance_policy_dispositions [restrict/default]`, `insurance_policy_restatements.previous_id → insurance_policy_restatements [restrict/default]`.
- Collection: `src/data/collection/insurance_policy_restatements/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/insurance-policy-restatement-registers.ts`, `src/lib/insurance-policy-restatements.ts`.

### insurance_policy_vouchers

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `namespace:text`, `voucher_reference:text`, `payer_identity:text`, `authority_reference:text`, `role:enum`, `paid_on:date`, `currency:currency`, `whole_amount:money`, `component_count:int`, `components:custom`, `source_file:file`, `register_file:file`, `voucher_key:text`, `component_snapshots:json:opaque`, `file_snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "voucher_key" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: none declared.
- Collection: `src/data/collection/insurance_policy_vouchers/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/insurance-policy-vouchers.ts`.

### jurisdiction_holidays

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `substitutes_weekly_rest:bool`, `statutory_qualification:json:opaque`, `statutory_qualification_file:file`, `date:date`, `name:text`, `statutory_role:text`, `statutory_role_reference:text`, `kind:enum`, `replaces:date`, `given_to:enum`, `worksite:text`, `religion:text`, `applies_when:text`, `source:text`, `announced_on:date`, `announcement_reference:text`, `published_at:instant`.
- Identity constraints: unique [{ fields: ['company_id', 'date', 'worksite'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `jurisdiction_holidays.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/jurisdiction_holidays/+collection.ts`. Runtime consumer examples: `src/lib/coded-fields.ts`, `src/lib/datatypes/holiday_snapshots.ts`, `src/lib/datatypes/wages.ts` (remaining literal references counted in the inventory).

### jurisdiction_settings

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `code:text`, `jurisdiction_code:text`, `name:text`, `sealed_at:instant`, `voided_at:instant`, `void_reason:text`, `payroll:custom`, `sources:custom`, `statutory_calendar:custom`, `work_rules:custom`, `facts:custom`, `exit_facts:custom`, `terms_facts:custom`, `work_day_facts:custom`, `payment_facts:custom`, `settlement_facts:custom`, `worksite_facts:custom`, `person_facts:custom`, `history_kinds:custom`, `tables:custom`, `overlays:custom`, `obligations:custom`, `duty_types:custom`, `checks:custom`, `returns:custom`, `change_summary:text`, `effective_range:period`.
- Identity constraints: unique —; noOverlap [ { key: ['code'], period: 'effective_range', where: { sealed_at: { isNull: false }, voided_at: { isNull: true } }, name: 'jurisdiction_settings_sealed_no_overlap' } ].
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `jurisdiction_settings.cloned_from_id → jurisdiction_settings [restrict/default]`.
- Collection: `src/data/collection/jurisdiction_settings/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/benefit.ts`, `src/lib/benefit-cases/payroll-guard.ts`, `src/lib/catalogue-offer.ts` (remaining literal references counted in the inventory).

### leave_catalogue

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `code:text`, `preceding_leave_code:text`, `preceding_leave_same_event:list`, `preceding_leave_contiguous:bool`, `name:text`, `authority:text`, `eligibility:text`, `evidence:enum`, `is_npl:bool`, `requires_no_pay_origin:bool`, `pay_fraction:text`, `episode_start:text`, `time_off_amount:text`, `payment_component_when:text`, `payment_release_when:text`, `payment_instruction_facts:custom`, `payment_release_facts:custom`, `payment_suspend_when:text`, `payment_component_amount:text`, `payment_component_monthly_when:text`, `payment_deduction_reference:text`, `payment_deduction_policy:enum`, `time_off_rate_required_when:text`, `time_off_rate_basis:enum`, `time_off_basis_when:text`, `time_off_retained_basis:enum`, `time_off_unit:enum`, `paid_by:enum`, `consumes_code:text`, `unit:enum`, `can_encash:bool`, `encash_on_exit:bool`, `evidence_after_days:int`, `entitlement:custom`, `event_facts:custom`, `schedule:custom`.
- Identity constraints: unique [{ fields: ['settings_id', 'code'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `leave_catalogue.settings_id → jurisdiction_settings [owned]`.
- Collection: `src/data/collection/leave_catalogue/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/certified-assessment.ts`, `src/lib/catalogue-offer.ts`, `src/lib/catalogue-source-scope.ts` (remaining literal references counted in the inventory).

### leave_contact_records

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `topic:enum`, `occurred_on:date`, `recipient:text`, `channel:text`, `summary:text`, `reference:text`, `evidence_file:file`, `training_reference:text`, `training_on:date`, `job_related:boolean`.
- Identity constraints: unique [{ fields: ['leave_entry_id', 'reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `leave_contact_records.leave_entry_id → leave_entries [restrict/default]`.
- Collection: `src/data/collection/leave_contact_records/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### leave_entries

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `transferred_opening:custom`, `activity:enum`, `leave_code:text`, `reference:text`, `return_on:date`, `return_agreed_on:date`, `return_application_key:text`, `return_application_reference:text`, `original_statutory_source_file:file`, `original_statutory_source_reference:text`, `original_statutory_source_received_on:date`, `certificate_file:file`, `charges:custom`, `allocations:custom`, `entitlement_admitted_on:date`, `original_event_entitlement:json:shaped`, `as_adjustment_entry:bool`, `from_date:date`, `to_date:date`, `half_day_start:bool`, `half_day_end:bool`, `no_pay_origin:enum`, `days:decimal`, `hour_position:enum`, `hours:decimal`, `encash_days:decimal`, `encash_hours:decimal`, `effective_on:date`, `due_on:date`, `destination_from:date`, `destination_to:date`, `available_from:date`, `expires_on:date`, `reason:text`, `facts:custom`, `cash_waiver_sources:custom`, `summary:text`.
- Identity constraints: unique [{ fields: ['employment_id', 'reference'] }, { fields: ['reversal_of_id'] }, { fields: ['opening_source_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `leave_entries.preceding_leave_id → leave_entries [restrict/default]`, `leave_entries.opening_source_id → leave_transfer_opening_sources [restrict/default]`, `leave_entries.source_history_id → employment_history [restrict/default]`, `leave_entries.employment_id → employments [restrict/default]`, `leave_entries.catalogue_id → leave_catalogue [restrict/default]`, `leave_entries.reversal_of_id → leave_entries [restrict/default]`, `leave_entries.return_change_of_id → leave_entries [restrict/default]`, `leave_entries.return_previous_change_id → leave_entries [restrict/default]`, `leave_entries.episode_id → leave_entries [restrict/default]`, `leave_entries.payslip_id → payslips [restrict/default]`.
- Collection: `src/data/collection/leave_entries/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/benefit.ts`, `src/lib/benefit-cases/payroll-guard.ts`, `src/lib/benefit-cases/reimbursement-entitlement-sources.ts` (remaining literal references counted in the inventory).

### leave_transfer_opening_sources

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `right_kind:enum`, `leave_code:text`, `reference:text`, `known_on:date`, `posting_on:date`, `original_from:date`, `original_through:date`, `target_from:date`, `target_through:date`, `available_from:date`, `expires_on:date`, `unit:enum`, `original_grant:decimal`, `original_used:decimal`, `original_reserved:decimal`, `original_carried_in:decimal`, `original_corrections:decimal`, `usage_disposition:enum`, `imported_usage_entry_ids:text`, `predecessor_disposition:enum`, `ledger_file:file`.
- Identity constraints: unique [{fields:['predecessor_employment_id','leave_code','original_from','original_through']},{fields:['source_history_id','reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `leave_transfer_opening_sources.source_history_id → employment_history [restrict/default]`, `leave_transfer_opening_sources.predecessor_employment_id → employments [restrict/default]`, `leave_transfer_opening_sources.successor_employment_id → employments [restrict/default]`, `leave_transfer_opening_sources.catalogue_id → leave_catalogue [restrict/default]`.
- Collection: `src/data/collection/leave_transfer_opening_sources/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/leave/transferred-opening-admission.ts`.

### loan_catalogue

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `advance_source_required:bool`, `code:text`, `name:text`, `destination:enum`, `direction:enum`, `bands:custom`, `loan_type:enum`, `minimum_repayment:decimal`, `approval_reference_required:bool`, `order_facts:custom`, `order_recovery_rule:text`, `order_payment_when:text`, `order_authority:text`, `eligibility:text`, `evidence:enum`.
- Identity constraints: unique [{ fields: ['settings_id', 'code'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `loan_catalogue.settings_id → jurisdiction_settings [owned]`.
- Collection: `src/data/collection/loan_catalogue/+collection.ts`. Runtime consumer examples: `src/lib/advance-salary.ts`, `src/lib/catalogue-offer.ts`, `src/lib/catalogue-source-scope.ts` (remaining literal references counted in the inventory).

### loan_repayments

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `due_date:date`, `amount_due:decimal`, `sequence:int`, `as_adjustment_entry:bool`.
- Identity constraints: unique [{ fields: ['loan_id', 'sequence'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `loan_repayments.loan_id → loans [owned]`, `loan_repayments.employment_id → employments [restrict/default]`, `loan_repayments.payslip_id → payslips [restrict/default]`.
- Collection: `src/data/collection/loan_repayments/+collection.ts`. Runtime consumer examples: `src/lib/employment-contract.ts`, `src/lib/every-field.ts`, `src/lib/loan-schedule.ts` (remaining literal references counted in the inventory).

### loans

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `advance_source:json:opaque`, `advance_source_file:file`, `advance_wage_basis_file:file`, `advance_permission_file:file`, `advance_fee_terms_file:file`, `recovery_cost_class:text`, `recovery_cost_reference:text`, `principal:decimal`, `effective_range:period`, `effective_from:date`, `reference:text`, `approval_reference:text`, `disbursed_on:date`, `creditor:enum`, `authority:text`, `recovery_rule:text`, `order_facts:custom`, `priority:int`, `on_exit:enum`.
- Identity constraints: unique —; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `loans.employment_id → employments [restrict/default]`, `loans.loan_catalogue_id → loan_catalogue [restrict/default]`.
- Collection: `src/data/collection/loans/+collection.ts`. Runtime consumer examples: `src/lib/advance-salary.ts`, `src/lib/catalogue_rules.ts`, `src/lib/datatypes/payroll_settings.ts` (remaining literal references counted in the inventory).

### medical_copayment_movements

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `provider_reference:text`, `bill_reference:text`, `kind:enum`, `amount:money`, `currency:currency`, `paid_on:date`, `reference:text`, `evidence_file:file`, `allocation_file:file`.
- Identity constraints: unique [{ fields: ['company_id', 'employee_id', 'reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `medical_copayment_movements.payable_tranche_id → payable_tranches [restrict/default]`, `medical_copayment_movements.deduction_authorization_id → deduction_authorizations [restrict/default]`, `medical_copayment_movements.adhoc_request_id → adhoc_requests [restrict/default]`, `medical_copayment_movements.payslip_id → payslips [restrict/default]`, `medical_copayment_movements.payment_event_id → payment_events [owned]`, `medical_copayment_movements.payment_allocation_id → payment_allocations [restrict/default]`, `medical_copayment_movements.reverses_movement_id → medical_copayment_movements [restrict/default]`.
- Collection: `src/data/collection/medical_copayment_movements/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/medical-copayment-payment.ts`.

### medical_copayment_return_instructions

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `amount:money`, `currency:currency`, `due_on:date`, `reference:text`, `original_instruction_file:file`, `provider_reference:text`, `bill_reference:text`.
- Identity constraints: unique [{ fields: ['company_id', 'employee_id', 'reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `medical_copayment_return_instructions.company_id → companies [restrict/default]`, `medical_copayment_return_instructions.employee_id → employees [restrict/default]`, `medical_copayment_return_instructions.employment_id → employments [restrict/default]`, `medical_copayment_return_instructions.payslip_id → payslips [restrict/default]`, `medical_copayment_return_instructions.recovery_movement_id → medical_copayment_movements [restrict/default]`.
- Collection: `src/data/collection/medical_copayment_return_instructions/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/medical-copayment-payment.ts`.

### noncontract_settlements

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `currency:currency`, `agreed_gross:money`, `agreed_due_on:date`, `tax_residency:enum`, `tax_residency_range:period`, `facts:custom`.
- Identity constraints: unique [{ fields: ['company_id', 'reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `noncontract_settlements.company_id → companies [restrict/default]`, `noncontract_settlements.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/noncontract_settlements/+collection.ts`. Runtime consumer examples: `src/lib/datatypes/payroll_settings.ts`, `src/lib/every-field.ts`, `src/lib/payroll/payment-withholding.ts`.

### notice_compensation_cases

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `contract_entered_on:date`, `contract_entry_reference:text`, `contract_entry_file:file`, `enforcement_condition_satisfied:bool`, `enforcement_condition_reference:text`, `enforcement_condition_file:file`, `status:enum`, `cancelled_on:date`, `cancellation_reference:text`, `cancellation_evidence_file:file`, `reference:text`, `decision_on:date`, `prior_notice_given:bool`, `notice_extensions:json:opaque`, `payer:enum`, `decision_evidence_file:file`, `waived_dates:json:opaque`, `waiver_reference:text`, `waiver_evidence_file:file`, `counterfactual_rate_changes:json:opaque`, `currency_conversions:json:opaque`, `leave_offset:json:opaque`, `workday_average_evidence_file:file`, `workday_average:json:opaque`, `calendar:json:opaque`, `allowance_classifications:json:opaque`, `allowance_rates:json:opaque`, `recovery_authorised_amount:decimal`, `recovery:enum`, `recovery_reference:text`, `recovery_evidence_file:file`, `contrary_order:bool`, `contrary_order_reference:text`, `contrary_order_evidence_file:file`, `currency:currency`, `amount:money`, `payment_class:text`, `snapshot:json:opaque`.
- Identity constraints: unique [{fields:['employment_id'],where:{status:{eq:'ACTIVE'}}},{fields:['leave_offset_entry_id'],where:{status:{eq:'ACTIVE'}}}]; noOverlap —.
- Explicit state: status.
- Relationships: `notice_compensation_cases.leave_offset_entry_id → leave_entries [restrict/default]`, `notice_compensation_cases.employment_id → employments [restrict/default]`, `notice_compensation_cases.company_id → companies [restrict/default]`, `notice_compensation_cases.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/notice_compensation_cases/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/run/clearance-filing.ts`.

### notice_compensation_receipts

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `paid_on:date`, `amount:decimal`, `currency:currency`, `evidence_file:file`.
- Identity constraints: unique [{fields:['case_id','reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `notice_compensation_receipts.case_id → notice_compensation_cases [restrict/default]`, `notice_compensation_receipts.employment_id → employments [restrict/default]`, `notice_compensation_receipts.company_id → companies [restrict/default]`, `notice_compensation_receipts.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/notice_compensation_receipts/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### obligation_instances

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `duty_code:text`, `authority:text`, `subject_kind:enum`, `subject_id:text`, `source_obligation_id:id`, `original_occurrence_key:text`, `recipient_id:id`, `trigger_ref:text`, `triggered_on:date`, `due_on:date`, `amount_due:decimal`, `amount_settled:decimal`, `state:enum`, `fulfilled_on:date`, `waive_reason:text`, `reference:text`, `evidence_file:file`, `facts:custom`, `retain_until:date`.
- Identity constraints: unique [{ fields: ['duty_code', 'subject_kind', 'subject_id', 'trigger_ref'] }, { fields: ['duty_code', 'original_occurrence_key'], where: { original_occurrence_key: { isNull: false } } }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `obligation_instances.company_id → companies [owned]`, `obligation_instances.source_obligation_id → obligation_instances [restrict/default]`, `obligation_instances.recipient_id → income_recipients [restrict/default]`, `obligation_instances.settings_id → jurisdiction_settings [restrict/default]`.
- Collection: `src/data/collection/obligation_instances/+collection.ts`. Runtime consumer examples: `src/lib/checks.ts`, `src/lib/every-field.ts`, `src/lib/payroll/run/precheck.ts` (remaining literal references counted in the inventory).

### original_cash_successor_bindings

- Target: **NEEDS_EVIDENCE**. Resolve input/operation split and actual actor host before selecting profile versus entity JSON. Preserve old IDs and paid references during a bounded migration; not an indefinite KEEP.
- Fields: `paid_on:date`, `known_on:date`, `reference:text`, `payer_reference:text`, `recipient_reference:text`, `payer_evidence_file:file`, `currency:currency`, `original_cash_face:money`, `snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "historical_prior_credit_reversal_id", "successor_employment_id", "paid_on", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `original_cash_successor_bindings.historical_prior_credit_reversal_id → historical_prior_credit_reversals [restrict/default]`, `original_cash_successor_bindings.successor_employment_id → employments [restrict/default]`, `original_cash_successor_bindings.original_employment_id → employments [restrict/default]`, `original_cash_successor_bindings.original_company_id → companies [restrict/default]`, `original_cash_successor_bindings.payer_company_id → companies [restrict/default]`, `original_cash_successor_bindings.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/original_cash_successor_bindings/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/successor-cash-financial.ts`, `src/lib/successor-original-cash-payment.ts` (remaining literal references counted in the inventory).

### original_component_partitions

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `evidence_file:file`, `components:json:opaque`, `currency:currency`, `snapshot:json:opaque`.
- Identity constraints: unique [{ fields: ['payslip_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `original_component_partitions.company_id → companies [restrict/default]`, `original_component_partitions.employee_id → employees [restrict/default]`, `original_component_partitions.employment_id → employments [restrict/default]`, `original_component_partitions.payslip_id → payslips [restrict/default]`.
- Collection: `src/data/collection/original_component_partitions/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/original-component-partition.ts`.

### original_financial_component_sources

- Target: **NEEDS_EVIDENCE**. Resolve input/operation split and actual actor host before selecting profile versus entity JSON. Preserve old IDs and paid references during a bounded migration; not an indefinite KEEP.
- Fields: `reference:text`, `documented_on:date`, `allocation_file:file`, `complete_final_coordinates:boolean`, `items:json:opaque`, `currency:currency`, `known_on:date`, `qualification:enum`, `snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "historical_bank_source_id", "payment_allocation_id" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `original_financial_component_sources.company_id → companies [restrict/default]`, `original_financial_component_sources.employee_id → employees [restrict/default]`, `original_financial_component_sources.employment_id → employments [restrict/default]`, `original_financial_component_sources.original_payslip_id → payslips [restrict/default]`, `original_financial_component_sources.historical_bank_source_id → historical_bank_sources [restrict/default]`, `original_financial_component_sources.payment_allocation_id → payment_allocations [restrict/default]`, `original_financial_component_sources.contribution_id → statutory_contributions [restrict/default]`, `original_financial_component_sources.statutory_remittance_id → statutory_remittances [restrict/default]`.
- Collection: `src/data/collection/original_financial_component_sources/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/historical-component-cash.ts`, `src/lib/original-financial-components.ts` (remaining literal references counted in the inventory).

### original_wage_cash_corrections

- Target: **NEEDS_EVIDENCE**. Resolve input/operation split and actual actor host before selecting profile versus entity JSON. Preserve old IDs and paid references during a bounded migration; not an indefinite KEEP.
- Fields: `reference:text`, `issued_on:date`, `known_on:date`, `effective_on:date`, `allocations:json:opaque`, `currency:currency`, `snapshot:json:opaque`, `correction_file:file`, `bank_allocation_file:file`.
- Identity constraints: unique [ { "fields": [ "supersedes_correction_id" ] }, { "fields": [ "original_wage_cash_receipt_id" ], "where": { "supersedes_correction_id": { "isNull": true } } } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `original_wage_cash_corrections.original_wage_cash_receipt_id → original_wage_cash_receipts [restrict/default]`, `original_wage_cash_corrections.supersedes_correction_id → original_wage_cash_corrections [restrict/default]`, `original_wage_cash_corrections.company_id → companies [restrict/default]`, `original_wage_cash_corrections.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/original_wage_cash_corrections/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/original-wage-corrections.ts`.

### original_wage_cash_receipts

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `component_code:text`, `item_source_reference:text`, `source_system:text`, `source_payment_id:text`, `payment_reference:text`, `allocation_reference:text`, `item_source_id:text`, `paid_on:date`, `currency:currency`, `cash_amount:money`, `receipt_cash_total:money`, `snapshot:json:opaque`, `bank_receipt_file:file`, `item_allocation_file:file`, `cash_basis:enum`, `advance_basis_file:file`.
- Identity constraints: unique [ { "fields": [ "source_system", "source_payment_id", "wage_assessment_declaration_id", "item_source_reference", "component_code" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `original_wage_cash_receipts.wage_assessment_declaration_id → wage_assessment_declarations [restrict/default]`, `original_wage_cash_receipts.company_id → companies [restrict/default]`, `original_wage_cash_receipts.employee_id → employees [restrict/default]`, `original_wage_cash_receipts.employment_id → employments [restrict/default]`, `original_wage_cash_receipts.payment_event_id → payment_events [restrict/default]`.
- Collection: `src/data/collection/original_wage_cash_receipts/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/original-wage-cash.ts`, `src/lib/original-wage-corrections.ts`.

### original_wage_cash_returns

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `source_system:text`, `source_payment_id:text`, `allocation_reference:text`, `payment_reference:text`, `payer_reference:text`, `recipient_reference:text`, `paid_on:date`, `received_on:date`, `known_on:date`, `currency:currency`, `cash_amount:money`, `receipt_cash_total:money`, `snapshot:json:opaque`, `bank_file:file`, `employer_receipt_file:file`, `parties_file:file`.
- Identity constraints: unique [ { "fields": [ "source_system", "source_payment_id", "allocation_reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `original_wage_cash_returns.original_wage_cash_receipt_id → original_wage_cash_receipts [restrict/default]`, `original_wage_cash_returns.company_id → companies [restrict/default]`, `original_wage_cash_returns.employee_id → employees [restrict/default]`, `original_wage_cash_returns.employment_id → employments [restrict/default]`.
- Collection: `src/data/collection/original_wage_cash_returns/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/original-wage-corrections.ts`.

### original_wage_cash_scopes

- Target: **NEEDS_EVIDENCE**. Resolve input/operation split and actual actor host before selecting profile versus entity JSON. Preserve old IDs and paid references during a bounded migration; not an indefinite KEEP.
- Fields: `source_reference:text`, `covered_through_on:date`, `known_on:date`, `receipt_ids:json:opaque`, `snapshot:json:opaque`, `complete_bank_scope_file:file`.
- Identity constraints: unique [ { "fields": [ "wage_assessment_declaration_id" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `original_wage_cash_scopes.wage_assessment_declaration_id → wage_assessment_declarations [restrict/default]`, `original_wage_cash_scopes.company_id → companies [restrict/default]`, `original_wage_cash_scopes.employee_id → employees [restrict/default]`, `original_wage_cash_scopes.employment_id → employments [restrict/default]`.
- Collection: `src/data/collection/original_wage_cash_scopes/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/original-wage-cash.ts`.

### payable_tranches

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `source_category:enum`, `original_component_tax_amount:money`, `original_component_scheme_binding:text`, `original_component_tax_reference:text`, `original_component_tax_file:file`, `source_kind:text`, `source_id:text`, `source_component:text`, `reference:text`, `component_payment_basis:custom`, `due_on:date`, `currency:currency`, `gross_amount:money`, `non_event_deduction_amount:money`, `tax_treatment:enum`.
- Identity constraints: unique [{ fields: ['source_kind', 'source_id', 'reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `payable_tranches.settlement → undefined [owned]`.
- Collection: `src/data/collection/payable_tranches/+collection.ts`. Runtime consumer examples: `src/lib/award-cash-channel.ts`, `src/lib/benefit-cases/certified-assessment.ts`, `src/lib/benefit-cases/refund-sources.ts` (remaining literal references counted in the inventory).

### payment_allocations

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `currency:currency`, `gross_amount:money`, `component_funded_tax_withheld_amount:money`, `component_tax_withheld_amount:money`, `component_net_amount:money`, `component_withholding_reference:text`, `component_withholding_file:file`, `component_scheme_binding:text`, `non_event_deduction_amount:money`.
- Identity constraints: unique [{ fields: ['payment_event_id', 'payable_tranche_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `payment_allocations.payment_event_id → payment_events [owned]`, `payment_allocations.payable_tranche_id → payable_tranches [restrict/default]`.
- Collection: `src/data/collection/payment_allocations/+collection.ts`. Runtime consumer examples: `src/lib/award-cash-channel.ts`, `src/lib/benefit-cases/certified-assessment.ts`, `src/lib/benefit-cases/refund-sources.ts` (remaining literal references counted in the inventory).

### payment_events

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `payment_method:enum`, `payment_account_reference:text`, `payment_method_source:json:opaque`, `payment_method_source_file:file`, `payment_method_assessment:json:opaque`, `medical_copayment_allocations:json:opaque`, `kind:enum`, `paid_on:date`, `statutory_payment_authorities:custom`, `recipient_kind:enum`, `recipient_reference:text`, `reference:text`, `non_cash_basis_reference:text`, `external_source_kind:text`, `external_source_id:text`, `currency:currency`, `gross_amount:money`, `non_event_deduction_amount:money`, `cash_amount:money`, `statutory:custom`, `facts:custom`.
- Identity constraints: unique [ { fields: ['company_id', 'employee_id', 'paid_on', 'reference'] }, { fields: ['external_source_kind', 'external_source_id'], where: { external_source_kind: { isNull: false }, external_source_id: { isNull: false } } } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `payment_events.company_id → companies [restrict/default]`, `payment_events.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/payment_events/+collection.ts`. Runtime consumer examples: `src/lib/award-cash-channel.ts`, `src/lib/benefit-cases/certified-assessment.ts`, `src/lib/benefit-cases/refund-sources.ts` (remaining literal references counted in the inventory).

### payment_holds

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `clearance_trigger:text`, `clearance_trigger_on:date`, `category:enum`, `directive_reference:text`, `amount:decimal`, `no_withholding_reason:text`, `held_on:date`, `released_on:date`, `released_amount:decimal`, `release_basis:enum`, `authority_notice_received_on:date`, `release_directive_on:date`, `amended_notice_filed_on:date`, `directive_tax_amount:decimal`, `tax_remittance_due_on:date`, `tax_remitted_amount:decimal`, `tax_remitted_on:date`, `tax_remittance_reference:text`, `tax_remittance_evidence_file:file`, `reconciliation_reference:text`, `evidence_file:file`.
- Identity constraints: unique —; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `payment_holds.employment_id → employments [owned]`.
- Collection: `src/data/collection/payment_holds/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/leave/exit-settlement.ts`, `src/lib/payroll/run/income-return.ts` (remaining literal references counted in the inventory).

### payroll_runs

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `period:text`, `kind:enum`, `sequence:int`, `sources:json:shaped`, `configuration_hash:text`, `holidays:custom`, `calculation_version:text`, `pay_date:date`, `pay_due_date:date`, `attendance_from:date`, `attendance_to:date`, `calculation_trace:custom`, `company_charges:custom`, `company_remittances:custom`, `warnings:text`.
- Identity constraints: unique [{ fields: ['company_id', 'period', 'sequence'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `payroll_runs.company_id → companies [restrict/default]`, `payroll_runs.settings_id → jurisdiction_settings [restrict/default]`, `payroll_runs.early_for_id → payroll_runs [restrict/default]`.
- Collection: `src/data/collection/payroll_runs/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/benefit.ts`, `src/lib/benefit-cases/paid-salary-overlap.ts`, `src/lib/conditional-refund-cash-source.ts` (remaining literal references counted in the inventory).

### payslip_explanations

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `lines:json:shaped`.
- Identity constraints: unique [{ fields: ['payslip_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `payslip_explanations.payslip_id → payslips [owned]`.
- Collection: `src/data/collection/payslip_explanations/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/run/rerun.ts`, `src/lib/trace/LineExplanation.svelte`.

### payslip_journey_sources

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `statutory_week_summary:json:opaque`, `work_on:date`, `original_reference:text`, `original_work_source_ids:list`, `source_file_sha256:text`, `original_worked_hours:decimal`, `original_normal_worked_hours:decimal`, `actual_worked_hours:decimal`, `normal_worked_hours:decimal`, `basic_paid:decimal`, `overtime_paid:decimal`, `valuation_reference:text`.
- Identity constraints: unique [{fields:['journey_source_id','work_on']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `payslip_journey_sources.payslip_id → payslips [restrict/default]`, `payslip_journey_sources.journey_source_id → wage_journey_sources [restrict/default]`.
- Collection: `src/data/collection/payslip_journey_sources/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/run/gather.ts`, `src/lib/payroll/run/graph.ts` (remaining literal references counted in the inventory).

### payslip_service_periods

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: {}.
- Identity constraints: unique [{ fields: ['payslip_id', 'employment_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `payslip_service_periods.payslip_id → payslips [owned]`, `payslip_service_periods.employment_id → employments [restrict/default]`, `payslip_service_periods.history_id → employment_history [restrict/default]`.
- Collection: `src/data/collection/payslip_service_periods/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/run/graph.ts`.

### payslip_statutory_scope_sources

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: {}.
- Identity constraints: unique [{ fields: ['payslip_id', 'source'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `payslip_statutory_scope_sources.payslip_id → payslips [owned]`, `payslip_statutory_scope_sources.source → undefined [restrict/default]`.
- Collection: `src/data/collection/payslip_statutory_scope_sources/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/run/graph.ts`.

### payslip_wage_periods

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: {}.
- Identity constraints: unique [{ fields: ['payslip_id', 'wage_period_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `payslip_wage_periods.payslip_id → payslips [owned]`, `payslip_wage_periods.wage_period_id → employment_wage_periods [restrict/default]`.
- Collection: `src/data/collection/payslip_wage_periods/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/run/graph.ts`, `src/lib/payroll/run/rerun.ts`.

### payslip_work_compliance_sources

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: {}.
- Identity constraints: unique [{ fields: ['payslip_id', 'work_day_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `payslip_work_compliance_sources.payslip_id → payslips [owned]`, `payslip_work_compliance_sources.work_day_id → work_days [restrict/default]`.
- Collection: `src/data/collection/payslip_work_compliance_sources/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/run/graph.ts`.

### payslips

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `payment_method:enum`, `payment_account_reference:text`, `payment_method_source:json:opaque`, `payment_method_source_file:file`, `payment_method_assessment:json:opaque`, `original_final_source:json:opaque`, `original_assessment_contexts:json:opaque`, `terms_through:date`, `salary_from:date`, `salary_to:date`, `service_basis:custom`, `leave_settlements:custom`, `statutory_absence_settlements:custom`, `guaranteed_pay_basis:custom`, `replacement_discharge_source_ids:json:shaped`, `replacement_time:custom`, `period_wage_ledger:custom`, `base:custom`, `proration:custom`, `statutory:custom`, `adjustments:custom`, `payment_mode:enum`, `status:state`, `paid_at:instant`, `order_receipt_on:date`, `order_receipt_timezone:text`, `currency:currency`, `gross:money`, `total_deductions:money`, `net:money`, `unfunded_contributions:money`, `funding_received:money`, `funding_received_on:date`, `funding_reference:text`, `employer_cost:money`.
- Identity constraints: unique [{ fields: ['payroll_run_id', 'employment_id'] }]; noOverlap —.
- Explicit state: status.
- Relationships: `payslips.original_component_partition_id → original_component_partitions [restrict/default]`, `payslips.payroll_run_id → payroll_runs [owned]`, `payslips.employment_id → employments [restrict/default]`, `payslips.settled_by_payment_event_id → payment_events [restrict/default]`.
- Collection: `src/data/collection/payslips/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/benefit.ts`, `src/lib/benefit-cases/certified-assessment.ts`, `src/lib/benefit-cases/paid-salary-overlap.ts` (remaining literal references counted in the inventory).

### period_work_assessments

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `recorded_on:date`, `work_on:date`, `source_known_on:date`, `source_reference:text`, `source_file:file`, `source_timezone:text`, `local_day_start:instant`, `local_day_end:instant`, `actual_worked_hours:decimal`, `normal_worked_hours:decimal`, `normal_basis_reference:text`, `normal_basis_file:file`, `complete_local_day:bool`, `expected_clock_source_count:int`, `source_kind:enum`, `correction_reference:text`, `correction_file:file`.
- Identity constraints: unique [{ fields: ['employment_id', 'source_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `period_work_assessments.employment_id → employments [restrict/default]`, `period_work_assessments.employee_id → employees [restrict/default]`, `period_work_assessments.company_id → companies [restrict/default]`, `period_work_assessments.supersedes_id → period_work_assessments [restrict/default]`.
- Collection: `src/data/collection/period_work_assessments/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/journey-payroll.ts`, `src/lib/payroll/journey-work-week.ts` (remaining literal references counted in the inventory).

### period_work_clock_sources

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `recorded_on:date`, `position:int`, `source_reference:text`, `source_file:file`, `original_work_date:date`, `original_recorded:bool`, `original_work_intervals:json:shaped`, `actual_intervals:json:shaped`, `normal_intervals:json:shaped`.
- Identity constraints: unique [{ fields: ['assessment_id', 'position'] }, { fields: ['assessment_id', 'work_day_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `period_work_clock_sources.assessment_id → period_work_assessments [restrict/default]`, `period_work_clock_sources.work_day_id → work_days [restrict/default]`.
- Collection: `src/data/collection/period_work_clock_sources/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/journey-payroll.ts`, `src/lib/payroll/journey-work-week.ts` (remaining literal references counted in the inventory).

### person_facts

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `calendar_source:json:opaque`, `calendar_source_file:file`, `facts:custom`, `effective_range:period`, `source:enum`, `summary:text`.
- Identity constraints: unique —; noOverlap [ { key: ['employee_id', 'employment_id'], period: 'effective_range', name: 'person_facts_no_overlap' } ].
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `person_facts.employee_id → employees [owned]`, `person_facts.employment_id → employments [restrict/default]`.
- Collection: `src/data/collection/person_facts/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/expressions/compile.ts`, `src/lib/expressions/contexts.ts` (remaining literal references counted in the inventory).

### platform_benefits

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `source_reference:text`, `currency:currency`, `earned_from:date`, `earned_through:date`, `amount:money`, `payable_on:date`, `purpose_reference:text`, `payment_nature:text`, `original_contract_reference:text`, `involved_task_source_ids:json:opaque`, `original_source_file:file`, `known_on:date`, `recorded_on:date`, `original_money:json:opaque`.
- Identity constraints: unique [{fields:['platform_operator_id','source_reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `platform_benefits.platform_operator_id → platform_operators [restrict/default]`, `platform_benefits.platform_worker_id → platform_workers [restrict/default]`.
- Collection: `src/data/collection/platform_benefits/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/platform-work/read-benefit-money.ts`.

### platform_cash_records

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `bank_document_sha256:text`, `cash_role:enum`, `reference:text`, `kind:enum`, `paid_at:instant`, `currency:currency`, `cash_amount:money`, `actual_gross:money`, `actual_contractual_deductions:money`, `actual_cpf_worker_deducted:money`, `earnings_from:date`, `earnings_through:date`, `earnings_period_reference:text`, `operator_bank_identity:text`, `worker_bank_identity:text`, `bank_file:file`, `breakdown_file:file`, `known_on:date`, `recorded_on:date`, `original_cash:json:opaque`.
- Identity constraints: unique [{fields:['platform_operator_id','bank_document_sha256']},{fields:['cpf_refund_source_id']},{fields:['cpf_refund_adjustment_id']},{fields:['cpf_assessment_id']},{fields:['platform_operator_id','reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `platform_cash_records.cpf_refund_adjustment_id → platform_cpf_refund_adjustments [restrict/default]`, `platform_cash_records.platform_operator_id → platform_operators [restrict/default]`, `platform_cash_records.platform_worker_id → platform_workers [restrict/default]`, `platform_cash_records.cpf_refund_source_id → platform_cpf_refunds [restrict/default]`, `platform_cash_records.cpf_assessment_id → platform_cpf_assessments [restrict/default]`.
- Collection: `src/data/collection/platform_cash_records/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/platform-work/read-cash.ts`, `src/lib/platform-work/read-refund-cash.ts` (remaining literal references counted in the inventory).

### platform_cpf_assessments

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `month:text`, `currency:currency`, `task_source_ids:json:opaque`, `benefit_source_ids:json:opaque`, `operator_joined_on:date`, `citizenship_status:enum`, `status_from:date`, `status_through:date`, `documented_service_remuneration:money`, `documented_excluded_cash:money`, `documented_contractual_deductions:money`, `documented_non_cash_value:money`, `original_month_source_file:file`, `original_status_file:file`, `original_onboarding_file:file`, `known_on:date`, `recorded_on:date`, `original_assessment:json:opaque`.
- Identity constraints: unique [{fields:['platform_operator_id','platform_worker_id','month']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `platform_cpf_assessments.platform_operator_id → platform_operators [restrict/default]`, `platform_cpf_assessments.platform_worker_id → platform_workers [restrict/default]`, `platform_cpf_assessments.source_settings_id → jurisdiction_settings [restrict/default]`, `platform_cpf_assessments.election_query_id → platform_cpf_queries [restrict/default]`.
- Collection: `src/data/collection/platform_cpf_assessments/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/platform-work/read-cpf-assessment.ts`, `src/lib/platform-work/remittance.ts`.

### platform_cpf_queries

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `contribution_month:text`, `queried_on:date`, `result_received_on:date`, `source_reference:text`, `result:enum`, `original_query_file:file`, `original_result_file:file`, `known_on:date`, `recorded_on:date`, `original_query:json:opaque`.
- Identity constraints: unique [{fields:['platform_operator_id','platform_worker_id','source_reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `platform_cpf_queries.platform_operator_id → platform_operators [restrict/default]`, `platform_cpf_queries.platform_worker_id → platform_workers [restrict/default]`.
- Collection: `src/data/collection/platform_cpf_queries/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/platform-work/read-cpf-assessment.ts`.

### platform_cpf_refund_adjustments

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `authority_reference:text`, `amended_on:date`, `currency:currency`, `amended_worker_refund_total:money`, `amended_operator_refund_total:money`, `authority_amendment_file:file`, `share_disposition_file:file`, `known_on:date`, `recorded_on:date`, `original_adjustment:json:opaque`.
- Identity constraints: unique [{fields:['original_refund_id']},{fields:['platform_operator_id','authority_reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `platform_cpf_refund_adjustments.original_refund_id → platform_cpf_refunds [restrict/default]`, `platform_cpf_refund_adjustments.platform_operator_id → platform_operators [restrict/default]`, `platform_cpf_refund_adjustments.platform_worker_id → platform_workers [restrict/default]`.
- Collection: `src/data/collection/platform_cpf_refund_adjustments/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/platform-work/read-refund-adjustment.ts`.

### platform_cpf_refund_scopes

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `source_reference:text`, `period_from:date`, `period_through:date`, `currency:currency`, `state:text`, `documented_worker_refund_paid:money`, `refund_cash_ids:json:opaque`, `period_statement_file:file`, `known_on:date`, `recorded_on:date`, `original_scope:json:opaque`.
- Identity constraints: unique [{fields:['platform_operator_id','platform_worker_id','period_from','period_through']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `platform_cpf_refund_scopes.platform_operator_id → platform_operators [restrict/default]`, `platform_cpf_refund_scopes.platform_worker_id → platform_workers [restrict/default]`.
- Collection: `src/data/collection/platform_cpf_refund_scopes/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/platform-work/read-cpf-refunds.ts`.

### platform_cpf_refunds

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `authority_reference:text`, `original_payment_reference:text`, `original_csn:text`, `original_member_reference:text`, `operator_bank_identity:text`, `original_contribution_month:text`, `original_payment_received_on:date`, `currency:currency`, `original_worker_paid:money`, `original_operator_paid:money`, `original_payment_total:money`, `refund_received_on:date`, `refund_received_amount:money`, `worker_refund_due:money`, `operator_refund_amount:money`, `authority_file:file`, `original_payment_file:file`, `share_disposition_file:file`, `received_bank_file:file`, `received_bank_document_sha256:text`, `known_on:date`, `recorded_on:date`, `original_refund:json:opaque`.
- Identity constraints: unique [{fields:['platform_operator_id','authority_reference']},{fields:['platform_operator_id','received_bank_document_sha256']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `platform_cpf_refunds.platform_operator_id → platform_operators [restrict/default]`, `platform_cpf_refunds.platform_worker_id → platform_workers [restrict/default]`, `platform_cpf_refunds.cpf_assessment_id → platform_cpf_assessments [restrict/default]`, `platform_cpf_refunds.original_remittance_id → statutory_remittances [restrict/default]`.
- Collection: `src/data/collection/platform_cpf_refunds/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/platform-work/read-cpf-refunds.ts`.

### platform_earning_slip_deliveries

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `delivery_document_sha256:text`, `reference:text`, `delivered_at:instant`, `recipient_identity:text`, `delivery_method:enum`, `delivery_reference:text`, `delivery_file:file`, `known_on:date`, `recorded_on:date`, `original_delivery:json:opaque`.
- Identity constraints: unique [{fields: ['original_slip_id', 'delivery_document_sha256']}, {fields: ['platform_operator_id', 'reference']}, {fields: ['original_slip_id', 'delivery_reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `platform_earning_slip_deliveries.original_slip_id → platform_earning_slips [restrict/default]`, `platform_earning_slip_deliveries.platform_operator_id → platform_operators [restrict/default]`, `platform_earning_slip_deliveries.platform_worker_id → platform_workers [restrict/default]`.
- Collection: `src/data/collection/platform_earning_slip_deliveries/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### platform_earning_slips

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `issued_at:instant`, `delivered_at:instant`, `recipient_identity:text`, `delivery_method:enum`, `delivery_reference:text`, `document_file:file`, `delivery_file:file`, `known_on:date`, `recorded_on:date`, `original_slip:json:opaque`.
- Identity constraints: unique [{fields: ['cash_record_id']}, {fields: ['cpf_refund_scope_id']}, {fields: ['platform_operator_id', 'reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `platform_earning_slips.calendar_policy_id → jurisdiction_settings [restrict/default]`, `platform_earning_slips.platform_operator_id → platform_operators [restrict/default]`, `platform_earning_slips.platform_worker_id → platform_workers [restrict/default]`, `platform_earning_slips.cash_record_id → platform_cash_records [restrict/default]`, `platform_earning_slips.cpf_refund_scope_id → platform_cpf_refund_scopes [restrict/default]`.
- Collection: `src/data/collection/platform_earning_slips/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/platform-work/read-earning-slip.ts`.

### platform_operator_notifications

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `kind:enum`, `operator_started_on:date`, `occurred_on:date`, `operator_ceased_on:date`, `commissioner_determined_operator:boolean`, `commissioner_requires_notification:boolean`, `known_on:date`, `recorded_on:date`, `notification_reference:text`, `authority_file:file`.
- Identity constraints: unique [{fields:['platform_operator_id','kind','notification_reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `platform_operator_notifications.platform_operator_id → platform_operators [restrict/default]`.
- Collection: `src/data/collection/platform_operator_notifications/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### platform_operator_scopes

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `correction_reason:text`, `provided_in_singapore:boolean`, `service_user_agreement:boolean`, `bookable_vehicle_on_demand:boolean`, `taxi_call_booking:boolean`, `lawful_individual_car_pooling:boolean`, `delivery_collection_and_delivery:boolean`, `requires_operator_app_or_website_for_tasks:boolean`, `management_presumption_rebutted:boolean`, `authorised_cross_border_ride_hail:boolean`, `rebuttal_reference:text`, `rebuttal_file:file`, `licence_reference:text`, `licence_from:date`, `licence_through:date`, `licence_file:file`, `service:enum`, `service_on:date`, `operator_became_on:date`, `known_on:date`, `recorded_on:date`, `classification_reference:text`, `agreement_reference:text`, `classification_file:file`, `agreement_file:file`, `contract_of_service:boolean`, `platform_agreement:boolean`, `payment_or_benefit:boolean`, `automated_worker_and_user_data_decision:boolean`, `non_statutory_task_rules:boolean`, `non_statutory_fee_negotiation_restriction:boolean`, `non_statutory_clientele_restriction:boolean`, `non_statutory_hours_or_tasks_restriction:boolean`, `non_statutory_performance_incentive_or_penalty:boolean`.
- Identity constraints: unique [{fields:['platform_operator_id','platform_worker_id','classification_reference']},{fields:['supersedes_scope_id']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `platform_operator_scopes.supersedes_scope_id → platform_operator_scopes [restrict/default]`, `platform_operator_scopes.platform_operator_id → platform_operators [restrict/default]`, `platform_operator_scopes.platform_worker_id → platform_workers [restrict/default]`, `platform_operator_scopes.source_policy_id → jurisdiction_settings [restrict/default]`.
- Collection: `src/data/collection/platform_operator_scopes/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### platform_operators

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `settings_code:text`, `name:text`, `trade_name:text`, `registration_country:text`, `identity_type:text`, `identity_number:text`, `address:text`, `contact_name:text`, `contact_identity:text`, `contact_address:text`, `contact_phone:text`, `contact_email:text`, `operator_reference:text`, `operator_type:enum`, `identity_file:file`, `known_on:date`, `recorded_on:date`.
- Identity constraints: unique [{fields:['operator_reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: none declared.
- Collection: `src/data/collection/platform_operators/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/platform-work/refund-cash.ts`, `src/lib/platform-work/remittance.ts`.

### platform_tasks

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `task_reference:text`, `task_on:date`, `completed_at:instant`, `currency:currency`, `transportation_mode:text`, `original_contract_reference:text`, `contract_from:date`, `contract_through:date`, `components:json:opaque`, `original_price_file:file`, `transport_file:file`, `completion_file:file`, `known_on:date`, `recorded_on:date`, `original_money:json:opaque`.
- Identity constraints: unique [{fields:['platform_operator_id','task_reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `platform_tasks.platform_operator_id → platform_operators [restrict/default]`, `platform_tasks.platform_worker_id → platform_workers [restrict/default]`, `platform_tasks.classification_source_id → platform_operator_scopes [restrict/default]`.
- Collection: `src/data/collection/platform_tasks/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/platform-work/read-task-money.ts`.

### platform_workers

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `name:text`, `identity_type:text`, `identity_number:text`, `date_of_birth:date`, `citizenship_status:enum`, `identity_file:file`, `known_on:date`, `recorded_on:date`.
- Identity constraints: unique [{fields:['identity_type','identity_number']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: none declared.
- Collection: `src/data/collection/platform_workers/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/platform-work/refund-cash.ts`, `src/lib/platform-work/remittance.ts`.

### presence_periods

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `jurisdiction_code:text`, `period:period`, `employment_exercised:bool`, `reference:text`.
- Identity constraints: unique —; noOverlap [ { key: ['employee_id', 'jurisdiction_code'], period: 'period', name: 'presence_periods_no_overlap' } ].
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `presence_periods.employee_id → employees [owned]`.
- Collection: `src/data/collection/presence_periods/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/expressions/contexts.ts`, `src/lib/payroll/run/eligibility.ts` (remaining literal references counted in the inventory).

### prior_authority_credit_reversals

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `authority_reference:text`, `issued_on:date`, `known_on:date`, `effective_on:date`, `currency:currency`, `credit_reversal_amount:money`, `authority_file:file`, `snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "prior_wage_credit_scope_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `prior_authority_credit_reversals.prior_wage_credit_scope_id → prior_wage_credit_scopes [restrict/default]`, `prior_authority_credit_reversals.receivable_distribution_return_id → receivable_distribution_returns [restrict/default]`, `prior_authority_credit_reversals.receivable_distribution_id → receivable_distributions [restrict/default]`, `prior_authority_credit_reversals.company_id → companies [restrict/default]`, `prior_authority_credit_reversals.employee_id → employees [restrict/default]`, `prior_authority_credit_reversals.wage_debt_id → wage_debts [restrict/default]`.
- Collection: `src/data/collection/prior_authority_credit_reversals/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/prior-authority-credit-reversal.ts`, `src/lib/prior-authority-redelivery.ts` (remaining literal references counted in the inventory).

### prior_statutory_credit_restorations

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `currency:currency`, `credit_amount:money`, `cash_available_on:date`, `known_on:date`, `payment_reference:text`, `restoration_allocation_file:file`, `snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "prior_statutory_credit_reversal_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `prior_statutory_credit_restorations.prior_statutory_credit_reversal_id → prior_statutory_credit_reversals [restrict/default]`, `prior_statutory_credit_restorations.statutory_employee_refund_id → statutory_employee_refunds [restrict/default]`, `prior_statutory_credit_restorations.company_id → companies [restrict/default]`, `prior_statutory_credit_restorations.employee_id → employees [restrict/default]`, `prior_statutory_credit_restorations.wage_debt_id → wage_debts [restrict/default]`.
- Collection: `src/data/collection/prior_statutory_credit_restorations/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/original-credit-reservations.ts`, `src/lib/prior-statutory-credit-restoration.ts`.

### prior_statutory_credit_reversals

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `authority_reference:text`, `issued_on:date`, `known_on:date`, `effective_on:date`, `refund_allocation_reference:text`, `refund_allocation_file:file`, `authority_disposition:enum`, `currency:currency`, `credit_reversal_amount:money`, `authority_file:file`, `snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "prior_wage_credit_scope_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `prior_statutory_credit_reversals.prior_wage_credit_scope_id → prior_wage_credit_scopes [restrict/default]`, `prior_statutory_credit_reversals.statutory_refund_receipt_id → statutory_refund_receipts [restrict/default]`, `prior_statutory_credit_reversals.settlement_wage_statutory_discharge_id → settlement_wage_statutory_discharges [restrict/default]`, `prior_statutory_credit_reversals.company_id → companies [restrict/default]`, `prior_statutory_credit_reversals.employee_id → employees [restrict/default]`, `prior_statutory_credit_reversals.wage_debt_id → wage_debts [restrict/default]`.
- Collection: `src/data/collection/prior_statutory_credit_reversals/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/prior-statutory-credit-restoration.ts`, `src/lib/prior-statutory-credit-reversal.ts` (remaining literal references counted in the inventory).

### prior_wage_credit_redeliveries

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `source_system:text`, `source_payment_id:text`, `payment_reference:text`, `allocation_reference:text`, `payer_reference:text`, `recipient_reference:text`, `paid_on:date`, `available_on:date`, `known_on:date`, `cash_amount:money`, `receipt_cash_total:money`, `currency:currency`, `snapshot:json:opaque`, `bank_file:file`, `employee_receipt_file:file`, `parties_file:file`, `assessment_basis:enum`.
- Identity constraints: unique [ { "fields": [ "source_system", "source_payment_id", "allocation_reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `prior_wage_credit_redeliveries.prior_wage_credit_reversal_id → prior_wage_credit_reversals [restrict/default]`, `prior_wage_credit_redeliveries.source_cash_payment_id → source_cash_payments [restrict/default]`, `prior_wage_credit_redeliveries.company_id → companies [restrict/default]`, `prior_wage_credit_redeliveries.employee_id → employees [restrict/default]`, `prior_wage_credit_redeliveries.wage_debt_id → wage_debts [restrict/default]`, `prior_wage_credit_redeliveries.source_request_id → adhoc_requests [restrict/default]`.
- Collection: `src/data/collection/prior_wage_credit_redeliveries/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/historical-credit-lifecycle.ts`, `src/lib/original-credit-reservations.ts` (remaining literal references counted in the inventory).

### prior_wage_credit_reversals

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `authority_reference:text`, `issued_on:date`, `known_on:date`, `effective_on:date`, `credit_reversal_amount:money`, `authority_file:file`, `currency:currency`, `snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "prior_wage_credit_scope_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `prior_wage_credit_reversals.prior_wage_credit_scope_id → prior_wage_credit_scopes [restrict/default]`, `prior_wage_credit_reversals.wage_source_cash_return_id → wage_source_cash_returns [restrict/default]`, `prior_wage_credit_reversals.source_cash_payment_id → source_cash_payments [restrict/default]`, `prior_wage_credit_reversals.wage_debt_id → wage_debts [restrict/default]`, `prior_wage_credit_reversals.company_id → companies [restrict/default]`, `prior_wage_credit_reversals.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/prior_wage_credit_reversals/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/prior-credit-redelivery.ts`, `src/lib/prior-wage-credit-lifecycle.ts` (remaining literal references counted in the inventory).

### prior_wage_credit_scopes

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `known_on:date`, `allocations:json:opaque`, `complete_scope_file:file`, `original_credit_binding_file:file`, `currency:currency`, `snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "wage_debt_id" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `prior_wage_credit_scopes.wage_debt_id → wage_debts [restrict/default]`, `prior_wage_credit_scopes.company_id → companies [restrict/default]`, `prior_wage_credit_scopes.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/prior_wage_credit_scopes/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/historical-credit-lifecycle.ts`, `src/lib/paid-wage-credit-lifecycle.ts` (remaining literal references counted in the inventory).

### receivable_authority_refunds

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `source_system:text`, `source_payment_id:text`, `allocation_reference:text`, `bank_reference:text`, `payer_reference:text`, `recipient_reference:text`, `authority_reference:text`, `paid_on:date`, `available_on:date`, `cash_amount:decimal`, `receipt_cash_total:decimal`, `currency:currency`, `snapshot:json:opaque`, `bank_file:file`, `recipient_identity_file:file`, `authority_refund_file:file`.
- Identity constraints: unique [ { "fields": [ "source_system", "source_payment_id", "allocation_reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `receivable_authority_refunds.receivable_remittance_id → receivable_remittances [restrict/default]`, `receivable_authority_refunds.receivable_direction_id → receivable_directions [restrict/default]`, `receivable_authority_refunds.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/receivable_authority_refunds/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/receivable-authority-refunds.ts`.

### receivable_credit_corrections

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `authority_reference:text`, `issued_on:date`, `known_on:date`, `effective_on:date`, `currency:currency`, `credit_reversal_amount:decimal`, `authority_file:file`, `snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "wage_debt_payment_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `receivable_credit_corrections.receivable_distribution_return_id → receivable_distribution_returns [restrict/default]`, `receivable_credit_corrections.wage_debt_payment_id → wage_debt_payments [restrict/default]`, `receivable_credit_corrections.receivable_distribution_id → receivable_distributions [restrict/default]`, `receivable_credit_corrections.wage_debt_id → wage_debts [restrict/default]`, `receivable_credit_corrections.company_id → companies [restrict/default]`, `receivable_credit_corrections.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/receivable_credit_corrections/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/prior-authority-credit-reversal.ts`, `src/lib/receivable-distributions.ts` (remaining literal references counted in the inventory).

### receivable_direction_changes

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `authority_reference:text`, `issued_on:date`, `known_on:date`, `effective_on:date`, `currency:currency`, `operation:enum`, `current_directed_amount:decimal`, `snapshot:json:opaque`, `authority_file:file`, `service_file:file`.
- Identity constraints: unique [ { "fields": [ "supersedes_change_id" ] }, { "fields": [ "receivable_direction_id" ], "where": { "supersedes_change_id": { "isNull": true } } }, { "fields": [ "receivable_direction_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `receivable_direction_changes.receivable_direction_id → receivable_directions [restrict/default]`, `receivable_direction_changes.supersedes_change_id → receivable_direction_changes [restrict/default]`.
- Collection: `src/data/collection/receivable_direction_changes/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/receivable-changes.ts`, `src/lib/receivable-directions.ts`.

### receivable_directions

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `original_award_on:date`, `original_award_absent_party:bool`, `reference:text`, `contract_reference:text`, `liable_party_reference:text`, `third_party_reference:text`, `authority_recipient_reference:text`, `original_award_reference:text`, `admission_reference:text`, `work_connection_reference:text`, `authority_reference:text`, `service_reference:text`, `issued_on:date`, `received_on:date`, `effective_on:date`, `due_on:date`, `admitted_on:date`, `original_award_amount:decimal`, `admitted_contract_amount:decimal`, `directed_amount:decimal`, `currency:currency`, `admission_mode:enum`, `summoned_on:date`, `summons_file:file`, `award_file:file`, `contract_file:file`, `admission_file:file`, `authority_file:file`, `service_file:file`.
- Identity constraints: unique [ { "fields": [ "company_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `receivable_directions.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/receivable_directions/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/receivable-authority-refunds.ts`, `src/lib/receivable-changes.ts` (remaining literal references counted in the inventory).

### receivable_distribution_returns

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `source_system:text`, `source_payment_id:text`, `allocation_reference:text`, `bank_reference:text`, `payer_reference:text`, `recipient_reference:text`, `paid_on:date`, `received_on:date`, `currency:currency`, `cash_amount:decimal`, `receipt_cash_total:decimal`, `bank_file:file`, `authority_receipt_file:file`.
- Identity constraints: unique [ { "fields": [ "source_system", "source_payment_id", "allocation_reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `receivable_distribution_returns.receivable_distribution_id → receivable_distributions [restrict/default]`, `receivable_distribution_returns.company_id → companies [restrict/default]`, `receivable_distribution_returns.employee_id → employees [restrict/default]`, `receivable_distribution_returns.wage_debt_id → wage_debts [restrict/default]`.
- Collection: `src/data/collection/receivable_distribution_returns/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/prior-authority-credit-reversal.ts`, `src/lib/prior-authority-redelivery.ts` (remaining literal references counted in the inventory).

### receivable_distributions

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `recipient_reference:text`, `payer_reference:text`, `source_system:text`, `source_payment_id:text`, `allocation_reference:text`, `bank_reference:text`, `authority_distribution_reference:text`, `funding_allocation_reference:text`, `currency:currency`, `paid_on:date`, `available_on:date`, `cash_amount:decimal`, `receipt_cash_total:decimal`, `bank_file:file`, `beneficiary_identity_file:file`, `authority_distribution_file:file`, `funding_allocation_file:file`.
- Identity constraints: unique [ { "fields": [ "source_system", "source_payment_id", "allocation_reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `receivable_distributions.prior_authority_credit_reversal_id → prior_authority_credit_reversals [restrict/default]`, `receivable_distributions.receivable_remittance_id → receivable_remittances [restrict/default]`, `receivable_distributions.wage_debt_id → wage_debts [restrict/default]`, `receivable_distributions.recipient_employee_id → employees [restrict/default]`, `receivable_distributions.employee_id → employees [restrict/default]`, `receivable_distributions.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/receivable_distributions/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/prior-authority-redelivery.ts`, `src/lib/prior-wage-credit-lifecycle.ts` (remaining literal references counted in the inventory).

### receivable_procedure_events

- Target: **NEEDS_EVIDENCE**. Resolve input/operation split and actual actor host before selecting profile versus entity JSON. Preserve old IDs and paid references during a bounded migration; not an indefinite KEEP.
- Fields: `rule_code:text`, `reference:text`, `receipt_reference:text`, `filed_on:date`, `receipt_on:date`, `anchor_on:date`, `deadline_on:date`, `receipt_outcome:enum`, `filed_within_source_deadline:bool`, `rule_snapshot:json:opaque`, `filing_file:file`, `receipt_file:file`.
- Identity constraints: unique [ { "fields": [ "receivable_direction_id", "rule_code", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `receivable_procedure_events.receivable_direction_id → receivable_directions [restrict/default]`, `receivable_procedure_events.settings_id → jurisdiction_settings [restrict/default]`.
- Collection: `src/data/collection/receivable_procedure_events/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### receivable_remittance_reversals

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `authority_reference:text`, `issued_on:date`, `known_on:date`, `effective_on:date`, `discharge_reversal_amount:decimal`, `currency:currency`, `snapshot:json:opaque`, `authority_file:file`.
- Identity constraints: unique [ { "fields": [ "receivable_authority_refund_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `receivable_remittance_reversals.receivable_authority_refund_id → receivable_authority_refunds [restrict/default]`, `receivable_remittance_reversals.receivable_remittance_id → receivable_remittances [restrict/default]`, `receivable_remittance_reversals.receivable_direction_id → receivable_directions [restrict/default]`, `receivable_remittance_reversals.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/receivable_remittance_reversals/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/receivable-authority-refunds.ts`.

### receivable_remittances

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `source_system:text`, `source_payment_id:text`, `allocation_reference:text`, `payer_reference:text`, `recipient_reference:text`, `bank_reference:text`, `authority_receipt_reference:text`, `currency:currency`, `paid_on:date`, `authority_received_on:date`, `amount:decimal`, `receipt_total:decimal`, `bank_file:file`, `authority_receipt_file:file`.
- Identity constraints: unique [ { "fields": [ "source_system", "source_payment_id", "allocation_reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `receivable_remittances.receivable_direction_id → receivable_directions [restrict/default]`.
- Collection: `src/data/collection/receivable_remittances/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/receivable-authority-refunds.ts`, `src/lib/receivable-directions.ts` (remaining literal references counted in the inventory).

### recipient_cash_dispositions

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `voucher_line_id:text`, `currency:currency`, `moved_on:date`, `kind:enum`, `amount:money`, `source_system_reference:text`, `reference:text`, `sender_identity:text`, `counterparty_identity:text`, `counterparty_account_reference:text`, `whole_voucher_amount:money`, `source_scope:enum`, `evidence_file:file`, `recorded_on:date`, `sequence:int`, `document_sha256:text`, `evidence_source:json:opaque`, `assessment_source:json:opaque`.
- Identity constraints: unique [{fields:['source_system_reference','reference']},{fields:['document_sha256'],where:{voucher_register_id:{isNull:true}}},{fields:['voucher_register_id','voucher_line_id'],where:{voucher_register_id:{isNull:false}}},{fields:['reassessment_id','kind','sequence']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `recipient_cash_dispositions.voucher_register_id → recipient_cash_vouchers [restrict/default]`, `recipient_cash_dispositions.reassessment_id → recipient_cash_reassessments [restrict/default]`, `recipient_cash_dispositions.company_id → companies [restrict/default]`, `recipient_cash_dispositions.original_event_id → recipient_income_events [restrict/default]`.
- Collection: `src/data/collection/recipient_cash_dispositions/+collection.ts`. Runtime consumer examples: `src/lib/annual-authority-document.ts`, `src/lib/every-field.ts`, `src/lib/recipient-cash-corrections.ts` (remaining literal references counted in the inventory).

### recipient_cash_reassessments

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `issuer_qualification:json:opaque`, `issuer_evidence_file:file`, `issuer_document:json:opaque`, `currency:currency`, `payer_tax_identifier:text`, `recipient_identity:text`, `assessed_on:date`, `reference:text`, `authority_name:text`, `authority_account_reference:text`, `authority_payment_identity:text`, `corrected_taxable:money`, `corrected_withheld:money`, `recipient_refund_amount:money`, `recipient_collection_amount:money`, `agency_kind:enum`, `agency_amount:money`, `agency_target_reference:text`, `reconciled_movement_ids:list`, `evidence_file:file`, `recorded_on:date`, `sequence:int`, `original_tax_paid:money`, `original_tax_source:json:opaque`, `original_cash:json:opaque`, `authority_document:json:opaque`, `filing_source:json:opaque`, `reconciled_movements:json:opaque`.
- Identity constraints: unique [{fields:['original_event_id','sequence']},{fields:['supersedes_id'],where:{supersedes_id:{isNull:false}}},{fields:['original_event_id'],where:{supersedes_id:{isNull:true}}}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `recipient_cash_reassessments.original_event_id → recipient_income_events [restrict/default]`, `recipient_cash_reassessments.company_id → companies [restrict/default]`, `recipient_cash_reassessments.filing_id → income_return_filings [restrict/default]`, `recipient_cash_reassessments.supersedes_id → recipient_cash_reassessments [restrict/default]`.
- Collection: `src/data/collection/recipient_cash_reassessments/+collection.ts`. Runtime consumer examples: `src/lib/annual-authority-document.ts`, `src/lib/every-field.ts`, `src/lib/recipient-cash-corrections.ts` (remaining literal references counted in the inventory).

### recipient_cash_vouchers

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `currency:currency`, `moved_on:date`, `source_kind:enum`, `source_system_reference:text`, `reference:text`, `whole_amount:money`, `source_scope:enum`, `lines:json:opaque`, `evidence_file:file`, `recorded_on:date`, `document_sha256:text`, `evidence_source:json:opaque`.
- Identity constraints: unique [{fields:['source_system_reference','reference']},{fields:['document_sha256']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `recipient_cash_vouchers.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/recipient_cash_vouchers/+collection.ts`. Runtime consumer examples: `src/lib/annual-authority-document.ts`, `src/lib/every-field.ts`, `src/lib/recipient-cash-vouchers.ts`.

### recipient_income_events

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `valuation_forex_quote_file:file`, `valuation_forex:json:opaque`, `source_occurrence_key:text`, `special_metadata:json:opaque`, `special_payloads:json:opaque`, `kind:text`, `amount:decimal`, `event_on:date`, `facts:custom`, `evidence_file:file`, `report_on:date`, `income_item:text`, `reportable_amount:decimal`, `taxable:bool`, `withholding_total_remitted_amount:decimal`, `withholding_amount:decimal`, `withholding_due_on:date`, `clearance_trigger_type:text`, `special_return:text`, `special_due_on:date`, `accepted_on:date`, `acceptance_reference:text`, `acceptance_evidence_file:file`, `withholding_remitted_on:date`, `withholding_remitted_amount:decimal`, `withholding_payment_reference:text`, `special_accepted_on:date`, `special_acceptance_reference:text`, `special_acceptance_evidence_file:file`, `cash_paid_on:date`, `cash_gross:decimal`, `cash_employee_net:decimal`, `cash_fiscal_snapshot:json:opaque`, `cash_payment_reference:text`, `cash_payment_evidence_file:file`, `withholding_payment_evidence_file:file`.
- Identity constraints: unique [{ fields: ['recipient_id','source_occurrence_key'], where: { source_occurrence_key: { isNull: false }, supersedes_event_id: { isNull: true } } },{ fields: ['supersedes_event_id'], where: { supersedes_event_id: { isNull: false } } }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `recipient_income_events.valuation_forex_policy_id → valuation_forex_policies [restrict/default]`, `recipient_income_events.recipient_id → income_recipients [restrict/default]`, `recipient_income_events.supersedes_event_id → recipient_income_events [restrict/default]`.
- Collection: `src/data/collection/recipient_income_events/+collection.ts`. Runtime consumer examples: `src/lib/annual-authority-document.ts`, `src/lib/every-field.ts`, `src/lib/payroll/run/clearance-filing.ts` (remaining literal references counted in the inventory).

### reference_rows

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `table:text`, `code:text`, `parent_code:text`, `label:text`, `effective_range:period`, `range_from:decimal`, `range_to:decimal`, `values:custom`.
- Identity constraints: unique —; noOverlap [ { key: ['settings_id', 'table', 'code'], period: 'effective_range', name: 'reference_rows_code_no_overlap' } ].
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `reference_rows.settings_id → jurisdiction_settings [owned]`.
- Collection: `src/data/collection/reference_rows/+collection.ts`. Runtime consumer examples: `src/lib/checks.ts`, `src/lib/coded-fields.ts`, `src/lib/datatypes/fact_keys.ts` (remaining literal references counted in the inventory).

### registered_settlement_heads

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `agreement_reference:text`, `mediator_reference:text`, `registration_reference:text`, `head_reference:text`, `lawful_head:enum`, `prior_satisfaction_reference:text`, `settlement_catalogue_code:text`, `settlement_basis_reference:text`, `employee_signed_on:date`, `employer_signed_on:date`, `registration_filed_on:date`, `registered_on:date`, `registration_received_on:date`, `original_start:date`, `original_end:date`, `due_on:date`, `all_parties_signed_on:date`, `currency:currency`, `registration_deadline_on:date`, `filed_within_source_deadline:bool`, `rule_snapshot:json:opaque`, `agreement_total:decimal`, `head_amount:decimal`, `prior_satisfaction:decimal`, `agreement_file:file`, `mediator_evidence_file:file`, `registration_notice_file:file`, `head_allocation_file:file`, `registration_valid_through_on:date`.
- Identity constraints: unique [ { "fields": [ "company_id", "employee_id", "registration_reference", "head_reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `registered_settlement_heads.settings_id → jurisdiction_settings [restrict/default]`, `registered_settlement_heads.employment_id → employments [restrict/default]`, `registered_settlement_heads.company_id → companies [restrict/default]`, `registered_settlement_heads.employee_id → employees [restrict/default]`, `registered_settlement_heads.settlement_registration_event_id → settlement_registration_events [restrict/default]`.
- Collection: `src/data/collection/registered_settlement_heads/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/registered-settlement.ts`, `src/lib/settlement-enforcement.ts` (remaining literal references counted in the inventory).

### replacement_restitution_cases

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `lifecycle:state`, `reference:text`, `basis:enum`, `decision_on:date`, `effective_on:date`, `decision_reference:text`, `payer_reference:text`, `company_receiving_reference:text`, `basis_file:file`, `attribution_reference:text`, `attribution_file:file`, `work_day_source_id:text`, `line:text`, `band_label:text`, `currency:currency`, `source_timezone:text`, `original_net:money`, `original_tax:money`, `original_other_deductions:money`, `original_gross:money`, `employee_restitution_due:money`, `original_cash:custom`, `source_ids:json:shaped`, `observed_at:instant`.
- Identity constraints: unique [{fields:['original_payslip_id','work_day_source_id','line','band_label']} ]; noOverlap —.
- Explicit state: lifecycle.
- Relationships: `replacement_restitution_cases.company_id → companies [restrict/default]`, `replacement_restitution_cases.employee_id → employees [restrict/default]`, `replacement_restitution_cases.employment_id → employments [restrict/default]`, `replacement_restitution_cases.original_payslip_id → payslips [restrict/default]`.
- Collection: `src/data/collection/replacement_restitution_cases/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/replacement-statutory-outcomes.ts`.

### replacement_restitution_discharges

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `lifecycle:state`, `original_statutory:custom`, `effective_statutory:custom`, `statutory_outcome_ids:json:shaped`, `statutory_source_ids:json:shaped`, `remedy_kind:enum`, `partial_effective_on:date`, `partial_rights_reference:text`, `partial_rights_file:file`, `partial_partition_reference:text`, `partial_partition_file:file`, `corrected_earned_hours:int`, `voided_paid_hours:int`, `retained_paid_hours:int`, `voided_gross:money`, `retained_gross:money`, `original_adjustment_index:int`, `original_adjustment:custom`, `original_header_gross:money`, `original_header_net:money`, `source_timezone:text`, `reference:text`, `zero_rights_effective_on:date`, `zero_rights_reference:text`, `zero_rights_file:file`, `zero_entitlement_confirmed:bool`, `currency:currency`, `original_paid_source_id:text`, `work_day_source_id:text`, `line:text`, `band_label:text`, `original_cash:custom`, `net_remedied:money`, `tax_outcome:enum`, `other_outcome:enum`, `company_receiving_reference:text`, `source_ids:json:shaped`, `observed_at:instant`, `tax_final_reference:text`, `tax_final_on:date`, `tax_final_file:file`, `tax_source_system:text`, `tax_incoming_transaction_id:text`, `tax_received_at:instant`, `tax_amount:money`, `tax_receipt_file:file`, `other_final_reference:text`, `other_final_on:date`, `other_final_file:file`, `other_source_system:text`, `other_incoming_transaction_id:text`, `other_received_at:instant`, `other_amount:money`, `other_receipt_file:file`.
- Identity constraints: unique [{fields:['case_id']},{fields:['company_id','tax_source_system','tax_incoming_transaction_id'],where:{tax_outcome:{eq:'FULL_REFUND_TO_EMPLOYER'}}},{fields:['company_id','other_source_system','other_incoming_transaction_id'],where:{other_outcome:{eq:'FULL_REFUND_TO_EMPLOYER'}}}]; noOverlap —.
- Explicit state: lifecycle.
- Relationships: `replacement_restitution_discharges.tax_receipt_id → replacement_restitution_receipts [restrict/default]`, `replacement_restitution_discharges.other_receipt_id → replacement_restitution_receipts [restrict/default]`, `replacement_restitution_discharges.case_id → replacement_restitution_cases [restrict/default]`, `replacement_restitution_discharges.company_id → companies [restrict/default]`, `replacement_restitution_discharges.employee_id → employees [restrict/default]`, `replacement_restitution_discharges.employment_id → employments [restrict/default]`.
- Collection: `src/data/collection/replacement_restitution_discharges/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/replacement-restitution-discharge.ts`.

### replacement_restitution_receipts

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `lifecycle:state`, `receipt_sequence:int`, `source_ids:json:shaped`, `kind:enum`, `component_final_reference:text`, `component_final_on:date`, `component_final_file:file`, `reference:text`, `source_system:text`, `incoming_transaction_id:text`, `received_at:instant`, `payer_reference:text`, `company_receiving_reference:text`, `currency:currency`, `amount:money`, `receipt_total:money`, `receipt_file:file`, `case_reference:text`, `original_paid_source_id:text`, `observed_at:instant`.
- Identity constraints: unique [{fields:['company_id','source_system','incoming_transaction_id']},{fields:['case_id','receipt_sequence']}]; noOverlap —.
- Explicit state: lifecycle.
- Relationships: `replacement_restitution_receipts.company_id → companies [restrict/default]`, `replacement_restitution_receipts.employee_id → employees [restrict/default]`, `replacement_restitution_receipts.employment_id → employments [restrict/default]`, `replacement_restitution_receipts.case_id → replacement_restitution_cases [restrict/default]`.
- Collection: `src/data/collection/replacement_restitution_receipts/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### replacement_statutory_outcomes

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `lifecycle:state`, `reference:text`, `statutory_index:int`, `outcome:enum`, `authority_reference:text`, `effective_on:date`, `final_effective_confirmed:bool`, `authority_file:file`, `corrected_base:money`, `corrected_ordinary:money`, `currency:currency`, `scheme_code:text`, `original_source_context:text`, `original_statutory:custom`, `effective_statutory:custom`, `source_ids:json:shaped`, `observed_at:instant`.
- Identity constraints: unique [{fields:['original_paid_source_id','statutory_index']}]; noOverlap —.
- Explicit state: lifecycle.
- Relationships: `replacement_statutory_outcomes.case_id → replacement_restitution_cases [restrict/default]`, `replacement_statutory_outcomes.company_id → companies [restrict/default]`, `replacement_statutory_outcomes.employee_id → employees [restrict/default]`, `replacement_statutory_outcomes.employment_id → employments [restrict/default]`, `replacement_statutory_outcomes.original_paid_source_id → payslips [restrict/default]`, `replacement_statutory_outcomes.settings_id → jurisdiction_settings [restrict/default]`, `replacement_statutory_outcomes.contribution_id → statutory_contributions [restrict/default]`.
- Collection: `src/data/collection/replacement_statutory_outcomes/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/replacement-statutory-outcomes.ts`.

### reporting_transfers

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `status:enum`, `cancelled_on:date`, `cancellation_reference:text`, `cancellation_evidence_file:file`, `reference:text`, `basis_year:int`, `transferred_on:date`, `elected_on:date`, `qualification_confirmed:bool`, `qualification_reference:text`, `qualification_evidence_file:file`, `authority_reference:text`, `election_evidence_file:file`, `elected_by:text`, `predecessor_scope_ids:json:opaque`, `appendix_reversal_confirmed:bool`, `appendix_reversal_evidence_file:file`, `income_tax_reconciliation:json:opaque`, `income_tax_reconciliation_reference:text`, `income_tax_reconciliation_evidence_file:file`, `date_reconciliation:json:opaque`, `date_reconciliation_reference:text`, `date_reconciliation_evidence_file:file`, `election:enum`.
- Identity constraints: unique [{fields:['predecessor_employment_id','basis_year'],where:{status:{eq:'ACTIVE'}}}]; noOverlap —.
- Explicit state: status.
- Relationships: `reporting_transfers.predecessor_reversal_filing_id → income_return_filings [restrict/default]`, `reporting_transfers.predecessor_employment_id → employments [restrict/default]`, `reporting_transfers.successor_employment_id → employments [restrict/default]`, `reporting_transfers.predecessor_company_id → companies [restrict/default]`, `reporting_transfers.successor_company_id → companies [restrict/default]`, `reporting_transfers.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/reporting_transfers/+collection.ts`. Runtime consumer examples: `src/lib/employment-contract.ts`, `src/lib/every-field.ts`, `src/lib/payroll/run/income-reporting.ts` (remaining literal references counted in the inventory).

### rosters

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `period:text`.
- Identity constraints: unique [{ fields: ['employment_id', 'period'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `rosters.employment_id → employments [restrict/default]`.
- Collection: `src/data/collection/rosters/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/leave/context.ts`, `src/lib/payroll/calendar-history.ts` (remaining literal references counted in the inventory).

### settlement_enforcement_orders

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `authority_reference:text`, `head_scope_reference:text`, `registration_reference:text`, `issued_on:date`, `known_on:date`, `effective_on:date`, `authority_file:file`, `service_file:file`, `head_scope_file:file`, `operation:enum`, `snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "supersedes_order_id" ] }, { "fields": [ "registered_settlement_head_id" ], "where": { "supersedes_order_id": { "isNull": true } } }, { "fields": [ "registered_settlement_head_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `settlement_enforcement_orders.registered_settlement_head_id → registered_settlement_heads [restrict/default]`, `settlement_enforcement_orders.supersedes_order_id → settlement_enforcement_orders [restrict/default]`, `settlement_enforcement_orders.company_id → companies [restrict/default]`, `settlement_enforcement_orders.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/settlement_enforcement_orders/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/settlement-enforcement.ts`, `src/lib/settlement-registration-lifecycle.ts`.

### settlement_monetary_directions

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `authority_reference:text`, `head_scope_reference:text`, `issued_on:date`, `known_on:date`, `effective_on:date`, `authority_file:file`, `head_scope_file:file`, `service_file:file`, `currency:currency`, `current_face:decimal`, `snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "supersedes_direction_id" ] }, { "fields": [ "wage_debt_id" ], "where": { "supersedes_direction_id": { "isNull": true } } }, { "fields": [ "wage_debt_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `settlement_monetary_directions.wage_debt_id → wage_debts [restrict/default]`, `settlement_monetary_directions.registered_settlement_head_id → registered_settlement_heads [restrict/default]`, `settlement_monetary_directions.supersedes_direction_id → settlement_monetary_directions [restrict/default]`, `settlement_monetary_directions.company_id → companies [restrict/default]`, `settlement_monetary_directions.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/settlement_monetary_directions/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/settlement-monetary.ts`.

### settlement_registration_events

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `application_reference:text`, `event_reference:text`, `agreement_reference:text`, `employee_signed_on:date`, `employer_signed_on:date`, `filed_on:date`, `receipt_on:date`, `agreement_file:file`, `filing_file:file`, `receipt_file:file`, `outcome:enum`, `registration_reference:text`, `registered_on:date`, `registration_valid_through_on:date`, `registration_notice_file:file`, `head_scope_file:file`.
- Identity constraints: unique [ { "fields": [ "supersedes_event_id" ] }, { "fields": [ "company_id", "employee_id", "application_reference" ], "where": { "supersedes_event_id": { "isNull": true } } }, { "fields": [ "company_id", "employee_id", "application_reference", "event_reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `settlement_registration_events.employment_id → employments [restrict/default]`, `settlement_registration_events.registered_settlement_head_id → registered_settlement_heads [restrict/default]`, `settlement_registration_events.supersedes_event_id → settlement_registration_events [restrict/default]`, `settlement_registration_events.company_id → companies [restrict/default]`, `settlement_registration_events.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/settlement_registration_events/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/settlement-registration-lifecycle.ts`.

### settlement_reregistrations

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `scope_reference:text`, `registration_reference:text`, `registered_on:date`, `known_on:date`, `registration_valid_through_on:date`, `scope_file:file`, `snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "supersedes_setaside_order_id" ] }, { "fields": [ "registered_settlement_head_id", "settlement_registration_event_id" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `settlement_reregistrations.registered_settlement_head_id → registered_settlement_heads [restrict/default]`, `settlement_reregistrations.settlement_registration_event_id → settlement_registration_events [restrict/default]`, `settlement_reregistrations.supersedes_setaside_order_id → settlement_enforcement_orders [restrict/default]`, `settlement_reregistrations.company_id → companies [restrict/default]`, `settlement_reregistrations.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/settlement_reregistrations/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/settlement-enforcement.ts`, `src/lib/settlement-registration-lifecycle.ts`.

### settlement_wage_sources

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `source_reference:text`, `component_code:text`, `earned_from:date`, `earned_to:date`, `payable_on:date`, `currency:currency`, `gross_amount:decimal`, `dated_cash:json:opaque`, `assessment_mode:enum`, `snapshot:json:opaque`, `wage_basis_file:file`, `earned_source_file:file`, `allocation_file:file`.
- Identity constraints: unique [ { "fields": [ "wage_debt_id", "source_reference", "earned_from", "earned_to", "component_code" ] }, { "fields": [ "wage_assessment_declaration_id", "source_reference", "component_code", "earned_from", "earned_to" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `settlement_wage_sources.wage_debt_id → wage_debts [restrict/default]`, `settlement_wage_sources.earned_employment_id → employments [restrict/default]`, `settlement_wage_sources.wage_assessment_declaration_id → wage_assessment_declarations [restrict/default]`, `settlement_wage_sources.registered_settlement_head_id → registered_settlement_heads [restrict/default]`, `settlement_wage_sources.original_head_employment_id → employments [restrict/default]`, `settlement_wage_sources.company_id → companies [restrict/default]`, `settlement_wage_sources.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/settlement_wage_sources/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/paid-wage-credit-lifecycle.ts`, `src/lib/settlement-earned-wages.ts` (remaining literal references counted in the inventory).

### settlement_wage_statutory_discharges

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `source_reference:text`, `assessment_source:text`, `assessment_row_index:int`, `assessment_index:int`, `currency:currency`, `paid_on:date`, `employee_satisfaction_amount:decimal`, `employer_discharge_amount:decimal`, `snapshot:json:opaque`, `allocation_file:file`.
- Identity constraints: unique [ { "fields": [ "assessment_source", "settlement_wage_source_id" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `settlement_wage_statutory_discharges.settlement_wage_source_id → settlement_wage_sources [restrict/default]`, `settlement_wage_statutory_discharges.statutory_remittance_id → statutory_remittances [restrict/default]`, `settlement_wage_statutory_discharges.wage_debt_id → wage_debts [restrict/default]`, `settlement_wage_statutory_discharges.source_request_id → adhoc_requests [restrict/default]`, `settlement_wage_statutory_discharges.payslip_id → payslips [restrict/default]`, `settlement_wage_statutory_discharges.company_id → companies [restrict/default]`, `settlement_wage_statutory_discharges.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/settlement_wage_statutory_discharges/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/prior-statutory-credit-reversal.ts`, `src/lib/prior-wage-credit-lifecycle.ts` (remaining literal references counted in the inventory).

### sg_cpf_recoveries

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `contribution_month:text`, `failure_cause:enum`, `failure_evidence_reference:text`, `should_have_recovered_on:date`, `employee_share:decimal`, `board_paid_on:date`, `board_payment_reference:text`, `consent_forwarded_on:date`, `consent_reference:text`, `board_permission_on:date`, `board_permission_reference:text`, `recover_on:date`, `authorised_amount:decimal`, `state:state`, `recovery_reference:text`.
- Identity constraints: unique [ { "fields": [ "employment_id", "contribution_month", "reference" ] } ]; noOverlap —.
- Explicit state: state.
- Relationships: `sg_cpf_recoveries.employment_id → employments [restrict/default]`.
- Collection: `src/data/collection/sg_cpf_recoveries/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### sg_cpf_refund_cases

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `source_findings:json:opaque`, `reference:text`, `contribution_month:text`, `reason:enum`, `original_board_paid_on:date`, `original_board_payment_reference:text`, `conditional_repayable_on:date`, `conditional_agreement_reference:text`, `reassessment_reference:text`, `revised_employee_cpf:decimal`, `revised_employer_cpf:decimal`, `source_capture_references:text`, `original_employee_cpf:decimal`, `original_employer_cpf:decimal`, `employee_refund_due:decimal`, `employer_refund_due:decimal`, `employee_notified_on:date`, `employee_notification_reference:text`, `dispute_resolved_reference:text`, `employee_refunded_on:date`, `employee_refund_reference:text`, `employee_refunded_amount:decimal`, `application_on:date`, `application_reference:text`, `deadline_on:date`, `state:state`, `decision_on:date`, `decision_reference:text`, `approved_refund:decimal`, `board_refunded_on:date`, `board_refund_reference:text`, `board_refunded_amount:decimal`.
- Identity constraints: unique [ { "fields": [ "original_payslip_id" ] } ]; noOverlap —.
- Explicit state: state.
- Relationships: `sg_cpf_refund_cases.employment_id → employments [restrict/default]`, `sg_cpf_refund_cases.original_payslip_id → payslips [restrict/default]`, `sg_cpf_refund_cases.corrected_declaration_id → sg_cpf_wage_declarations [restrict/default]`.
- Collection: `src/data/collection/sg_cpf_refund_cases/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### sg_cpf_wage_declarations

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `csn:text`, `contribution_month:text`, `sequence:int`, `purpose:enum`, `corrected_wage_allocations:custom`, `actual_ow:decimal`, `actual_aw:decimal`, `mandatory_cpf:decimal`, `wage_basis_reference:text`, `submitted_on:date`, `state:state`, `accepted_on:date`, `acceptance_reference:text`, `rejection_reference:text`.
- Identity constraints: unique [ { "fields": [ "company_id", "employee_id", "csn", "contribution_month", "sequence" ] }, { "fields": [ "company_id", "reference" ] } ]; noOverlap —.
- Explicit state: state.
- Relationships: `sg_cpf_wage_declarations.company_id → companies [restrict/default]`, `sg_cpf_wage_declarations.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/sg_cpf_wage_declarations/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### sg_sdl_cases

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move authority assessment/application/decision documentary inputs to the actual payer entity JSON; retain actual levy cash/refund/set-off allocations as generic operational records.
- Fields: `reference:text`, `contribution_month:text`, `kind:enum`, `state:state`, `amount_liability:decimal`, `amount_paid:decimal`, `payment_reference:text`, `served_on:date`, `objection_on:date`, `objection_grounds:text`, `extension_through:date`, `extension_reference:text`, `application_on:date`, `application_reference:text`, `payroll_register_reference:text`, `refund_account_reference:text`, `decision_on:date`, `decision_reference:text`, `approved_amount:decimal`, `penalty_demanded:decimal`, `penalty_remitted:decimal`, `penalty_reference:text`, `settled_on:date`, `settlement_reference:text`, `amount_settled:decimal`, `set_off_target_month:text`, `set_off_certificate_reference:text`, `deadline_on:date`.
- Identity constraints: unique [ { "fields": [ "company_id", "reference" ] } ]; noOverlap —.
- Explicit state: state.
- Relationships: `sg_sdl_cases.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/sg_sdl_cases/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### sg_sdl_foreign_wages

- Target: **INPUT_MOVE_TO_ENTITY_JSON**. Move **all authored fields listed below** to governing entity JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `scheme_code:text`, `remittance_primary_route:bool`, `employee_amount:decimal`, `employer_amount:decimal`, `reference:text`, `contribution_month:text`, `currency:currency`, `foreign_total_wages:decimal`, `wage_register_reference:text`, `sgd_per_currency_unit:decimal`, `published_bank:text`, `major_local_bank_confirmed:bool`, `rate_published_on:date`, `rate_source_reference:text`, `service_scope:enum`, `service_scope_reference:text`, `non_exempt_confirmed:bool`, `non_exempt_reference:text`, `sgd_total_wages:decimal`, `pricing_settings_reference:text`, `pricing_contribution_reference:text`, `employer_sdl:decimal`.
- Identity constraints: unique [ { "fields": [ "employment_id", "contribution_month" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `sg_sdl_foreign_wages.employment_id → employments [restrict/default]`.
- Collection: `src/data/collection/sg_sdl_foreign_wages/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### shift_definitions

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `code:text`, `name:text`, `variant:custom`, `effective_range:period`.
- Identity constraints: unique [{ fields: ['company_id', 'code'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `shift_definitions.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/shift_definitions/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/reimbursement.ts`, `src/lib/checks.ts`, `src/lib/every-field.ts` (remaining literal references counted in the inventory).

### shift_patterns

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `code:text`, `name:text`, `pattern:custom`, `effective_range:period`.
- Identity constraints: unique [{ fields: ['company_id', 'code'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `shift_patterns.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/shift_patterns/+collection.ts`. Runtime consumer examples: `src/lib/checks.ts`, `src/lib/every-field.ts`, `src/lib/leave/context.ts` (remaining literal references counted in the inventory).

### source_cash_payments

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `payment_method:enum`, `payment_account_reference:text`, `payment_method_source:json:opaque`, `payment_method_source_file:file`, `payment_method_assessment:json:opaque`, `source_system:text`, `source_payment_id:text`, `payment_reference:text`, `full_account_source_request_key:text`, `full_account_source_receipt_key:text`, `recipient_reference:text`, `service_history_kind:text`, `settlement_ledger_reference:text`, `settled_service_from:date`, `settled_service_through:date`, `settled_service_units:decimal`, `paid_on:date`, `currency:currency`, `cash_amount:money`, `receipt_cash_total:money`, `award_reference:text`, `settlement_basis:enum`, `component_bucket:text`, `withholding_scheme_binding:text`, `gross_settled_amount:money`, `tax_withheld_amount:money`, `other_deductions_amount:money`, `withholding_allocation_reference:text`, `withholding_evidence_file:file`, `allocation_reference:text`, `evidence_file:file`, `component_code:text`, `component_amount:money`.
- Identity constraints: unique [{ fields: ['source_system', 'source_payment_id', 'adhoc_request_id'] }, { fields: ['full_account_source_request_key'], where: { settlement_basis: { eq: 'EMPLOYER_ACCOUNT_TRANSFER' } } }, { fields: ['full_account_source_receipt_key'], where: { settlement_basis: { eq: 'EMPLOYER_ACCOUNT_TRANSFER' } } }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `source_cash_payments.adhoc_request_id → adhoc_requests [restrict/default]`, `source_cash_payments.employment_id → employments [restrict/default]`, `source_cash_payments.employee_id → employees [restrict/default]`, `source_cash_payments.company_id → companies [restrict/default]`, `source_cash_payments.payslip_id → payslips [restrict/default]`, `source_cash_payments.payment_event_id → payment_events [restrict/default]`.
- Collection: `src/data/collection/source_cash_payments/+collection.ts`. Runtime consumer examples: `src/lib/award-cash-channel.ts`, `src/lib/component-payment-agreement.ts`, `src/lib/component_entry_cap_subject.ts` (remaining literal references counted in the inventory).

### statutory_account_credit_sources

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `credit_subject_key:text`, `reference:text`, `annual_register_reference:text`, `beneficiary_account_reference:text`, `eligibility_reference:text`, `eligibility_evidence_keys:text`, `zero_usage_reference:text`, `year:int`, `usage_through:date`, `usage_receipts:custom`, `eligibility_facts:custom`, `scheme_code:text`, `contribution_month:text`, `pricing_settings_reference:text`, `pricing_contribution_reference:text`, `usage_receipt_references:text`, `usage_amount:decimal`, `employee_amount:decimal`, `employer_amount:decimal`, `currency:currency`, `remittance_primary_route:bool`.
- Identity constraints: unique [ { "fields": ["credit_subject_key"] }, { "fields": [ "employment_id", "statutory_contribution_id", "year" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `statutory_account_credit_sources.employment_id → employments [restrict/default]`, `statutory_account_credit_sources.employment_terms_id → employment_terms [restrict/default]`, `statutory_account_credit_sources.statutory_contribution_id → statutory_contributions [restrict/default]`.
- Collection: `src/data/collection/statutory_account_credit_sources/+collection.ts`. Runtime consumer examples: `src/lib/catalogue_rules.ts`, `src/lib/every-field.ts`.

### statutory_compensation_receipts

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `receipt_reference:text`, `paid_attributions:custom`, `designated_on:date`, `paid_on:date`, `received_on:date`, `currency:text`, `amount:decimal`, `recipient_kind:enum`, `recipient_reference:text`, `discharge_basis:enum`, `payment_reference:text`, `payment_file:file`, `compensation_reference:text`, `compensation_file:file`, `covered_range:period`.
- Identity constraints: unique [{ fields: ['benefit_case_id', 'receipt_reference'] }, { fields: ['payment_reference', 'recipient_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `statutory_compensation_receipts.benefit_case_id → benefit_cases [restrict/default]`.
- Collection: `src/data/collection/statutory_compensation_receipts/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### statutory_compensation_remainders

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `effective_on:date`, `authority_reference:text`, `authority_file:file`, `currency:currency`, `released_amount:money`, `paid_amount:money`, `payment_source_ids:json:opaque`.
- Identity constraints: unique [{ fields: ['statutory_compensation_settlement_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `statutory_compensation_remainders.statutory_compensation_settlement_id → statutory_compensation_settlements [restrict/default]`, `statutory_compensation_remainders.benefit_case_assessment_id → benefit_case_assessments [restrict/default]`.
- Collection: `src/data/collection/statutory_compensation_remainders/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/certified-assessment.ts`, `src/lib/every-field.ts`, `src/lib/payroll/run/clearance-filing.ts`.

### statutory_compensation_settlements

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `basis:enum`, `invoice_reference:text`, `portion_reference:text`, `assessment_portion_reference:text`, `route_on:date`, `reference:text`, `assessment_on:date`, `certified_period_ids:json:shaped`, `covered_range:period`, `currency:currency`, `gross_amount:money`, `due_on:date`, `recipient_kind:enum`, `recipient_reference:text`, `snapshot:custom`, `status:enum`, `cancelled_on:date`, `cancellation_reference:text`, `cancellation_file:file`.
- Identity constraints: unique [{ fields: ['benefit_case_id', 'benefit_case_assessment_recipient_id'], where: { basis: { eq: 'LUMP_SUM' }, status: { eq: 'ACTIVE' } } }, { fields: ['benefit_case_id', 'reference'] }, { fields: ['benefit_case_id', 'benefit_case_expense_portion_id'], where: { basis: { eq: 'EVIDENCED_EXPENSES' }, status: { eq: 'ACTIVE' } } }]; noOverlap [{ key: ['benefit_case_id'], period: 'covered_range', where: { status: { eq: 'ACTIVE' }, basis: { eq: 'CERTIFIED_INTERVALS' } }, name: 'statutory_compensation_active_days' }].
- Explicit state: status.
- Relationships: `statutory_compensation_settlements.benefit_case_assessment_recipient_id → benefit_case_assessment_recipients [restrict/default]`, `statutory_compensation_settlements.benefit_case_id → benefit_cases [restrict/default]`, `statutory_compensation_settlements.benefit_case_period_id → benefit_case_periods [restrict/default]`, `statutory_compensation_settlements.benefit_case_expense_portion_id → benefit_case_expense_portions [restrict/default]`, `statutory_compensation_settlements.company_id → companies [restrict/default]`, `statutory_compensation_settlements.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/statutory_compensation_settlements/+collection.ts`. Runtime consumer examples: `src/lib/benefit-cases/certified-assessment.ts`, `src/lib/benefit-cases/refund-sources.ts`, `src/lib/every-field.ts` (remaining literal references counted in the inventory).

### statutory_contributions

- Target: **OPERATIONAL_KEEP**. Retain generic immutable scheme configuration infrastructure as a snapshot artifact; jurisdiction-authored legal inputs and bespoke extension fields belong to snapshot schema/value payloads, not permanent source-level columns.
- Fields: `refund_replacement_policy:custom`, `wage_net_receiver:custom`, `foreign_wage_source:json:opaque`, `wage_declaration_source:text`, `irreversible_election:json:opaque`, `certificate_policy:json:opaque`, `unit_assessment_source:json:opaque`, `minimum_due_source:custom`, `code:text`, `agency_assessment_policy:text`, `agency_assessment_when:text`, `agency_assessment_sources:json:shaped`, `name:text`, `authority:text`, `assessment_period:enum`, `monthly_employee_cutoff:enum`, `assessment_scope:enum`, `remittance_route:text`, `remittance_external_assessments:text`, `account_credit_budget:decimal`, `account_credit_when:text`, `remittance_route_scope:enum`, `remittance_primary_route_when:text`, `uniform_context_excluded_wages:text`, `uniform_native_context_when:text`, `remittance_due_when:text`, `remittance_due_date:text`, `remittance_late_allocation:enum`, `remittance_dependency_scheme:text`, `remittance_without_dependency_route:text`, `remittance_rounding:enum`, `remittance_rounding_when:text`, `late_line_month:enum`, `unregistered_action:enum`, `registration_subject:enum`, `opening_scope:enum`, `elections:custom`, `employee_share_annual_cap:int`, `shared_cap_group:text`, `project_relief_annually:bool`, `rules:custom`, `assessed_on:text`, `cash_reporting:json:shaped`, `assessment_person_on:enum`, `annual_history_partition:text`, `annual_history_selection:text`, `annual_history_selection_when:text`, `wage_exempt_when:text`, `native_scope_capture:bool`, `native_scope_person_context:enum`, `residency_ordinary_on:text`, `residency_additional_on:text`, `base_when:json:shaped`, `parts:custom`, `ordinary_on:text`, `employee_external_payment:text`, `history_trigger:json:shaped`, `deduction_categories:json:shaped`, `child_claims_hint:text`, `short_name:text`, `listing_order:int`, `listing_group:text`.
- Identity constraints: unique [{ fields: ['settings_id', 'code'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `statutory_contributions.settings_id → jurisdiction_settings [owned]`.
- Collection: `src/data/collection/statutory_contributions/+collection.ts`. Runtime consumer examples: `src/lib/catalogue_rules.ts`, `src/lib/component_entry_cap_subject.ts`, `src/lib/datatypes/case_types.ts` (remaining literal references counted in the inventory).

### statutory_employee_refund_liabilities

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `due_reference:text`, `recipient_reference:text`, `due_on:date`, `recorded_on:date`, `currency:currency`, `gross_amount:money`, `snapshot:json:opaque`, `due_file:file`, `recipient_identity_file:file`.
- Identity constraints: unique [ { "fields": [ "statutory_refund_receipt_id" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `statutory_employee_refund_liabilities.statutory_refund_receipt_id → statutory_refund_receipts [restrict/default]`, `statutory_employee_refund_liabilities.company_id → companies [restrict/default]`, `statutory_employee_refund_liabilities.employee_id → employees [restrict/default]`, `statutory_employee_refund_liabilities.employment_id → employments [restrict/default]`.
- Collection: `src/data/collection/statutory_employee_refund_liabilities/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/statutory-refund-financial.ts`, `src/lib/statutory-refund-payment.ts`.

### statutory_employee_refunds

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `source_system:text`, `source_payment_id:text`, `payment_reference:text`, `allocation_reference:text`, `payer_reference:text`, `recipient_reference:text`, `paid_on:date`, `received_on:date`, `known_on:date`, `cash_amount:money`, `receipt_cash_total:money`, `bank_file:file`, `employee_receipt_file:file`, `parties_file:file`, `currency:currency`, `snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "source_system", "source_payment_id", "allocation_reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `statutory_employee_refunds.statutory_refund_receipt_id → statutory_refund_receipts [restrict/default]`, `statutory_employee_refunds.company_id → companies [restrict/default]`, `statutory_employee_refunds.employee_id → employees [restrict/default]`, `statutory_employee_refunds.employment_id → employments [restrict/default]`, `statutory_employee_refunds.payment_event_id → payment_events [restrict/default]`.
- Collection: `src/data/collection/statutory_employee_refunds/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/prior-statutory-credit-restoration.ts`, `src/lib/statutory-refund-payment.ts` (remaining literal references counted in the inventory).

### statutory_personal_assessments

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `settings_code:text`, `source_identity:text`, `source_namespace:text`, `currency:currency`, `source_snapshot:json:opaque`, `evidence_snapshot:json:opaque`, `member_unit_key:text`, `liability_unit:date`, `liability_key:text`, `payer_reference:text`, `fund_reference:text`, `scheme_code:text`, `due_on:date`, `assessed_on:date`, `amount_due:money`, `register_on:date`, `opening_credit_count:int`, `opening_credit_amount:money`, `opening_register_reference:text`, `calculation_snapshot:json:opaque`, `policy_snapshot:json:opaque`, `pricing_settings_id:text`, `source_from:date`, `source_through:date`.
- Identity constraints: unique [ { "fields": [ "liability_key" ] }, { "fields": [ "history_id" ] }, { "fields": [ "member_unit_key" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `statutory_personal_assessments.employee_id → employees [restrict/default]`, `statutory_personal_assessments.history_id → employment_history [restrict/default]`.
- Collection: `src/data/collection/statutory_personal_assessments/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/statutory-personal-fund.ts`.

### statutory_personal_receipts

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `settings_code:text`, `source_identity:text`, `source_namespace:text`, `currency:currency`, `bank_source_snapshot:json:opaque`, `source_snapshot:json:opaque`, `evidence_snapshot:json:opaque`, `known_source_snapshots:json:opaque`, `receipt_key:text`, `paid_on:date`, `credited_amount:money`.
- Identity constraints: unique [ { "fields": [ "receipt_key" ] }, { "fields": [ "history_id" ] }, { "fields": [ "known_source_history_id" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `statutory_personal_receipts.employee_id → employees [restrict/default]`, `statutory_personal_receipts.history_id → employment_history [restrict/default]`, `statutory_personal_receipts.known_source_history_id → employment_history [restrict/default]`, `statutory_personal_receipts.assessment_id → statutory_personal_assessments [restrict/default]`.
- Collection: `src/data/collection/statutory_personal_receipts/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/statutory-personal-fund.ts`.

### statutory_refund_receipts

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `assessment_source:text`, `source_system:text`, `source_payment_id:text`, `payment_reference:text`, `allocation_reference:text`, `payer_reference:text`, `recipient_reference:text`, `paid_on:date`, `received_on:date`, `known_on:date`, `employee_refund_amount:money`, `employer_refund_amount:money`, `receipt_cash_total:money`, `bank_file:file`, `authority_refund_file:file`, `original_source_allocation_file:file`, `employee_share_direction_file:file`, `currency:currency`, `snapshot:json:opaque`, `contribution_month:text`.
- Identity constraints: unique [ { "fields": [ "source_system", "source_payment_id", "allocation_reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `statutory_refund_receipts.statutory_remittance_id → statutory_remittances [restrict/default]`, `statutory_refund_receipts.company_id → companies [restrict/default]`, `statutory_refund_receipts.employee_id → employees [restrict/default]`, `statutory_refund_receipts.employment_id → employments [restrict/default]`.
- Collection: `src/data/collection/statutory_refund_receipts/+collection.ts`. Runtime consumer examples: `src/lib/conditional-authority-refunds.ts`, `src/lib/every-field.ts`, `src/lib/prior-statutory-credit-reversal.ts` (remaining literal references counted in the inventory).

### statutory_remittance_acknowledgements

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `actor_kind:enum`, `cpf_csn:text`, `contribution_month:date`, `currency:currency`, `received_on:date`, `source_allocations:json:opaque`, `original_board_receipt_file:file`, `original_acknowledgment:json:opaque`.
- Identity constraints: unique [{ fields: ['statutory_remittance_id'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `statutory_remittance_acknowledgements.statutory_remittance_id → statutory_remittances [restrict/default]`.
- Collection: `src/data/collection/statutory_remittance_acknowledgements/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/platform-work/fund-received.ts`.

### statutory_remittance_allocations

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `scheme_code:text`, `share:enum`, `currency:currency`, `amount_paid:money`.
- Identity constraints: unique [{ fields: ['statutory_remittance_event_id', 'payslip_id', 'scheme_code', 'share'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `statutory_remittance_allocations.statutory_remittance_event_id → statutory_remittance_events [owned]`, `statutory_remittance_allocations.payslip_id → payslips [restrict/default]`.
- Collection: `src/data/collection/statutory_remittance_allocations/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### statutory_remittance_events

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `paid_on:date`, `reference:text`, `authority_reference:text`, `return_reference:text`, `receipt_file:file`, `allocation_file:file`, `currency:currency`, `amount_paid:money`.
- Identity constraints: unique [{ fields: ['company_id', 'reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `statutory_remittance_events.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/statutory_remittance_events/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### statutory_remittances

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `actor_kind:enum`, `currency:currency`, `cpf_csn:text`, `platform_assessment_ids:json:opaque`, `platform_fund_allocations:json:opaque`, `original_fund_board_file:file`, `received_on:date`, `original_fund_received_file:file`, `original_fund_bank_file:file`, `original_platform_assessment_sources:json:opaque`, `bank_document_sha256:text`, `original_platform_fund_payment:json:opaque`, `scheme_code:text`, `scope:enum`, `selected_route:text`, `reference:text`, `contribution_month:text`, `state:state`, `route:text`, `amount_due:decimal`, `routing_dependency_amount:decimal`, `paid_on:date`, `amount_paid:decimal`, `payment_reference:text`, `payment_source_allocations:custom`, `source_capture_references:text`, `submission_sequence:int`.
- Identity constraints: unique [ { "fields": ["platform_operator_id", "contribution_month", "cpf_csn"], "where": { "actor_kind": { "eq": "PLATFORM" }, "state": { "eq": "OPEN" } } }, { "fields": ["platform_operator_id", "payment_reference"], "where": { "actor_kind": { "eq": "PLATFORM" }, "state": { "eq": "PAID" } } }, { "fields": ["platform_operator_id", "bank_document_sha256"], "where": { "actor_kind": { "eq": "PLATFORM" }, "state": { "eq": "PAID" } } }, { "fields": [ "employment_id", "contribution_month", "submission_sequence", "scope", "scheme_code", "route" ] }, { "fields": [ "employment_id", "contribution_month", "scope", "scheme_code", "route" ], "where": { "state": { "eq": "OPEN" } } } ]; noOverlap —.
- Explicit state: state.
- Relationships: `statutory_remittances.employment_id → employments [restrict/default]`, `statutory_remittances.platform_operator_id → platform_operators [restrict/default]`, `statutory_remittances.platform_worker_id → platform_workers [restrict/default]`.
- Collection: `src/data/collection/statutory_remittances/+collection.ts`. Runtime consumer examples: `src/lib/conditional-annual-source.ts`, `src/lib/conditional-authority-refunds.ts`, `src/lib/conditional-original-qualification.ts` (remaining literal references counted in the inventory).

### statutory_wage_record_deliveries

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `delivered_on:date`, `delivery_file:file`, `recorded_at:instant`, `documentary_source:json:opaque`.
- Identity constraints: unique [ { "fields": [ "issue_id" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `statutory_wage_record_deliveries.issue_id → statutory_wage_record_issues [restrict/default]`, `statutory_wage_record_deliveries.company_id → companies [restrict/default]`, `statutory_wage_record_deliveries.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/statutory_wage_record_deliveries/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### statutory_wage_record_issues

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `issuer_name:text`, `issued_on:date`, `signature_file:file`, `statement_file:file`, `recorded_at:instant`, `issued_output:json:opaque`, `documentary_source:json:opaque`.
- Identity constraints: unique [ { "fields": [ "wage_record_id" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `statutory_wage_record_issues.wage_record_id → statutory_wage_records [restrict/default]`, `statutory_wage_record_issues.company_id → companies [restrict/default]`, `statutory_wage_record_issues.employee_id → employees [restrict/default]`.
- Collection: `src/data/collection/statutory_wage_record_issues/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### statutory_wage_records

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `origin:enum`, `original_record_cash:json:shaped`, `original_record_file:file`, `correction_reference:text`, `correction_file:file`, `reference:text`, `duty_code:text`, `partition_reference:text`, `wage_component_codes:list`, `other_remuneration_component_codes:list`, `nonremuneration_component_codes:list`, `actual_employee_deduction_on:date`, `actual_employee_deduction_amount:decimal`, `withholding_reference:text`, `withholding_file:file`, `particulars:json:shaped`, `particulars_file:file`, `partition_file:file`, `recorded_at:instant`, `recorded_on:date`, `retain_through_on:date`, `authority:text`, `kind:enum`, `currency:currency`, `output:json:opaque`, `financial_source:json:opaque`, `partition_source:json:opaque`, `documentary_source:json:opaque`, `policy_snapshot:json:opaque`.
- Identity constraints: unique [ { "fields": [ "replaces_id" ], "where": { "replaces_id": { "isNull": false } } }, { "fields": [ "company_id", "employee_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `statutory_wage_records.replaces_id → statutory_wage_records [restrict/default]`, `statutory_wage_records.payslip_id → payslips [restrict/default]`, `statutory_wage_records.company_id → companies [restrict/default]`, `statutory_wage_records.employee_id → employees [restrict/default]`, `statutory_wage_records.employment_id → employments [restrict/default]`, `statutory_wage_records.settings_id → jurisdiction_settings [restrict/default]`.
- Collection: `src/data/collection/statutory_wage_records/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### tax_clearance_cases

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `trigger:text`, `trigger_on:date`, `awareness_on:date`, `citizenship:text`, `facts:custom`, `evidence_file:file`, `clearance_required:bool`, `decision_basis:text`, `notice_due_on:date`, `annual_return_required:bool`, `needs_external_check:bool`, `event_role:enum`, `reference_label:text`, `hold_category:enum`.
- Identity constraints: unique [{ fields: ['employment_id', 'trigger', 'trigger_on'], where: { income_event_id: { isNull: true } } }, { fields: ['income_event_id'], where: { income_event_id: { isNull: false } } }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `tax_clearance_cases.income_event_id → employment_income_events [restrict/default]`, `tax_clearance_cases.employment_id → employments [restrict/default]`.
- Collection: `src/data/collection/tax_clearance_cases/+collection.ts`. Runtime consumer examples: `src/lib/employment-contract.ts`, `src/lib/every-field.ts`, `src/lib/leave/exit-settlement.ts`.

### tax_credit_correction_cases

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `currency:currency`, `tax_year:int`, `notice_on:date`, `notice_reference:text`, `issuing_authority_reference:text`, `notice_file:file`, `reason:enum`, `disallowed_credit:decimal`, `assessed_principal:decimal`, `assessed_interest:decimal`, `assessed_penalties:decimal`, `application_history_complete:bool`, `reconciliation_reference:text`, `reconciliation_file:file`, `applications_digest:text`, `payment_on:date`, `payment_amount:decimal`, `payment_reference:text`, `payment_file:file`.
- Identity constraints: unique [{ fields: ['issuing_authority_reference', 'notice_reference', 'certificate_id', 'tax_year'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `tax_credit_correction_cases.company_id → companies [restrict/default]`, `tax_credit_correction_cases.employee_id → employees [restrict/default]`, `tax_credit_correction_cases.certificate_id → approved_tax_credit_certificates [restrict/default]`.
- Collection: `src/data/collection/tax_credit_correction_cases/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/run/annual-employer-export.ts`, `src/lib/payroll/world.ts` (remaining literal references counted in the inventory).

### training_service_recoveries

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `source:json:opaque`, `source_file:file`, `currency:currency`, `identity:text`, `training_cost_identity:text`, `maximum_recoverable_amount:money`, `opening_remaining_recoverable_amount:money`, `snapshot:json:opaque`.
- Identity constraints: unique [{fields:['identity']},{fields:['training_cost_identity']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `training_service_recoveries.company_id → companies [restrict/default]`, `training_service_recoveries.employee_id → employees [restrict/default]`, `training_service_recoveries.employment_id → employments [restrict/default]`, `training_service_recoveries.catalogue_id → adhoc_catalogue [restrict/default]`.
- Collection: `src/data/collection/training_service_recoveries/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### training_service_recovery_cash

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `liability_findings:json:opaque`, `claim_identity:text`, `reference:text`, `decision_reference:text`, `paid_on:date`, `currency:currency`, `amount:money`, `evidence_file:file`, `allocation_file:file`.
- Identity constraints: unique [{fields:['company_id','employee_id','reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `training_service_recovery_cash.company_id → companies [restrict/default]`, `training_service_recovery_cash.employee_id → employees [restrict/default]`, `training_service_recovery_cash.employment_id → employments [restrict/default]`.
- Collection: `src/data/collection/training_service_recovery_cash/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### valuation_forex_policies

- Target: **NEEDS_EVIDENCE**. Separate immutable configuration-snapshot policy definitions from entity-authored original source values. Both must be snapshot-driven; resolve whether any generic operational identity remains before retiring the dedicated policy model.
- Fields: `providers:json:opaque`, `method:text`, `source_provider:text`, `source_reference:text`, `source_evidence_file:file`, `communicated_on:date`, `communication_reference:text`, `communication_evidence_file:file`.
- Identity constraints: unique [{fields:['company_id']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `valuation_forex_policies.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/valuation_forex_policies/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/run/income-reporting.ts`, `src/lib/payroll/run/income-valuation-forex.ts`.

### wage_assessment_charge_allocations

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `assessment_source:text`, `allocation_reference:text`, `scheme_code:text`, `allocation_basis:enum`, `effective_on:date`, `known_on:date`, `currency:currency`, `employee_amount:money`, `employer_amount:money`, `allocations:json:opaque`, `snapshot:json:opaque`, `allocation_file:file`.
- Identity constraints: unique [ { "fields": [ "assessment_source" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `wage_assessment_charge_allocations.wage_assessment_declaration_id → wage_assessment_declarations [restrict/default]`, `wage_assessment_charge_allocations.payslip_id → payslips [restrict/default]`, `wage_assessment_charge_allocations.company_id → companies [restrict/default]`, `wage_assessment_charge_allocations.employee_id → employees [restrict/default]`, `wage_assessment_charge_allocations.employment_id → employments [restrict/default]`, `wage_assessment_charge_allocations.settings_id → jurisdiction_settings [restrict/default]`, `wage_assessment_charge_allocations.contribution_id → statutory_contributions [restrict/default]`.
- Collection: `src/data/collection/wage_assessment_charge_allocations/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/wage-charge-allocation.ts`.

### wage_credit_redeliveries

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `source_system:text`, `source_payment_id:text`, `payment_reference:text`, `allocation_reference:text`, `payer_reference:text`, `recipient_reference:text`, `paid_on:date`, `available_on:date`, `known_on:date`, `cash_amount:money`, `receipt_cash_total:money`, `currency:currency`, `snapshot:json:opaque`, `bank_file:file`, `employee_receipt_file:file`, `parties_file:file`, `assessment_basis:enum`.
- Identity constraints: unique [ { "fields": [ "source_system", "source_payment_id", "allocation_reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `wage_credit_redeliveries.wage_paid_credit_reversal_id → wage_paid_credit_reversals [restrict/default]`, `wage_credit_redeliveries.source_cash_payment_id → source_cash_payments [restrict/default]`, `wage_credit_redeliveries.company_id → companies [restrict/default]`, `wage_credit_redeliveries.employee_id → employees [restrict/default]`, `wage_credit_redeliveries.wage_debt_id → wage_debts [restrict/default]`, `wage_credit_redeliveries.source_request_id → adhoc_requests [restrict/default]`.
- Collection: `src/data/collection/wage_credit_redeliveries/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/historical-credit-lifecycle.ts`, `src/lib/original-credit-reservations.ts` (remaining literal references counted in the inventory).

### wage_debt_payments

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `cash_available_on:date`, `amount:decimal`, `payment_reference:text`, `satisfaction_basis_reference:text`, `evidence_file:file`.
- Identity constraints: unique [{fields:['settlement_wage_cash_payment_id']},{fields:['settlement_wage_statutory_discharge_id']},{fields:['wage_credit_redelivery_id']},{fields:['prior_wage_credit_redelivery_id']},{fields:['prior_statutory_credit_restoration_id']},{fields:['historical_prior_credit_redelivery_id']},{fields:['receivable_distribution_id']},{ fields: ['wage_debt_id', 'payment_reference'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `wage_debt_payments.prior_wage_credit_redelivery_id → prior_wage_credit_redeliveries [restrict/default]`, `wage_debt_payments.wage_credit_redelivery_id → wage_credit_redeliveries [restrict/default]`, `wage_debt_payments.settlement_wage_statutory_discharge_id → settlement_wage_statutory_discharges [restrict/default]`, `wage_debt_payments.settlement_wage_cash_payment_id → source_cash_payments [restrict/default]`, `wage_debt_payments.receivable_distribution_id → receivable_distributions [restrict/default]`, `wage_debt_payments.prior_statutory_credit_restoration_id → prior_statutory_credit_restorations [restrict/default]`, `wage_debt_payments.historical_prior_credit_redelivery_id → historical_prior_credit_redeliveries [restrict/default]`, `wage_debt_payments.wage_debt_id → wage_debts [restrict/default]`, `wage_debt_payments.source_request_id → adhoc_requests [restrict/default]`.
- Collection: `src/data/collection/wage_debt_payments/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/historical-credit-lifecycle.ts`, `src/lib/original-credit-reservations.ts` (remaining literal references counted in the inventory).

### wage_debts

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `original_paid_net_floor_source:json:opaque`, `original_paid_net_floor_capture:json:opaque`, `original_paid_net_floor_key:text`, `reference:text`, `original_order_reference:text`, `source_kind:enum`, `lawful_head:enum`, `source_reference:text`, `original_start:date`, `original_end:date`, `due_on:date`, `issued_on:date`, `received_on:date`, `receipt_reference:text`, `currency:currency`, `principal_amount:decimal`, `prior_satisfaction:decimal`, `prior_satisfaction_reference:text`, `settlement_catalogue_code:text`, `settlement_basis_reference:text`, `evidence_file:file`.
- Identity constraints: unique [{fields:['registered_settlement_head_id']},{ fields: ['company_id', 'employee_id', 'original_order_reference', 'lawful_head'] }, {fields:['original_paid_net_floor_key']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `wage_debts.registered_settlement_head_id → registered_settlement_heads [restrict/default]`, `wage_debts.company_id → companies [restrict/default]`, `wage_debts.parent_debt_id → wage_debts [restrict/default]`, `wage_debts.employee_id → employees [restrict/default]`, `wage_debts.employment_id → employments [restrict/default]`, `wage_debts.journey_source_id → wage_journey_sources [restrict/default]`.
- Collection: `src/data/collection/wage_debts/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/original-paid-net-floor.ts`, `src/lib/prior-wage-credit-lifecycle.ts` (remaining literal references counted in the inventory).

### wage_journey_sources

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `actual_range:period`, `payment_route:enum`, `valuation_scope_reference:text`, `leave_continuation_reference:text`, `current_day_sources:json:opaque`, `original_journey_reference:text`, `departure_at:text`, `arrival_at:text`, `recognised_home_to_work:bool`, `recognition_reference:text`, `original_scope_reference:text`, `original_roster_reference:text`, `original_cash_valuation_reference:text`, `source_file:file`, `original_salary_payslip_ids:json:shaped`, `currency:currency`, `timezone:text`, `policy_snapshot:json:shaped`, `day_allocations:json:shaped`, `cash_sources:json:shaped`.
- Identity constraints: unique [{ fields: ['company_id', 'employee_id', 'original_journey_reference'] }, { fields: ['company_id', 'employee_id', 'departure_at', 'arrival_at'] }]; noOverlap [{ key: ['company_id', 'employee_id'], period: 'actual_range', name: 'wage_journey_sources_no_overlap' }].
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `wage_journey_sources.company_id → companies [restrict/default]`, `wage_journey_sources.employee_id → employees [restrict/default]`, `wage_journey_sources.employment_id → employments [restrict/default]`, `wage_journey_sources.catalogue_id → adhoc_catalogue [restrict/default]`, `wage_journey_sources.settings_id → jurisdiction_settings [restrict/default]`.
- Collection: `src/data/collection/wage_journey_sources/+collection.ts`. Runtime consumer examples: `src/lib/actual-journey.ts`, `src/lib/every-field.ts`, `src/lib/payroll/journey-payroll.ts` (remaining literal references counted in the inventory).

### wage_paid_credit_reversals

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `authority_reference:text`, `issued_on:date`, `known_on:date`, `effective_on:date`, `credit_reversal_amount:money`, `currency:currency`, `snapshot:json:opaque`, `authority_file:file`, `original_credit_binding_file:file`.
- Identity constraints: unique [ { "fields": [ "wage_source_cash_return_id", "reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `wage_paid_credit_reversals.wage_source_cash_return_id → wage_source_cash_returns [restrict/default]`, `wage_paid_credit_reversals.wage_debt_payment_id → wage_debt_payments [restrict/default]`, `wage_paid_credit_reversals.source_cash_payment_id → source_cash_payments [restrict/default]`, `wage_paid_credit_reversals.company_id → companies [restrict/default]`, `wage_paid_credit_reversals.employee_id → employees [restrict/default]`, `wage_paid_credit_reversals.wage_debt_id → wage_debts [restrict/default]`, `wage_paid_credit_reversals.source_request_id → adhoc_requests [restrict/default]`.
- Collection: `src/data/collection/wage_paid_credit_reversals/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/paid-wage-credit-lifecycle.ts`, `src/lib/paid-wage-credit-projection.ts` (remaining literal references counted in the inventory).

### wage_source_cash_returns

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `source_system:text`, `source_payment_id:text`, `payment_reference:text`, `allocation_reference:text`, `payer_reference:text`, `recipient_reference:text`, `paid_on:date`, `available_on:date`, `known_on:date`, `cash_amount:money`, `receipt_cash_total:money`, `currency:currency`, `snapshot:json:opaque`, `bank_file:file`, `employer_receipt_file:file`, `parties_file:file`.
- Identity constraints: unique [ { "fields": [ "source_system", "source_payment_id", "allocation_reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `wage_source_cash_returns.prior_wage_credit_scope_id → prior_wage_credit_scopes [restrict/default]`, `wage_source_cash_returns.source_cash_payment_id → source_cash_payments [restrict/default]`, `wage_source_cash_returns.company_id → companies [restrict/default]`, `wage_source_cash_returns.employee_id → employees [restrict/default]`, `wage_source_cash_returns.wage_debt_id → wage_debts [restrict/default]`, `wage_source_cash_returns.source_request_id → adhoc_requests [restrict/default]`.
- Collection: `src/data/collection/wage_source_cash_returns/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/historical-credit-lifecycle.ts`, `src/lib/paid-wage-credit-lifecycle.ts` (remaining literal references counted in the inventory).

### wage_work_report_filings

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `office_reference:text`, `office_name:text`, `received_at:instant`, `receipt_file:file`, `original_report_sha256:text`, `original_report_reference:text`.
- Identity constraints: unique [{fields:['company_id','office_reference','reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: none declared.
- Collection: `src/data/collection/wage_work_report_filings/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### wage_work_reports

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `quarter:period`, `known_on:date`, `source_reference:text`, `source_file:file`, `scope_fact:text`, `scope_reference_fact:text`, `roster_reference_fact:text`, `selected_hours_fact:text`, `cycle_from_fact:text`, `cycle_to_fact:text`, `rest_to_fact:text`, `roster_kind:enum`, `ordinary_roster_register:json:opaque`, `normal_basis_reference:text`, `normal_day_hours:decimal`, `source_timezone:text`, `fixed_overtime_register:json:shaped`.
- Identity constraints: unique [{fields:['company_id','reference']}]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `wage_work_reports.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/wage_work_reports/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`.

### work_day_credit_revisions

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `lifecycle:state`, `reference:text`, `reason:text`, `original_election_confirmed:bool`, `original_worked_intervals:json:shaped`, `corrected_worked_intervals:json:shaped`, `dossier_file:file`, `observed_at:instant`, `original_credits:custom`, `corrected_credits:custom`, `original_source_ids:json:shaped`.
- Identity constraints: unique [{fields:['work_day_id'],where:{supersedes_revision_id:{isNull:true}}},{fields:['supersedes_revision_id'],where:{supersedes_revision_id:{isNull:false}}},{fields:['work_day_id','reference']}]; noOverlap —.
- Explicit state: lifecycle.
- Relationships: `work_day_credit_revisions.work_day_id → work_days [restrict/default]`, `work_day_credit_revisions.original_payslip_id → payslips [restrict/default]`, `work_day_credit_revisions.supersedes_revision_id → work_day_credit_revisions [restrict/default]`.
- Collection: `src/data/collection/work_day_credit_revisions/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/leave/context.ts`, `src/lib/replacement-time-revisions.ts`.

### work_days

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `work_date:date`, `worked_intervals:json:shaped`, `shift_change_events:custom`, `legal_paid_intervals:custom`, `unpaid_absence_intervals:custom`, `unpaid_absence_evidence_file:file`, `approved_leave_intervals:custom`, `approved_overtime_hours:decimal`, `overtime_consented_at:instant`, `comparable_full_time_daily_hours:decimal`, `incentive_hours:decimal`, `worksite:text`, `piece_units:decimal`, `piece_overtime_units:decimal`, `piece_unit_rate:decimal`, `requested_by:enum`, `emergency_cause:bool`, `time_off_in_lieu:bool`, `facts:custom`.
- Identity constraints: unique [{ fields: ['employment_id', 'work_date'] }]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `work_days.employment_id → employments [restrict/default]`, `work_days.shift_definition_id → shift_definitions [restrict/default]`, `work_days.worksite_id → worksites [restrict/default]`, `work_days.payslip_id → payslips [restrict/default]`.
- Collection: `src/data/collection/work_days/+collection.ts`. Runtime consumer examples: `src/lib/datatypes/payroll_trace.ts`, `src/lib/datatypes/wage_assessment.ts`, `src/lib/datatypes/wages.ts` (remaining literal references counted in the inventory).

### workforce_permit_audits

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `decision_on:date`, `outcome:enum`, `decision_reference:text`, `decision_file:file`, `rectification_due_on:date`, `revoked_places:int`, `reply_reference:text`, `reply_file:file`.
- Identity constraints: unique —; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `workforce_permit_audits.case_id → workforce_permit_cases [restrict/default]`, `workforce_permit_audits.previous_audit_id → workforce_permit_audits [restrict/default]`.
- Collection: `src/data/collection/workforce_permit_audits/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/workforce-permit-binding.ts`, `src/lib/workforce-permits.ts`.

### workforce_permit_cases

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `unit_reference:text`, `route:text`, `event:enum`, `application_on:date`, `letter_on:date`, `permit_from:date`, `permit_through:date`, `places:int`, `insurance_route:enum`, `insurance_reference:text`, `qualification_reference:text`, `qualification_file:file`, `letter_reference:text`, `letter_file:file`, `denominator_from:text`, `denominator_through:text`, `denominator_reference:text`, `denominator_file:file`, `certified_average:decimal`, `additional_ceiling:int`, `aggregate_scope:text`, `aggregate_count:int`, `aggregate_ceiling:int`, `combined_scope:text`, `combined_count:int`, `combined_ceiling:int`, `ceiling_reference:text`, `ceiling_file:file`, `previous_permit_reference:text`, `continuation_reference:text`, `continuation_file:file`, `previous_holder_ended_on:date`, `previous_holder_end_reference:text`, `previous_holder_end_file:file`.
- Identity constraints: unique —; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `workforce_permit_cases.previous_case_id → workforce_permit_cases [restrict/default]`, `workforce_permit_cases.company_id → companies [restrict/default]`, `workforce_permit_cases.rule_id → workforce_permit_rules [restrict/default]`.
- Collection: `src/data/collection/workforce_permit_cases/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/ui/workforce-permits.svelte`, `src/lib/workforce-permit-binding.ts` (remaining literal references counted in the inventory).

### workforce_permit_determinations

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `decision_on:date`, `decision_reference:text`, `decision_file:file`, `kind:enum`, `from:date`, `through:date`, `currency:currency`, `remuneration_basis:enum`, `remuneration_measure:enum`, `nominal_monthly_increase:money`, `original_interval_comparison:money`, `required_interval_increase:money`, `comparison_reference:text`, `comparison_file:file`.
- Identity constraints: unique —; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `workforce_permit_determinations.worker_id → workforce_permit_workers [restrict/default]`.
- Collection: `src/data/collection/workforce_permit_determinations/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/workforce-permit-binding.ts`, `src/lib/workforce-permits.ts`.

### workforce_permit_rules

- Target: **NEEDS_EVIDENCE**. Resolve input/operation split and actual actor host before selecting profile versus entity JSON. Preserve old IDs and paid references during a bounded migration; not an indefinite KEEP.
- Fields: `remuneration_basis:enum`, `remuneration_measure:enum`, `remuneration_scope_reference:text`, `primary_scheme:text`, `alternative_scheme:text`, `reference:text`, `route:text`, `effective_from:date`, `effective_through:date`, `currency:currency`, `raise_amount:money`, `baseline_month_offset:int`, `wage_deadline_month_offset:int`, `declaration_deadline_month_offset:int`, `grade_deadline_month_offset:int`, `minimum_grade_steps:int`, `first_grade_target:int`, `additional_ratio:decimal`, `aggregate_ratio:decimal`, `aggregate_scope:text`, `combined_ratio:decimal`, `combined_scope:text`, `authority_reference:text`, `authority_file:file`.
- Identity constraints: unique —; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: none declared.
- Collection: `src/data/collection/workforce_permit_rules/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/ui/workforce-permits.svelte`, `src/lib/workforce-permit-binding.ts` (remaining literal references counted in the inventory).

### workforce_permit_uses

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `assessed_on:date`, `stage:enum`.
- Identity constraints: unique [ { "fields": [ "record", "subject", "assessed_on", "stage" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `workforce_permit_uses.record → undefined [owned]`, `workforce_permit_uses.subject → undefined [restrict/default]`.
- Collection: `src/data/collection/workforce_permit_uses/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/payroll/run/graph.ts`, `src/lib/payroll/run/rerun.ts`.

### workforce_permit_worker_decisions

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `declaration_on:date`, `declaration_reference:text`, `declaration_file:file`, `grade_effective_from:date`, `scheme:text`, `approved_grade:int`, `grade_approval_reference:text`, `grade_approval_file:file`, `kind:enum`, `issued_on:date`.
- Identity constraints: unique —; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `workforce_permit_worker_decisions.worker_id → workforce_permit_workers [restrict/default]`.
- Collection: `src/data/collection/workforce_permit_worker_decisions/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/workforce-permit-binding.ts`, `src/lib/workforce-permits.ts`.

### workforce_permit_workers

- Target: **INPUT_MOVE_TO_EMPLOYMENT_JSON**. Move **all authored fields listed below** to employment/actual recipient profile JSON, validated by the pinned snapshot JSON schema. Preserve original identity/relationships as generic typed source references; no permanent dedicated dossier table.
- Fields: `reference:text`, `person_reference:text`, `place_reference:text`, `raise_from:date`, `currency:currency`, `remuneration_month_reference:text`, `remuneration_month_file:file`, `non_adverse_reference:text`, `non_adverse_file:file`, `declaration_on:date`, `declaration_reference:text`, `declaration_file:file`, `grade_effective_from:date`, `scheme:text`, `approved_grade:int`, `grade_approval_reference:text`, `grade_approval_file:file`, `grade_through:date`, `permit_holder_reference:text`, `holder_identity_reference:text`, `holder_identity_file:file`.
- Identity constraints: unique [ { "fields": [ "case_id", "place_reference" ] }, { "fields": [ "case_id", "employment_id" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `workforce_permit_workers.previous_worker_id → workforce_permit_workers [restrict/default]`, `workforce_permit_workers.permit_employee_id → employees [restrict/default]`, `workforce_permit_workers.case_id → workforce_permit_cases [restrict/default]`, `workforce_permit_workers.employment_id → employments [restrict/default]`.
- Collection: `src/data/collection/workforce_permit_workers/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/workforce-permit-binding.ts`, `src/lib/workforce-permits.ts`.

### workforce_register_members

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `person_reference:text`, `eligibility:enum`, `eligibility_reference:text`, `scheme:text`, `grade:int`, `at_li_ceiling:bool`, `li_exempt:bool`, `exception_reference:text`.
- Identity constraints: unique [ { "fields": [ "register_id", "person_reference" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `workforce_register_members.register_id → workforce_registers [restrict/default]`, `workforce_register_members.employment_id → employments [restrict/default]`.
- Collection: `src/data/collection/workforce_register_members/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/workforce-permit-binding.ts`, `src/lib/workforce-permits.ts`.

### workforce_registers

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `reference:text`, `unit_reference:text`, `month:text`, `member_count:int`, `counted_employees:int`, `count_basis_reference:text`, `source_file:file`.
- Identity constraints: unique [ { "fields": [ "company_id", "unit_reference", "month" ] } ]; noOverlap —.
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `workforce_registers.company_id → companies [restrict/default]`.
- Collection: `src/data/collection/workforce_registers/+collection.ts`. Runtime consumer examples: `src/lib/every-field.ts`, `src/lib/ui/workforce-permits.svelte`, `src/lib/workforce-permit-binding.ts` (remaining literal references counted in the inventory).

### worksites

- Target: **OPERATIONAL_KEEP**. Retain the generic operational identity/occurrence/output. Move jurisdiction-specific documentary input payloads to profile/entity JSON and pin the accepted dossier/schema in the operation; do not retain hardcoded law fields merely because the enclosing operation remains.
- Fields: `code:text`, `name:text`, `address:text`, `region:text`, `facts:custom`, `effective_range:period`.
- Identity constraints: unique —; noOverlap [ { key: ['company_id', 'code'], period: 'effective_range', name: 'worksites_no_overlap' } ].
- Explicit state: none; inspect collection admission/consumed-source locks.
- Relationships: `worksites.company_id → companies [owned]`.
- Collection: `src/data/collection/worksites/+collection.ts`. Runtime consumer examples: `src/lib/catalogue-offer.ts`, `src/lib/checks.ts`, `src/lib/component_entry_cap_subject.ts` (remaining literal references counted in the inventory).

