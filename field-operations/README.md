# Field Operations

![Field Operations application](docs/screenshots/application.webp)

Field Operations runs the complete day-to-day cycle of managing physical work sites, scheduling and
dispatching dated jobs to field contractors, capturing progress and photographic proof of work, and
auditing completion evidence before site handover. Instead of juggling spreadsheets for daily
schedules, chasing completion photos across scattered WhatsApp chat groups, and manually checking
whether contractors actually visited the right location, operations teams coordinate every site,
work order, field message, and photo review in one structured workspace.

Designed for construction, installation, maintenance, and multi-site service teams, the workspace
keeps back-office control and field simplicity cleanly separated. Dispatch controllers schedule work
on a live daily board and map, bulk-import work orders from spreadsheets, and review automated photo
integrity findings, while field contractors see only their own assigned jobs and can report progress
directly from their mobile workspace or through a connected WhatsApp reporting assistant.

## Expected Business Impact

- **Faster daily dispatch with fewer scheduling errors:** Replaces manual dispatch spreadsheets with
  a date-driven operations board, live site map, multi-stop route planning, and whole-sheet
  work-order imports that validate every row upfront and skip already-filed jobs automatically.
- **Frictionless field reporting with zero lost proof of work:** Contractors report completions,
  visit summaries, and site photos from their own workspace or directly through WhatsApp,
  automatically filing every message and attachment onto the right job record rather than burying
  evidence in chat history.
- **Consistent photo verification at scale:** Every submitted photo is automatically screened for
  exact or visually similar reuse across other jobs, camera location mismatches against the site,
  editing-software traces, and low-resolution uploads — backed by AI-assisted evidence reviews that
  escalate only concrete concerns for human decision.
- **Strict confidentiality and auditability:** Contractors never see other contractors' assignments,
  back-office integrity checks, or suspicion findings. Inbound field messages, AI review decisions,
  and closed controller resolutions are preserved as immutable audit records.
- **Complete site history and clean handovers:** Every site maintains a living record of upcoming
  work and past visits, and controllers can export structured handover packs for selected sites in
  one action.

## Roles & Access

The workspace separates operational control, field execution, and messaging assistance into clearly
bounded roles:

- **Workspace Administrators:** Invite active team members, assign workspace teams, record
  international mobile numbers for WhatsApp reporting, and pair external messaging channels.
- **Field Operations Controllers (and Contractor Controllers):** Full operational command over
  sites, daily dispatch schedules, bulk work-order imports, contractor assignment, site handover
  exports, and evidence review. Controllers inspect photo integrity observations, review AI-raised
  findings, raise manual findings when needed, and record final resolution decisions. Audit ledgers
  for field messages, AI reviews, and closed findings are strictly append-only and cannot be
  rewritten or erased.
- **Contractors:** Self-scoped field access limited strictly to their own assigned jobs and the
  sites tied to those jobs. Contractors view job scope and site details, update job status, record
  charged value, visit summaries, and reported locations, and upload site photos. They cannot
  create, delete, or reassign work orders, view unassigned or colleagues' jobs, or access any photo
  integrity flags, AI reviews, or suspicion logs.
- **WhatsApp Reporting Assistant (Private Channel Envoy):** A tightly scoped messaging assistant
  that answers job questions and files completion updates, messages, and site photos onto existing
  assignments. It cannot create, delete, or reassign jobs, modify work scopes, or read integrity
  checks and suspicion logs. Direct messages are restricted to linked workspace members; unrecognized
  phone numbers are refused.

## Apps & Functionality

### Dispatch (Controllers)

| App / Module          | Functionality                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dispatch Schedule** | Date-selectable daily board organizing jobs into **Pending** and **Completed** lanes alongside an interactive site map. Highlights jobs missing a linked contractor or carrying an open suspicion finding, supports multi-stop route planning (up to five stops with Google Maps directions handoff), launches bulk spreadsheet imports, and triggers on-demand suspicion reviews. |
| **Sites Directory**   | Master register of geolocated physical sites with address, optional unit number, client or tenant name, site type (such as HDB flat, condominium, landed home, commercial, or industrial), floor area, and optional external site code. Prevents duplicate entries for the same address and unit, and exports multi-site handover packs.                                           |
| **Site Profile**      | Unified site record displaying dwelling/property context alongside two dedicated tabs: **Upcoming Jobs** (future scheduled and overdue unfinished assignments) and **Activity History** (a chronological timeline of dispatched and completed visits, charged values, reported locations, and summaries).                                                                          |

### Contractor Workspace (Contractors & Controllers)

| App / Module        | Functionality                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dispatched Jobs** | Role-scoped work order register showing each contractor only their own assignments (while giving controllers a workspace-wide view with inline creation of new jobs and new geolocated sites). Supports keyword and semantic search across job titles, descriptions, sites, and summaries.                                                                                                                                                                                                                                                                                                                                   |
| **Job Record**      | Structured view of **Job Scope**, **Progress**, **Completion**, and **Reported Location**. Linking a contractor's email or mobile number automatically resolves the matching workspace member and stamps the dispatch time; marking a job completed stamps completion time automatically. Includes a read-only **Conversation** tab stitching inbound field messages and photo bursts into a daily timeline with full-size image viewing, plus a controller-only **Suspicion Logs** tab showing neutral **Evidence Facts**, side-by-side **Similar Photos in Other Assignments**, and **Judgements** with inline resolution. |

### Governance & Audit Records (Controllers)

| Record Area                      | Functionality                                                                                                                                                                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Photo Evidence**               | Preserves uploaded and message-delivered photos (up to 20 MB per image) with immutable origin tracking (workspace upload vs. messaging sender and timestamp). Displays neutral integrity observations to controllers while keeping those checks hidden from contractors.                  |
| **Field Messages**               | Read-only archive of inbound contractor messages captured against each job independently of live chat sessions.                                                                                                                                                                           |
| **Suspicion Reviews & Findings** | Immutable audit log of every automated evidence review (including clear outcomes) and every open or resolved finding. Controllers inspect the exact evidence snapshot shown to the reviewer and close open findings with a permanent written conclusion stamped with their name and time. |

## Automations & Connections

### Built-In Automations

- **Automatic Photo Integrity Screening:** Runs immediately when any photo is uploaded or received,
  checking image format, resolution, editing-software metadata, camera GPS distance against the work
  site (within a 500-meter tolerance), exact file duplicates, and visually similar photos across
  other assignments. Observations are recorded as neutral facts rather than automatic accusations.
- **AI-Assisted Suspicion Review & Scheduled Retries:** Runs automatically whenever jobs are filed
  or updated (and once newly uploaded photos finish screening), and can also be started manually by
  controllers. Evaluates job scope, field messages, photo observations, representative site images,
  and candidate cross-job photo matches, logs an immutable review record for every check, opens a
  finding only when concrete evidence warrants escalation, alerts controllers in-app, and
  automatically retries incomplete reviews at the next two-hour window.
- **Whole-Sheet Work-Order Import:** Reads uploaded CSV or Excel dispatch sheets (up to 5,000 rows),
  validates every row before writing a single record, matches existing sites by site code or
  normalized address and unit, creates missing geolocated sites together with their jobs, links
  contractors by email or phone, and skips previously imported work orders so re-importing the same
  sheet never creates duplicates.
- **Controller Finding Resolution:** Closes one or more open findings in a single immutable action
  that records the reviewing controller, timestamp, and final conclusion.
- **Site Handover Export:** Generates downloadable per-site handover files — a structured site data
  bundle plus separate spreadsheet tables for dispatched jobs and photo evidence — ready to share
  with clients or downstream systems.

### External Connections & Channels

- **WhatsApp Channel Integration:** Pairs with the workspace's private reporting assistant so field
  contractors can ask about today's jobs and submit completion notes and site photos in direct
  messages or group chats (when mentioned or replied to), protected by per-sender and workspace rate
  limits.
- **Workspace Assistant (Norbius):** Built-in conversational assistant that answers schedule and job
  questions and records operational updates strictly within the signed-in user's permissions.
- **Interactive Maps & Google Maps Handoff:** Native address lookup, pin placement, daily job
  mapping, and multi-stop route handoff to Google Maps.

## Scope & Boundaries

- **Included out of the box:** Geolocated site management (configured with Singapore time zone,
  Singapore dollar formatting, local postal/unit address matching, and bilingual English and
  Simplified Chinese interfaces), daily dispatch scheduling, spreadsheet work-order imports,
  role-isolated contractor reporting, WhatsApp field capture, automated photo integrity checks,
  AI-assisted suspicion reviews with controller sign-off, and downloadable site handover packages.
- **Outside the software boundary:**
  - **Invoicing, job costing, payroll, and accounting:** Contractors may record a simple charged
    value for operational reference, but formal quotations, customer billing, contractor settlement,
    and general-ledger accounting belong in dedicated finance or payroll systems.
  - **Inventory, materials, and fleet management:** Warehouse stock, material procurement, vehicle
    telematics, and live GPS tracking of field staff are not covered.
  - **Automatic geocoding during spreadsheet imports:** Rows that introduce new sites in an uploaded
    spreadsheet must include latitude and longitude coordinates; interactive address search is used
    when adding sites directly inside the workspace.
  - **Human governance and external enforcement:** Automated photo observations and AI suspicion
    findings support controller review — final judgement, contractor follow-up, contractual remedies,
    and regulatory compliance remain human responsibilities.
  - **Live two-way ERP synchronization:** External handover is delivered as structured export files
    rather than an automated bidirectional ERP sync; WhatsApp account pairing and device session
    maintenance remain administrator operations.

## Documentation

- [Technical Documentation Index & Developer Quickstart](docs/README.md)
- [System Architecture & Inner Mechanisms](docs/architecture.md) — runtime topology, data model,
  photo forensics, AI suspicion review pipeline, import/handover flows, and access-control diagrams
- [Source Reference](docs/source-reference.md) — complete verified inventory of apps, models,
  fields, outputs, automations, teams, and policies
- [Operator Guide](docs/operator-guide.md) — step-by-step walkthrough covering team setup, dispatch,
  imports, photo verification, site handover, and WhatsApp pairing
- [Work-Order Import CSV Template](assets/job-assignments-import.template.csv) and
  [Column Guide](assets/job-assignments-import.README.md)
