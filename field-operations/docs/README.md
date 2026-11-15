# Field Operations workflows

![Field Operations application](screenshots/application.webp)

The [template README](../README.md#operating-walkthrough) contains the complete operating
walkthrough: member setup, mapped sites, dispatch, Contractor completion, imports,
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

| Flow                                | Snapshots                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dispatch                            | [Board](screenshots/application.webp), [assignment](screenshots/job-record.webp), [Contractor scope](screenshots/contractor-jobs.webp), [completion](screenshots/contractor-jobs.webp)                                                                                                          |
| Required location and optional unit | [New site](screenshots/new-site.webp), [edit site](screenshots/sites.webp), [missing location](screenshots/site-validation.webp), [duplicate refusal](screenshots/new-site.webp)                                                                                                                |
| Site records                        | [History](screenshots/site-history.webp), [table](screenshots/sites.webp)                                                                                                                                                                                                                       |
| Import                              | [Created](screenshots/dispatch-import.webp), [repeat](screenshots/dispatch-import.webp), [validation](screenshots/dispatch-import.webp)                                                                                                                                                         |
| Photo evidence                      | [Filed by a Contractor](screenshots/09-photo-filed.webp), [inspection facts](screenshots/10-photo-inspection.webp)                                                                                                                                                                              |
| Review and resolution               | [Review result](screenshots/review-controls.webp), [resolution form](screenshots/review-controls.webp), [resolved finding](screenshots/review-controls.webp)                                                                                                                                    |
| Site handover                       | [Succeeded with downloads](screenshots/13-site-handover.webp)                                                                                                                                                                                                                                   |
| People                              | [Contractor invitation draft](screenshots/19-member-setup.webp)                                                                                                                                                                                                                                 |
| Envoy setup                         | [Connected agent channel](screenshots/14-envoy-integrations.webp), [providers](screenshots/15-envoy-provider-choice.webp), [configuration](screenshots/16-envoy-configuration.webp), [messages](screenshots/17-envoy-messages.webp), [WhatsApp setup](screenshots/18-envoy-whatsapp-setup.webp) |

The browser walkthrough covers real form validation and workflow transitions, including an
approval rejection that restored the previous amount and a site handover whose four files were
downloaded as the Controller. The photo pass verified the automatic inspection facts; the AI
suspicion review snapshot comes from an earlier run on an assignment, not from this photo. Automated suites
separately cover approval rollback, evidence integrity, policy boundaries, Envoy attachment filing
and scripted model responses. A provider's Connected state and a delivered query do not establish
delivery of every possible attachment or group scenario.
