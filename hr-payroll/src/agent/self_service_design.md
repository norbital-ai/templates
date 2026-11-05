---
name: Norbital HR Payroll V2 — Employee Self-Service
description: Incumbent native Norbital interface with V2 data.
---

# Design System: Norbital HR Payroll V2

## Overview

**Creative North Star: "Incumbent native Norbital"**

Restore the incumbent employee self-service interface with native V2 data. This app inherits the realm design system (the realm root's `.agent/DESIGN.md`), implemented by the installed `@norbital-ai/ui` package. This document records the local application of that system; it does not define another palette, font scale, or component theme.

**Key Characteristics:**

- Compact operational density and quiet hierarchy.
- Native shell, tabs, calendar, tables, and sheet forms.
- Equal hierarchy in light and dark themes; explicit loading, error, and empty states.

## Colors

Inherit the realm's warm cream light theme, midnight dark theme, neutral interaction colors, and restrained orange action accent. Use the installed semantic background, foreground, card, border, input, muted, primary, ring, and destructive tokens. Calendar categories use native chart tokens with meaningful text labels. Theme values remain owned by the realm and UI package, not copied here.

**The Native Inheritance Rule.** Use shared semantic tokens and native variants; do not create a local visual theme.

## Typography

Use native Geist Sans; reserve Geist Mono for appropriate technical data. Keep the package's complete heading and label recipes. Product text uses the existing compact UI band, with muted metadata beneath primary information. Header identity uses normal native emphasis. Do not restyle shared sheet titles or field labels at call sites.

## Layout

Use the full AppShell with its native banner/title and profile/face actions. Home is a bounded, inset Stack containing employment context and the real work calendar. Leave, Claim, Loan, and My payslips remain separate tabs. This is the restored self-service composition, not a mandate for unrelated apps.

Use Cover/Table for record views and native Sheet/Form for requests. Preserve compact named spacing and full-height content. Multiple active employments expose a labeled native picker; no active employment shows an honest gate. The first viewport retains the native title/profile/tabs and the calendar when employment is selected. Narrow horizontal tab strips move overflow into the native More menu, retaining the active state; do not introduce a separate mobile navigation design.

## Elevation & Depth

Follow native tonal surface steps and hairline borders. Resting content containers have no decorative elevation. Floating sheets and popovers retain package elevation and focus treatment; native input state shadows are not a general card-shadow style. Motion provides brief state feedback, including the existing loading skeleton, rather than page choreography.

## Shapes

Inherit compact control corners, restrained card corners, and native borders. Reuse package radius tokens rather than new local radii. The employment gate is a bordered card surface; the date selector uses compact bordered calendar cells and native buttons. Pills remain valid where the shared system uses them.

## Components

- **Shell and profile:** native full shell, employee identity and employment metadata, and contextual face enrollment/status action; no custom hero.
- **Tabs:** native icon-and-label navigation, native selection treatments, measured More overflow.
- **Calendar:** read-only EventCalendar for work, attendance, holidays, and leave. Keep date/view controls, timezone guidance, and explicit loading/error/incomplete states.
- **Tables:** native toolbar and compact record columns; actions reflect available capabilities.
- **Forms:** native Sheet, Form, Field, Combobox, and schema-driven Editor. Use shared focus, disabled, validation, and pending states. Leave dates remain a seven-column grid with selectable day or session buttons and disabled unavailable sessions.
- **Buttons:** retain native neutral/outline variants and their hover/focus/disabled feedback. Brand remains the realm's restrained chromatic action, not an extra local accent.

## Do's and Don'ts

### Do:

- **Do** inherit realm tokens and native component states.
- **Do** use named layout primitives and semantic text roles.
- **Do** preserve keyboard navigation, visible focus, labels, and non-color state cues.

### Don't:

- **Don't** add a separate app palette, font family, or oversized dashboard chrome.
- **Don't** replace the incumbent navigation and calendar with invented summary cards.
- **Don't** present unavailable employment data as a real calendar or successful empty result.
