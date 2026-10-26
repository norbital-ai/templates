# Field Operations workflows

The [template README](../README.md#operating-walkthrough) contains the complete operating
walkthrough: member setup, mapped sites, dispatch, Contractor completion, imports, variations,
evidence, review, resolution, handover and WhatsApp Envoy setup.

Teams, policy links and approval flows are authored in source. People selects existing roles;
it does not edit those definitions. Connected services use Settings → Integrations and native
pairing/status controls. Credentials remain sealed; available providers determine the setup flow.

A submitted approval proposal is awaiting a decision, not a completed business write. Record
sheets retain the surrounding record context; their tabs and accordion sections disclose details.

## Snapshot index

These local browser snapshots use the public seed and invented walkthrough records. The member
invitation is a draft, and its crop excludes the existing member list. Pairing codes, credentials,
private phone numbers, private chat contents and bank photo assets are excluded.

| Flow                                | Snapshots                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dispatch                            | [Board](screenshots/01-dispatch-board.jpg), [assignment](screenshots/03-assignment-progress.jpg), [Contractor scope](screenshots/06-contractor-jobs.jpg), [completion](screenshots/27-contractor-completion.jpg)                                                                                                                                                                                                                                     |
| Required location and optional unit | [New site](screenshots/02-new-job-and-site.jpg), [edit site](screenshots/04-sites.jpg), [missing location](screenshots/20-location-required.jpg), [duplicate refusal](screenshots/25-site-duplicate-validation.jpg)                                                                                                                                                                                                                                  |
| Site records                        | [History](screenshots/05-site-history.jpg), [table](screenshots/26-sites-table.jpg)                                                                                                                                                                                                                                                                                                                                                                  |
| Import                              | [Created](screenshots/22-import-result.jpg), [repeat](screenshots/23-import-repeat.jpg), [validation](screenshots/24-import-validation.jpg)                                                                                                                                                                                                                                                                                                          |
| Variation approval                  | [Proposal](screenshots/07-variation-proposal.jpg), [decisions](screenshots/08-approvals.jpg), [pending](screenshots/28-variation-pending.jpg), [changes requested](screenshots/29-approval-changes-requested.jpg), [resubmitted](screenshots/30-approval-resubmitted.jpg), [approved timeline](screenshots/31-approval-approved.jpg), [rejected](screenshots/33-approval-rejected.jpg), [restored value](screenshots/34-rejected-value-restored.jpg) |
| Photo evidence                      | [Filed by a Contractor](screenshots/09-photo-filed.jpg), [inspection facts](screenshots/10-photo-inspection.jpg)                                                                                                                                                                                                                                                                                                                                     |
| Review and resolution               | [Review result](screenshots/11-suspicion-review.jpg), [resolution form](screenshots/12-human-resolution.jpg), [resolved finding](screenshots/32-finding-resolved.jpg)                                                                                                                                                                                                                                                                                |
| Site handover                       | [Succeeded with downloads](screenshots/13-site-handover.jpg)                                                                                                                                                                                                                                                                                                                                                                                         |
| People                              | [Contractor invitation draft](screenshots/19-member-setup.jpg)                                                                                                                                                                                                                                                                                                                                                                                       |
| Envoy setup                         | [Connected agent channel](screenshots/14-envoy-integrations.jpg), [providers](screenshots/15-envoy-provider-choice.jpg), [configuration](screenshots/16-envoy-configuration.jpg), [messages](screenshots/17-envoy-messages.jpg), [WhatsApp setup](screenshots/18-envoy-whatsapp-setup.jpg)                                                                                                                                                           |

The browser walkthrough covers real form validation and workflow transitions, including an
approval rejection that restored the previous amount and a site handover whose four files were
downloaded as the Controller. The photo pass verified the automatic inspection facts; the AI
suspicion review snapshot comes from an earlier run on an assignment, not from this photo. Automated suites
separately cover approval rollback, evidence integrity, policy boundaries, Envoy attachment filing
and scripted model responses. A provider's Connected state and a delivered query do not establish
delivery of every possible attachment or group scenario.
