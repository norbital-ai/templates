# Field Operations operator guide

Step-by-step operating walkthrough for preparing roles, dispatching sites and jobs, importing dispatch
sheets, reviewing photo integrity findings, exporting site handovers, and pairing the WhatsApp Envoy.

## Workflow summary

| Flow                      | Operator                         | Entry and outcome                                                                                                |
| ------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Prepare people            | Administrator                    | **Command center → People**: admit active members, assign a team, and save a mobile number for WhatsApp.         |
| File a site and job       | Controller                       | **Sites → New** or **Dispatched jobs → New**: locate the site, then create the dated assignment.                 |
| Dispatch and progress     | Controller, then contractor      | **Dispatch schedule** and the job's **Progress** section: assign the contractor, report work, and complete it.   |
| Import dispatch work      | Controller                       | **Dispatch schedule → Import**: validate a CSV/XLSX and file each new work order once.                           |
| File and inspect evidence | Contractor, Envoy and controller | Photo upload or WhatsApp report, then inspect the job's **Conversation** and **Suspicion logs** tabs.            |
| Review and resolve        | Controller                       | **Suspicion review**, then **Resolve**: inspect the evidence basis and record the controller's final conclusion. |
| Hand over sites           | Controller                       | **Sites → Site handover**: download the selected sites' JSON and CSV outputs from the automation run.            |
| Configure the Envoy       | Administrator                    | **Settings → Envoys**: create the Envoy, connect WhatsApp from its card, and inspect its messages.               |

## 1. Prepare people and teams

An administrator opens **Command center → People** (`/command-center/people`), invites members by email or
international mobile number, and selects an existing team (**Field Operations Controllers**, **Contractor**,
or **Contractor (Controller)**). Keep the member **Active**.

For WhatsApp reporting, save the member's **Mobile number** in international format. A job links to that
member by matching the email or phone number entered as `assignee_contact` rather than by a separate
contractor table.

![Invite a member into the Contractor role](screenshots/19-member-setup.webp)

## 2. Locate a site and file its first assignment

Open **Dispatch → Sites** (`/app/field_ops_controller/sites`) and choose **New**. Set **Location
(required)** using address search, map pin, coordinates or device location, and add an optional **Unit
number**. Saving the same address/unit twice is refused.

![New site fields, including location and optional unit](screenshots/new-site.webp)

![Location is required by the native site form](screenshots/site-validation.webp)

Open **Contractor Workspace → Dispatched jobs** (`/app/field_ops_contractor/jobs`) as a controller and
choose **New** to create an assignment (using **New site by location** inline if needed). Every new job
starts **Pending**; entering a member's email or phone links the contractor and stamps **Dispatched at**,
while an unmatched contact warns **No contractor linked**.

## 3. Dispatch the day and report progress

Open **Dispatch → Dispatch schedule** (`/app/field_ops_controller/dispatch`) and select a date. The board
groups that day's work into **Pending** and **Completed** beside a live site map. Use **Plan route** to
order up to five stops and open turn-by-turn directions in Google Maps.

![Planning a multi-stop site route](screenshots/route.webp)

[View the route planner in dark mode](screenshots/route-dark.webp).

![Job scope, contractor and progress on the record](screenshots/job-record.webp)

Assigned contractors open **Contractor Workspace → Dispatched jobs** to see only their own assignments,
record **Value charged**, **Completion / visit summary** and **Reported location**, and mark **Status**
as **Completed** (which stamps `completed_at` and makes the job eligible for evidence review).

![Jobs in the controller view; contractor permissions scope the same page to assigned work](screenshots/contractor-jobs.webp)

## 4. Review a site's upcoming work and history

Opening a site from **Sites** or the dispatch map shows **Upcoming jobs** (future and overdue unfinished
work) alongside **Activity history** (dispatch/completion timestamps, charged value, reported location
and summary).

![The site record and its activity history](screenshots/site-history.webp)

## 5. Import a dispatch sheet

On **Dispatch schedule**, choose **Import** and upload a CSV or XLSX using the
[CSV template](../assets/job-assignments-import.template.csv) and
[column reference](../assets/job-assignments-import.README.md). Each row requires `site`, `scheduled_for`
(`YYYY-MM-DD`) and `title`; new sites also require `latitude` and `longitude`. The entire sheet is
validated before writing, and re-imports skip existing `external_ref` (or `(site, scheduled_for, title)`)
entries without creating duplicates.

![The native dispatch import sheet](screenshots/dispatch-import.webp)

## 6. File photos and inspect evidence

Upload JPEG, PNG or HEIC evidence (up to 20 MiB) on an assignment. The photo's file, parent and
provenance are immutable once filed. Filing automatically schedules `inspect_photo_evidence`, which
records deterministic facts:

- **Exact & perceptual duplicates:** SHA-256 (`exact_duplicate`) and 256-bit Meta PDQ perceptual hash
  vector search within Hamming distance 31 (`visual_duplicate`), plus cosine similarity on `scene`
  embeddings (`scene_embedding`) across other assignments.
- **Geolocation:** EXIF GPS checked against the site coordinates within 500 m (`missing_geolocation` or
  `location_mismatch`).
- **Metadata & quality:** `metadata_anomaly`, `edited_metadata`, `low_quality`.

Flags are recorded as neutral evidence facts (missing EXIF GPS is common over WhatsApp); only a suspicion
review raises a judgement.

![A Contractor's filed photo: the assignment and file only, summarised as Workspace upload](screenshots/09-photo-filed.webp)

![The controller's view of the same photo after inspection](screenshots/10-photo-inspection.webp)

## 7. Review evidence and resolve findings

Run **Suspicion review** on **Dispatch schedule** (also scheduled automatically after job updates).
`review_job_assignment_suspicion` inspects pending photos, evaluates up to 3 signal-weighted photos
(capped at 4 MiB) plus site/job facts and `communication_logs` using the workspace's `default` model,
writes an immutable `suspicion_reviews` audit row for every verdict (including clear ones), and appends a
`suspicious_activity_logs` row only when judged suspicious.

Controllers inspect **Evidence facts** and **Similar photos in other assignments** on the job's
**Suspicion logs** tab, then record their conclusion and click **Resolve** (immutable once closed).

## 8. Hand over sites

In **Sites**, select one or more rows and choose **Actions → Site handover** (`site_handover`). Each
selected site produces a JSON bundle, a job-assignment CSV and a photo-evidence CSV downloadable from the
banner and from **Command center → Automations**.

![Site handover succeeded with the JSON and CSV downloads](screenshots/13-site-handover.webp)

## 9. Connect and operate the WhatsApp Envoy

Create an active private Envoy under **Settings → Envoys** named **Norbital** with the
`field_ops_whatsapp` policy, delegation disabled, triage enabled, group messages `mention_or_reply`, and
this task brief:

> You answer questions about job assignments on WhatsApp and keep them up to date from what people report. Handle messages in the order they arrived. When a message needs work (a report, a photo, an update), first reply with one short line saying what you are about to do, e.g. "Got it — attaching this to the 4 Ubi View job.", then do the work, then confirm briefly, one line per job. Find the job with one read of sites (where address like the words they name) with its job_assignments layer (order_by scheduled_for); take the site's job scheduled today, else its nearest pending job. Ask only when two sites or two jobs fit equally, and never invent one. One photo goes to exactly one job. Then make one job_assignments.update on that job carrying everything the report says: status completed only when they say the work is done (otherwise leave status out) and summary if they describe what was done; photo_evidence.create with one row per photo — photo is the attachment FileRef from the message files, source is {kind: "message", integration: "whatsapp", conversation_id: the message's chat, message_id: its message, attachment_id: the attachment file id, sender_id: its sender, sent_at: its time}; and communication_logs.create with one row per message about this work that has text — message, sent_at, sender and source_message_id: its message. Photos are filed only through that nested create, never photo_evidence directly: a direct create drops the message source. Confirm only after the update succeeds. You never assign, change or remove a job's contractor and never offer to: if someone asks, reply that a controller assigns contractors in the dispatch app. When you report a job, state only fields you read — read assignee_user_id (and the person it names) before saying who holds the work.

Pair the WhatsApp channel directly from that Envoy's inline card (choosing an **Import start** boundary
and scanning the QR or entering a pairing code), then verify **Envoy: Norbital** and **Active** in
**Manage → Configuration**.

- **Authority:** `field_ops_whatsapp` reads sites/assignments and updates `status`, `completed_at`,
  `summary`, nested `photo_evidence` and `communication_logs` — never creating, deleting or reassigning
  jobs and never exposing integrity flags or suspicion logs. Group turns run under the Envoy policy
  alone; DMs union the Envoy policy with the linked member's authority; unknown numbers are refused.
- **Session persistence:** Preserve the host database, file store and sealing master key together to keep
  WhatsApp pairing across restarts.

![Connected WhatsApp agent channel](screenshots/14-envoy-integrations.webp)

![Available connection providers](screenshots/15-envoy-provider-choice.webp)

![Connection tab of the paired instance](screenshots/35-envoy-connection.webp)

![Envoy deployment and active state](screenshots/16-envoy-configuration.webp)

![Integration message history with delivered Envoy replies](screenshots/17-envoy-messages.webp)

![WhatsApp provider setup](screenshots/18-envoy-whatsapp-setup.webp)

![Envoy DM transcript](screenshots/36-envoy-conversation.webp)
