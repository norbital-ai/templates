# Project Delivery

A project CRM for a services team: companies, contacts, engagements, documents, activities and issues.

Use the CRM to collect a company's NDA and project brief. Draft a statement of work in the SOW app,
preview its Markdown, and save or download the `.md` file. Attach the signed SOW in Documents, move
the project through review and submission, and track delivery milestones and issues against it.

The SOW scaffold leaves scope, acceptance criteria and commercial terms for the team to complete.
Document status and signature fields record the team's workflow; they do not provide electronic
signature verification.

The Transcriber records a microphone or imports an audio file, then runs speech recognition and
speaker labelling in the browser. Choose English, Chinese, Malay, Japanese or Indonesian; clips
are limited to ten minutes. Review the Markdown before downloading it or saving it as a project
activity. Audio uploads only when **Save recording with transcript** is selected; it is off by
default. Saving the activity sends its reviewed transcript to the workspace.

First use downloads model files and needs an internet connection. Microphone capture requires
HTTPS or localhost. Speaker labels are anonymous, support up to three speakers, and can be wrong;
review both the words and labels. The worker uses pinned revisions of
[Whisper base](https://huggingface.co/onnx-community/whisper-base_timestamped/tree/608c49e61301901684bc36cac8f74b95ff6b5a8e)
and [pyannote segmentation](https://huggingface.co/onnx-community/pyannote-segmentation-3.0/tree/733a93b6473d019a773298e08cefa686894b1854)
through Transformers.js 3.8.1.

## Development

Requires Node 26 or newer and pnpm. Run commands inside this directory:

```sh
pnpm install --frozen-lockfile
pnpm sync
pnpm lint
pnpm test
pnpm test:e2e
```

The template pins its Norbital packages. Its committed migrations are schema history; keep them
when adding fields. Use the realm's local package overlay when testing unpublished package changes.
