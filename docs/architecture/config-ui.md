> Reference audit only. The sole active plan is [TAKEOVER.md](../TAKEOVER.md). Historical ownership/implementation proposals are not authorization; the two-schema dynamic-input model overrides them.

# Authoritative dynamic input schema snapshots

Proposed contract; source implementation is frozen. This document replaces the earlier descriptor-only consolidation inventory. Existing shared WorkRules and quota shape constants remain valid, but they do not solve structured input authoring.

## Actual adapter gap

`lib/datatypes/fact_keys.ts` declares only boolean, number, string, date, instant, and table code. `factScalar` drops objects/arrays; `holdsFactType` and `factValueFault` validate scalar values. `data/custom_field/entity_facts/+definition.ts` explicitly rejects every non-scalar value. `lib/ui/declared-facts-field.svelte` uses a scalar record, scalar controls, and `factValuesFault`; its version schema selection is seven named FactKey lists.

Existing storage already routes facts through ordinary employment/entity records: `employment_terms.facts`, `person_facts.facts`, `company_facts.facts`, worksite facts, leave event facts, request facts, and statutory election declarations. Structured dossiers currently escape this common contract through dedicated JSON fields and helper-specific validators. Merely rendering a JSON textarea would not make these objects admitted facts: scalar resolution and proof predicates would still discard them.

Neither `employee_input_schema` nor `entity_input_schema` currently exists in HR source. Native ownership must add these exact jurisdiction attributes before dynamic forms can consume them.

## Minimal canonical contract

Use the exact jurisdiction attributes `employee_input_schema` and `entity_input_schema` as authoritative JSON Schema 2020-12 snapshots. Employee forms consume `employee_input_schema`; entity forms consume `entity_input_schema`. Employment profile/entity JSON values remain on existing subjects. These two attributes replace independently authored FactKey lists for their migrated inputs; no third declaration attribute is introduced. Reuse existing entity/employment facts storage; introduce no collection. An admitted original subject must pin the exact governing snapshot/version identity used to validate its facts. A later country edit changes its next version's employee/entity schema snapshot, never rewrites original records or reevaluates them silently under a new shape.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "assessment": {
      "type": "object",
      "description": "Original assessed source dossier",
      "additionalProperties": false,
      "properties": {
        "reference": {"type": "string", "minLength": 1},
        "assessed_on": {"type": "string", "format": "date"},
        "components": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "code": {"type": "string"},
              "amount": {"type": "number", "minimum": 0}
            },
            "required": ["code", "amount"]
          }
        }
      },
      "required": ["reference", "assessed_on", "components"],
      "x-norbital": {
        "evidence": {"kind": "REFERENCE_AND_FILE", "document": "DECLARED_DOCUMENT_CODE"},
        "bind_original_value": true
      }
    }
  }
}
```

The example demonstrates structure, not a country policy or a new source authority. Evidence metadata declares a demand; real saved source subjects, approved owned file bytes/hash, original knowledge clocks, and receipt/document constraints still qualify it. Uploaded-file presence and user-entered JSON cannot certify themselves.

Initial supported vocabulary should be deliberately closed: object/properties/required/additionalProperties:false; array/items/minItems/maxItems/uniqueItems; boolean/number/integer/string; enum/const; numeric bounds; string lengths/pattern; date/date-time formats; title/description. Reject unknown schema keywords instead of silently accepting unenforced constraints. Do not allow remote `$ref`, arbitrary code, defaults that fabricate declarations, or a schema interpreter embedded independently in every editor. Reuse an existing repository JSON Schema validator if one is already available; dependency selection is a separate ownership decision.

`x-norbital` carries only existing domain requirements that JSON Schema cannot prove: proof kind/document/validity, conditional required/valid/evidence expressions with explicit expression sites, original-value binding, observation bounds, declared table/parent resolution, and dated change effects. Description and date format remain standard schema keywords. Preserve existing source metadata semantics; do not repurpose ordinary `description` text as executable law.

Objects and arrays are supported as validated inputs and frozen source snapshots first. CEL access to structured values requires an explicit finite descriptor generated from the supported schema, under the current governing expression site. Do not pass arbitrary nested JSON into open expression maps or extend `scalarFacts` until real consumers are migrated. Scalar compatibility adapters must continue returning precisely the scalar facts existing callers expect.


## Existing recursive editor reuse

`oss/packages/ui/src/kinds/schema-editor.svelte` already recursively renders object fields, list items, tagged unions, and records through `Editor`; labels/help and dotted error paths are supported. `editor.svelte` supplies primitive/date inputs. It consumes Bolt `Kind`, not JSON Schema, so it is not an authoritative JSON Schema validator. The minimal template adapter converts the supported JSON Schema subset to `Kind` at runtime and passes values/errors to the existing generic Editor. Preserve validation against the original JSON Schema independently of presentation conversion.

Every employee/entity form derives its controls dynamically from the selected jurisdiction schema snapshot. No per-law form or generated Svelte source is required. Evidence upload/admission remains a generic companion keyed by stable schema property paths and original saved subjects. Array-item source identity must be stable before enabling nested proof; an array index alone cannot identify an immutable reordered dossier item. Unsupported schema features must refuse rather than degrade to an unchecked textarea.

## Migration map

| Existing declaration/value | Authoritative snapshot representation | Adapter obligation |
| --- | --- | --- |
| FactKey boolean/number/string | Property with matching type, enum and existing bounds | Preserve raw scalar and absence semantics. |
| FactKey date/instant | String property with date/date-time format | Keep strict calendar-day/UTC instant checks, not permissive parser coercion. |
| FactKey code/table/parent/non-table exceptions | String property with declared table metadata in `x-norbital` | Resolve actual dated version rows and explicit exceptions; no blank-as-NONE inference. |
| FactKey required/default/conditional validity | Object required list plus explicit extension predicates | Legacy documented defaults may be adapted; new snapshots should not synthesize missing source facts. Conditional requirements still use qualified original context. |
| FactKey evidence, bind_value, bind_scalar | Evidence extension on the exact property | Preserve reference equality separately from immutable typed value binding; arrays/objects need canonical structural equality and original snapshot proof, not scalar coercion. |
| Dedicated JSON dossier input | Closed object/array property schema | Preserve actual helper's semantic validation after structural validation; never infer final amount or entitlement from shape alone. |
| Native original schema provenance | Governing snapshot/version pin on existing subject | Validate same-write original facts/proof atomically; original captured records retain original contract. |
| Country input declaration edits | Next sealed version's schema_snapshot | Country authors employee_input_schema/entity_input_schema snapshots only after migration. No repeated TS types, renderer literals, or new collection per dossier. |

## Exact proposed write sets and handoffs

1. Canonical contract owner: new ordinary `lib/datatypes/input_schema.ts`; explicit schema snapshot codec, supported-keyword fault, scalar compatibility conversion, metadata shape. No runtime algorithms or law defaults.
2. Existing declaration adapter: `lib/datatypes/fact_keys.ts`, `data/custom_field/fact_keys/+definition.ts`, `+renderer.svelte`. Convert legacy FactKey declarations deterministically to snapshots while preserving existing saved declarations. After all consumers migrate, country authoring uses snapshot only; do not keep two independently authoritative declarations.
3. Existing values/editor: `data/custom_field/entity_facts/+definition.ts`, `+renderer.svelte`, `lib/ui/declared-facts-field.svelte`, `lib/declared-facts.ts`. Accept supported JSON values, render finite schema structure, validate actual governing snapshot, and expose intentional scalar compatibility for existing consumers.
4. Native owner: existing declaration models/collections and existing facts subject admission, including jurisdiction settings, terms, company/person/worksite revisions, requests/leave entries/statutory facts as each migrates. Add exact jurisdiction employee_input_schema/entity_input_schema attributes and original governing version pin. Profile/entity values reuse existing JSON facts storage. No guessed model field writes from the UI lane.
5. Compiler/runtime owners: `lib/expressions/contexts.ts` and source-fact resolver paths, existing evidence predicates/admission. Derive finite structured descriptors and exact pointer demands only for active consumers; preserve original proof clocks and source scopes.
6. Country owner: versioned seed input snapshots, after canonical/native/editor/runtime handshakes. Existing policy values and original legal source recipes stay country-owned.

The first implementation slice should migrate one existing employment/entity structured input with an actual caller, not create a universal form platform. Required Bolt model/custom-field/renderer/collection roles remain separate thin adapters. Freeze exact ownership and attribute placement before touching source.
