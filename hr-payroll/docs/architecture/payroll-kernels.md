> Reference audit only. The sole active plan is [TAKEOVER.md](../TAKEOVER.md). Historical ownership/implementation proposals are not authorization; the two-schema dynamic-input model overrides them.

# Payroll kernels — DAG A/B audit

Scope: static source review of `templates/hr-payroll/src/lib/payroll/**` and its money primitives. No source changes, execution, tests, or behavioral verification. This document is the proposed ownership boundary for phase B, not an implementation receipt.

## Current interfaces and orchestration

| Boundary | Actual source / caller | Contract |
|---|---|---|
| Source acquisition | `payroll/world.ts` → `payroll/run/gather.ts` | Complete native queries, observed clock, approved source assets, original employment/company scope. Gather creates employment bundles and paid/source history. |
| Measurement | `payroll/families.ts:calculateFamilies` | Original work/leave/request dispatch produces measured base, adjustments, captures, dated cash and wage source partitions. This is not a generic cash ledger. |
| Contribution input | `payroll/contribution.ts:prepareContributionInputs`, `prepareContributionAssessment` | Settings/date/person/source factories assemble actual contribution inputs. Family assessment retains `rebuildFromMeasured` with original version, prior context, date and projection. |
| Statutory interpretation | `payroll/run/contribute.ts:contribute`, private `priceContributions` | Authored CEL and ordered source rules, monthly/period netting, native scope and agency replacements. `contribute` captures executed evaluations/receivers/decisions. |
| Financial mutation/replay | `payroll/net-floor.ts`, `payroll/original-leave-remuneration.ts`, `payroll/original-leave-employer-charge.ts` | Measured changes rebuild the original contribution factory, then reassess employment and company charges. Mutation purpose and legal constraints differ. |
| Run orchestration | `payroll/run/engine.ts` | Preparation/checks → original leave remuneration → leave net floors → adjustment net floors → annual certificate payroll → settlement checks/output. Defaults and stage order have financial consequences. |
| Snapshot transport | `payroll/run/graph.ts` | Serializes distinct measured source captures into native adjustment/statutory/leave snapshots. Transport is not admission. |

`engine.ts` presently nests the financial stages in one expression around lines 642–658. `calculateWithOriginalLeaveRemuneration` resolves exact original charge/item identities and contractual sources before calling the remuneration stage. The family factory, rather than a newly reconstructed accumulation, supplies replay.

## Decisions

| Classification | Exact source and current importers | Decision / boundary |
|---|---|---|
| KEEP | `lib/source-money.ts`; imported by `payroll/ongoing-monthly-obligation.ts`, `payroll/run/contribute.ts`, `payroll/wage-net-receiver.ts` and numerous native financial admission modules | Existing canonical exact source minor-unit conversion. `sourceMinorUnits` validates original money; `sourceMoney` checks transport conservation; `computedSourceMinorUnits` explicitly rounds computed results. Do not merge their semantics. |
| KEEP | `payroll/monthly-source-obligation.ts` → `payroll/money.ts`, `payroll/family.ts` | Post-exit covenant/release admission: original ended contract, covenant scope, applicable performance and binding/agreed/average basis. Keep these legal gates separate. |
| KEEP | `payroll/ongoing-monthly-obligation.ts` → `payroll/money.ts`, `payroll/family.ts`, `datatypes/ongoing_monthly_obligation.ts`, `catalogue_rules.ts` | Active-contract protected no-work liability: original actors, no-work scope, agency-place order, full-month floor, separately assessed partial month. A shared covenant admission would invent prerequisites. |
| CONSOLIDATE | Repeated receipt arithmetic in the two obligation modules above | Extract only exact money/receipt accumulation after each domain has admitted its source. Preserve separate snapshot types, identity/period/currency checks and paid-universe qualifications. Existing covenant float/cents aggregation must not be treated as exact source admission. |
| CONSOLIDATE | Reassessment sequence in `payroll/net-floor.ts`, `payroll/original-leave-remuneration.ts`, `payroll/original-leave-employer-charge.ts` | Strongest bounded change: one rebuild/reassess operation using the existing original family factory. Keep candidate construction, cap selection, signed employer delta and guarantee solving in their current domains. |
| KEEP | `payroll/contribution-minimum-due.ts` → `payroll/contribution-minimum-due-source.ts` → `payroll/run/contribute.ts` | Exact rational minimum calculation and measured-source adapter are different contracts. Assessment-only floor must not fabricate paid wages or duplicate the employee wage-floor producer. |
| KEEP | `payroll/original-leave-remuneration-source.ts` → engine; `benefit-cases/leave-remuneration-{recipe,periods,cap}.ts` → resolver/stage | Original source selection, statutory period partition and signed financial search are separate real operations. Preserve fractional source boundaries, paid group/aggregate occupation and contractual superiority. |
| KEEP | `payroll/facts.ts`, `payroll/run/statutory-facts.ts`, `declared-fact-evidence.ts` | Canonical dated declaration selection and original evidence qualification precede pricing. Deferred facts retain the original source callback. Money aggregation cannot replace documentary admission. |
| NEEDS EVIDENCE | `payroll/run/contribute.ts` agency `tariff_slices` replay | Complete attributed money is conserved against ordinary same-input tariff replay. Review preservation of wage scopes/monthly assessments and dependency inputs before extracting this replay into the shared operation. Single month selection alone does not certify a multi-month liability. |
| NEEDS EVIDENCE | `payroll/families.ts:prepareFamilyHistory` and `payroll/run/contribute.ts` contractual wage receiver | WAGES-only zero is not all-income completeness. Complete-query pins prove queried workspace rows, not unrecorded opening income. Keep absence distinct from actual qualified zero and do not silently expand component membership. |
| REMOVE | No source deletion justified by this review | No dead export/caller was established. Phase B may remove duplicate reassessment blocks only after their callers migrate; do not delete domain admissions, source adapters or original capture fields as “duplicates.” |

## Strongest bounded phase B consolidation

Use the existing measured-family replay contract as the common kernel. It already retains original attribution, earned context, version, date, prior and projection. A helper must accept the current assessment and explicit measured replacements, invoke each affected row's `rebuildFromMeasured`, and calculate employment/company charges once using the current actual options. It returns the complete assessment, not only an accumulation or net amount.

The helper must not:

- infer missing original source factories or substitute current settings;
- change stage order, alter statutory chosen gross/paid occupation, or mix contractual differential into statutory cap occupation;
- clamp signed employer deltas, assume monotonic contributions, or invent currency conversion;
- merge post-exit covenant and ongoing protected-wage admissions;
- reinterpret frozen paid snapshots as mutable candidate inputs.

Exact proposed write set for this batch:

1. New `templates/hr-payroll/src/lib/payroll/reassess-measured.ts` with types derived from the current family assessment and contribution options.
2. `templates/hr-payroll/src/lib/payroll/net-floor.ts`: migrate repeated full-source rebuild/reassessment blocks.
3. `templates/hr-payroll/src/lib/payroll/original-leave-remuneration.ts`: migrate zero-reset and selected-source rebuilds.
4. `templates/hr-payroll/src/lib/payroll/original-leave-employer-charge.ts`: migrate candidate replay; retain signed baseline/candidate receipts.
5. `templates/hr-payroll/src/lib/payroll/run/engine.ts`: name existing financial stages explicitly without changing their order, after the kernel callers agree.

Do not include `families.ts`, `money.ts`, `run/contribute.ts`, legal seed files, native collections, or source snapshot schemas in the first write batch. The factory is an existing interface; changing it would expand the ownership and proof requirements.

A subsequent independent exact-money batch may touch `monthly-source-obligation.ts`, `ongoing-monthly-obligation.ts` and one small shared receipt arithmetic module. Its contract must take already-qualified original source identity and immutable paid rows. It must preserve covenant releases, original agreed/assessed amounts, partial-month admission and ongoing paid-before/prior-ID continuity. No generic obligation framework is justified.

## Ownership handoff

Phase B must grant exclusive ownership of the five-file replay write set before any source edit. Each domain owner supplies its current callback/capture contract. Prior source work is not resumed by this audit. The remaining ongoing-wage observed-clock transport and source activation are separate implementation work; this document does not grade them complete.

## Replacement boundary: dynamic profile/entity JSON

This section supersedes the earlier proposed obligation micro-consolidation. The approved reassessment extraction is now implemented in the four-file kernel/caller set; engine formatting was deferred. The next change is an input-model migration, not another small shared helper. Source remains unchanged during contract review.

### Current coupling

| Input / actual loader | Current coupling | Replacement contract |
|---|---|---|
| `monthly-source-obligation.ts:resolveMonthlySourceObligation` | `history.external(policy.history_kind, interval, identity)` followed by fixed facts such as `contract_ended_on`, `actual_secret_access`, `covenant_identity`, `agreed_amount` and release fields | A selected sealed profile describes paths, subject bindings, qualification expressions and typed operations. A qualified entity supplies original values and stable item IDs. The processor must not recognize a covenant/history-kind code. |
| `ongoing-monthly-obligation.ts:captureOngoingMonthlyObligation` | Same history lookup but a different fixed fact contract for no-work scope, agency location, floor order and partial assessment | Separate profile declarations over the same carrier/operation API. Active-contract/no-work and closed-contract/covenant qualifications stay distinct source-authored predicates. No union of mandatory legal fields in runtime. |
| `payroll/money.ts` | Two request policy names dispatch to two source interpreters; payslip captures retain distinct structures | One selected qualified operation reference routes generic assessed-payment processing. Original capture versions remain readable and immutable during migration. A label, country or profile code must not select an algorithm. |
| `original-wage-corrections.ts:currentOriginalCashAllocation`, `admitOriginalWageCashCorrections` | Dedicated native correction collection and fixed allocation tuple/issue-known-effective fields | Generic entity revision/supersession and allocation operation with declared paths. Retain immutable original bank identity and complete allocation conservation. Do not edit the bank receipt when reallocating its attribution. |
| `recipient-cash-corrections.ts` | Dedicated reassessment/disposition records, issuer and transfer qualification, original cash/cohort/journal authority | Generic typed reassessment/disposition operation over qualified entity references. Authority, documentary qualification and payer/recipient lineage remain profile-declared and physically proved. Actual transfer cash remains a financial event, separate from source revision. |
| `insurance-policy-restatements.ts` | Fixed restatement collection, retained original history source, authority-role checks, predecessor/register/component allocations | Profile-declared original/corrected identity bindings and complete allocation items. No generic correction algorithm may erase required authority, multi-share completeness or distinct refund/additional/no-cash disposition. |
| `payroll/world.ts`, `run/gather.ts`, `run/graph.ts` | Feature-specific queries, bundle arrays and adjustment keys | One qualified source loader/selector feeds typed operation views into bundles; graph freezes selected entity/profile revisions, operation/item IDs and admitted output. The profile document is configuration, not a replacement for actual source evidence. |

No generic profile/entity native carrier was found in the reviewed template model tree. Carrier naming and ownership therefore need to be frozen before implementation; the paths below are proposed additions, not claims of an existing API.

### Proposed generic carrier contract

A **profile revision** contains a stable profile ID and revision ID, approval/seal identity, effective interval, declared JSON schema, source/evidence field declarations, immutable item-key declarations, subject bindings and an ordered array of typed operation declarations. Each operation has a stable `id`, a generic `kind`, explicit input paths, qualification/validation expressions and output bindings. Display labels and jurisdiction/profile codes carry no dispatch authority.

A **source entity revision** contains a stable entity ID and revision ID, selected profile revision ID, typed subject references, effective interval, issued/known/observed dates, documentary asset references, immutable JSON payload and explicit predecessor revision identity when corrected. Entity arrays use required stable item IDs declared by the profile. Array position, amount, date or a newly generated hash is not the item identity.

Qualification produces a frozen view containing:

- selected profile/entity revision IDs and original subject identities;
- exact effective scope and the independently observed knowledge cutoff;
- the original payload snapshot and stable operation/item IDs;
- admitted original file IDs/hashes/byte sizes/approval and observation receipts;
- resolved typed inputs with their original JSON paths and source references;
- query-universe provenance when an operation depends on complete prior originals.

The runtime resolves an approved, sealed profile and independently approved entity before decoding dynamic JSON. It evaluates profile qualification with actual original subjects and context. It does not trust a client `qualified`, `paid`, `no_work`, `lawful`, authority-role or scope flag merely because the JSON schema accepts its type.

The generic processor operates on typed qualified views. Initial operation kinds should be limited to the migrated real contracts: `ASSESSED_PAYMENT`, `ALLOCATE_ORIGINAL_CASH`, `REASSESS_ORIGINAL_LIABILITY`, and `DISPOSE_ORIGINAL_BALANCE`. Legal prerequisites remain authored in profile declarations; exact money, identity conservation, unique successor graphs and immutable paid-history handling remain algorithm invariants.

### Snapshot and date rules

An assessed payment binds an original amount, currency, exact source interval and item identity. Its paid receipts are individually approved financial originals, not editable entity flags. A partial period is supplied by the qualified source operation; no default proration is inferred. Runtime operation output records original assessed amount, original paid allocations, current payment amount and remaining liability in exact currency units.

Correction resolution follows actual predecessor IDs with one successor per revision and no cycle/orphan. Effective date and knowledge date are separate filters. A revised entity never rewrites a frozen paid snapshot. Repricing selects the admitted revision under the original rule/date contract and records both original and successor references. A new schema/profile revision cannot silently reinterpret a prior payload.

A source array item is referenced as `(entity_id, entity_revision_id, operation_id, item_id)`. Stable original financial identity is retained separately when a correction reassigns an allocation. Inserting/reordering unrelated array items must not change a paid source coordinate.

### Concrete migration batches

**Batch P1 — complete assessed-payment vertical slice.** Migrate monthly and ongoing inputs together through one carrier and one generic typed operation, with distinct profile qualifications. This replaces fixed field readers and feature policy dispatch; it is not a helper-only patch.

Proposed exact write set:

- New generic native carriers and admissions: `src/data/model/source_profiles/+model.ts`, `src/data/model/source_entities/+model.ts`, corresponding `src/data/collection/source_profiles/+collection.ts` and `source_entities/+collection.ts`.
- New declared JSON/schema/editor surface: `src/lib/datatypes/source_profile.ts`, `src/lib/datatypes/source_entity.ts`, `src/data/custom_field/source_profile/+definition.ts`, `+renderer.svelte`, and paired relationship/access declarations in `src/data/+relationship.ts` and applicable `src/access/**`.
- Generic qualified reader and typed processing: `src/lib/qualified-source-entity.ts`, `src/lib/payroll/source-operations.ts`.
- Actual acquisition and consumers: `src/lib/payroll/world.ts`, `src/lib/payroll/run/gather.ts`, `src/lib/payroll/money.ts`, `src/lib/payroll/family.ts`, `src/lib/payroll/run/graph.ts`, `src/lib/catalogue_rules.ts`, paired request/snapshot descriptors.
- Compatibility-only original capture readers: `src/lib/payroll/monthly-source-obligation.ts`, `src/lib/payroll/ongoing-monthly-obligation.ts`. Keep legacy paid snapshots readable; route new declarations through the generic operation. Delete old current-input field decoders only after no active profile/caller depends on them.
- Dynamic source profile/entity fixtures and declared input schema belong to configuration data. No runtime country edits are part of this batch.

The native carrier/access/UI owners must freeze this write set and generic naming before source work. Reuse an existing canonical carrier if another owner identifies one; do not introduce a parallel entity system.

**Batch P2 — original-cash allocation correction vertical slice.** Use the same entity/profile carriers, with a stable allocation-item schema and exact `ALLOCATE_ORIGINAL_CASH` operation. Migrate `original-wage-corrections.ts` admission/resolution, its native collection consumer, original-cash reader and payroll opening consumers. Preserve actual original bank identity, complete allocation totals and old immutable receipt/correction IDs. Dedicated legacy rows remain readable during explicit migration; no DDL rename/drop is permitted as a shortcut.

**Batch P3 — qualified liability reassessment/disposition.** Only after P1/P2 establish carrier identity and actual paid snapshot transport, migrate `recipient-cash-corrections.ts` and `insurance-policy-restatements.ts` plus their native callers, reporting/settlement readers and access/asset scopes. Keep distinct declared authority, transfer, multi-share and additional/refund/no-cash contracts. Sharing the carrier does not make their legal qualifications equivalent.

### Freeze conditions and grading

Freeze profile/entity identities, item-key and revision semantics, the qualified-view contract, typed operation kinds, native access/file ownership and legacy snapshot compatibility before editing source. Resolve complete original query scope and knowledge cutoff as part of each vertical slice; do not call an empty workspace result complete opening history.

A migration is complete only when generic profile/entity input authoring, original qualification, actual payroll processing, paid snapshot transport and correction replay all use the same frozen contract. A generic helper or JSON field with feature-specific loaders still active is a partial migration. Country configuration updates must not require TypeScript dispatch or new legal input models.

## Seed declaration conversion contract

`seed/seed.ts:declarationInputSchema` is a build-time compatibility converter, not a new runtime input model. It emits a closed object schema, keeps every original declaration intact at each property's `x-norbital.legacy_fact`, and maps only intrinsic scalar/date/instant types plus labels/descriptions. It does not materialize defaults, collapse code-table inputs to static enums, flatten scoped declaration groups, or convert calculation-required conditions into unconditional save-required fields.

The target native attributes are `employee_input_schema` and `entity_input_schema`. Existing authoritative attributes must win; compatibility must not regenerate them from older lists. The mapping of original jurisdiction declaration groups into these two attributes is not yet frozen. `facts`, `exit_facts`, `terms_facts`, `work_day_facts`, `payment_facts`, `settlement_facts`, `worksite_facts` and `person_facts` have distinct original subjects/expression sites. Flattening keys across them loses identity and can collide. Statutory elections, history-kind facts, catalogue request/event declarations and derived income-event fields are separate owners; a matching `{key,type}` shape does not put them all in the jurisdiction employee schema.

The converter is exported but not wired into seed row loading until this group/snapshot contract is settled. No jurisdiction fixture has been rewritten. Source settings ID, original effective range and declaration group must be retained by the eventual group envelope/native schema snapshot; a property schema alone is not version lineage.

### Metadata requiring canonical interpretation

Canonical FactKey metadata already includes `required`, `required_when`, `valid_when`, `validation_message`, `default_value`, `options`, `table`, `parent_fact`, `non_table_codes`, `scope`, `change_effect`, `change_limit`, `transition_source`, `not_after_observation`, scalar limits, labels/descriptions, `import`, and evidence kind/when/document/valid-days/bind-value/bind-scalar. All must remain part of the original qualified interpretation. Missing optional and missing calculation-required values are distinct; an evaluator must invoke legacy qualification for absent members as well as present members and retain the original documented-default rule.

Static seed inspection also found these noncanonical keys. Their raw values are retained, but equivalent runtime interpretation needs a frozen extension or an explicit source-data correction; the converter must not silently guess aliases:

| Metadata | Exact example |
|---|---|
| `values`, `invalid_message` | `seed/jurisdiction/VN/statutory_contributions.json`, `finalisation_income_scope` election |
| `max_length` | `seed/jurisdiction/VN/jurisdiction_settings.json`, `grade12_year` history fact |
| `choices` | `seed/jurisdiction/CN/adhoc_catalogue.json`, `original_assessment_rounding` request fact |
| `default` | `seed/jurisdiction/CN/statutory_contributions.json`, `jp_pension_certificate_elected` election |
| `min` | `seed/jurisdiction/TW/jurisdiction_settings.json`, `documented_normal_basic_amount` terms fact |
| `evidence.reference_file` | `seed/jurisdiction/ID/leave_catalogue.json`, `paternity_event_reference` event fact |
| `evidence.required_when` | `seed/jurisdiction/ID/jurisdiction_settings.json`, `termination_notice_calendar_reference` exit fact |
| `expression` | `seed/jurisdiction/SG/jurisdiction_settings.json`, income-event derived `deemed_on`; this is a derived declaration, not an ordinary FactKey input |

Neither JSON Schema structural validation nor a permissive object decoder proves that these extra semantics were enforced. Preserve the complete original metadata and reject unimplemented interpretation at the qualification boundary. This compatibility conversion ends once authoritative dynamic schemas are supplied in seed data; it must not become a permanent runtime source-code requirement for adding law inputs.
