# Roder Desktop Design

This document defines the design principles and reusable UI guidance for Roder
Desktop. It is meant for humans and coding agents making product UI decisions.
Use it before introducing new surfaces, changing existing interaction patterns,
or inventing visual language.

This is not a component inventory. Current screens should inform the principles,
but the principles should travel across the whole app.

## Purpose

Roder Desktop is a local workbench for agentic software work. It should help
people move between conversation, code, terminal output, browser state, files,
and tools without losing their place.

The design goal is not to make the app feel minimal for its own sake. The goal
is to make powerful work feel steady, legible, and close at hand.

## Design Principles

### Local Workbench, Not Web App Chrome

Roder should feel like a desktop working environment. Avoid marketing-page
composition, oversized hero treatment, decorative sections, and UI that feels
like a website wrapped in Electron.

Prefer compact, durable surfaces that support long sessions: sidebars,
resizable panels, stable headers, toolbars, menus, and direct manipulation.

### Conversation Is The Spine

The thread is the primary object. Other UI exists to support the active thread:
workspace context, tool output, model choice, attachments, navigation, and
follow-up input.

When adding UI, ask how it relates to the current thread. If it does not affect
the thread or the user's current work context, it probably belongs in settings,
a secondary panel, or a dedicated view rather than the main conversation flow.

### Context Stays Visible

Users should usually know three things without hunting:

- What thread they are in.
- Which workspace or folder it belongs to.
- Which tools or side panels are active.

Preserve context through compact breadcrumbs, selected states, visible active
tools, and stable placement. Collapsed states should retain orientation rather
than hiding all context behind a single generic button.

### Powerful Without Crowding

Roder has many capabilities. The interface should expose them through hierarchy,
proximity, and progressive disclosure instead of showing everything with equal
weight.

Put primary work controls near the work. Keep advanced or occasional controls
available, but quiet. A capable surface can still be calm if the most important
action is obvious and secondary actions do not compete with it.

### Tools Are Adjacent, Not Dominant

Terminal, browser, canvas, extensions, and future tools should feel attached to
the current work surface. They should be easy to open, resize, and dismiss, but
they should not visually overtake the thread unless the user chooses to focus
them.

Prefer side panels, rails, compact toggles, and contextual attachment flows over
large modal takeovers.

### Polished, Not Ornamental

Visual polish should come from alignment, spacing, typography, motion, contrast,
and crisp interaction states. Avoid decoration that does not carry information
or improve usability.

Good Roder UI feels intentional and quiet. It does not need gradients, floating
cards, illustrated empty marketing panels, or extra borders to feel finished.

### Respect User Intent

Do not steal focus, reset scroll, collapse panels, or move controls unless the
user action clearly asked for it. Treat scroll position, active tools, selected
workspace, typed input, and attachments as valuable state.

When the agent is busy, the UI should make interruption, steering, and
follow-up feel possible without forcing a mode switch.

## Product Personality

Roder should feel:

- Calm, but not sparse.
- Capable, but not crowded.
- Technical, but not hostile.
- Local and immediate, not cloud-console distant.
- Precise, but not brittle.
- Warm through clarity and responsiveness, not through decorative friendliness.

The app can have personality, but it should be felt in the quality of the
workflow: stable layout, helpful defaults, well-timed motion, readable output,
and controls that appear where a working developer expects them.

## Foundations

### Color

Use semantic tokens before raw colors. Main content and sidebar surfaces have
separate token families so navigation can remain visually distinct from the
work area.

Color should primarily communicate:

- Surface hierarchy.
- Selection and active state.
- Muted metadata.
- Focus and affordance.
- Status for running, successful, and failed tool activity.

Avoid broad one-note color themes in core UI. Accent color should guide
attention, not become the whole interface.

### Typography

Text should be optimized for long working sessions.

- Use UI text for controls, labels, metadata, and menus.
- Use slightly larger, comfortable text for transcript content and composer
  input.
- Use monospace for code and compact tool telemetry.
- Keep headings inside product surfaces modest. A settings panel, sidebar group,
  menu, or transcript message should not use hero-scale type.
- Preserve readable line height in conversation content.

### Spacing And Density

Prefer Tailwind's standard spacing scale. Density is part of the product: Roder
should fit meaningful work on screen without feeling cramped.

Use spacing to show relationships:

- Tight spacing for controls within the same action group.
- Moderate spacing between independent controls.
- Larger spacing between navigation groups or major regions.
- Consistent horizontal alignment between transcript and composer content.
- Consistent horizontal alignment between a page header and its primary content.

For full-page tool views with a header and a content grid, the header title,
toolbar controls, filters, empty states, and first grid column should share the
same horizontal inset. If the header uses `px-4`, the scrollable grid should use
`px-4` as well, with vertical spacing adjusted separately using standard scale
tokens such as `py-6`.

Search, provider, and category filters should live inline with the content they
affect, usually as the first row of the content grid. Avoid full-width filter
bars with their own divider unless the filter controls need to remain pinned
while a long, dense list scrolls underneath.

When filters do need to stay visible during scrolling, keep the inline grid-row
treatment: make the filter row sticky inside the scroll area, preserve the same
horizontal inset as the grid, and use a quiet background rather than adding a
new full-width bordered toolbar. Give sticky filter rows enough vertical padding
to feel intentional without needing extra borders or elevation.

Avoid arbitrary values unless they come from a concrete platform, asset, or
interaction constraint.

### Shape

Rounded controls are part of the app language, especially for rows, pills,
menus, chips, icon buttons, and the composer. Use shape to make interactive
regions friendly and easy to target.

Do not turn every section into a card. Cards should frame repeated items,
messages, dialogs, or genuinely contained tools. Full page regions should remain
layouts, not nested card stacks.

### Borders, Elevation, And Surfaces

Use borders and subtle shadows to clarify containment, not to decorate. A
surface should earn its frame by holding input, selection, floating menu
content, or a separate tool context.

Prefer quiet contrast between surfaces. Heavy shadows, bright outlines, and
stacked borders should be rare.

### Motion

Motion should explain state change:

- Panels opening and closing.
- Overflow content expanding.
- Hover or focus actions appearing.
- Menus entering or leaving.
- Busy or streaming state changing.

Keep motion short and local. Always honor reduced-motion preferences. If timing
is important to understanding a complex transition, document it near the CSS as
a small storyboard.

## Interaction Rules

### Selection And Active State

Selected state should be immediately visible but not loud. Use background,
foreground, and subtle weight changes before introducing badges or extra icons.

Only one thing should look primary inside a local group. If several controls are
active, distinguish "selected", "available", and "running" states clearly.

### Hover, Focus, And Hidden Actions

Hover-revealed controls are allowed for secondary actions such as archive or
remove, but they must also be reachable by focus. The default state should still
communicate enough information for the row or chip to be useful.

Icon-only controls need accessible names. Tooltips are useful when the icon is
not self-evident or when the action is potentially destructive.

### Scrolling

Scrolling is user intent. Follow streaming output only when the user is already
near the bottom or explicitly asks to return there. Avoid sudden scroll jumps
when content updates, tools finish, or side panels change.

Use fades and affordances sparingly to clarify that content continues beneath a
fixed composer or toolbar.

### Disclosure

Reveal complexity in layers. Use compact rows, menus, segmented controls,
overflow regions, and side panels before adding large permanent UI.

Disclosure should preserve orientation: "show more" should expand within the
same context; collapsed navigation should still reveal where the user is.

### Busy And Interruptible Work

Busy state should not freeze the app into a waiting room. Users should be able
to inspect output, steer the run, stop the run, attach context, switch tools,
and prepare a follow-up.

Use language that reflects this: prefer prompts that invite steering or
follow-up over passive loading copy.

### Drag, Drop, And Attachments

Drag-and-drop should highlight the region that will receive files. Attachments
should appear as compact, removable objects with enough identity to verify the
selection.

Attached context should feel connected to the composer and thread, not like a
separate upload workflow.

### Resizing And Layout Control

Resizable regions should have stable limits and obvious handles. Resizing should
never hide the primary thread or make core controls unreachable.

If a panel can be dismissed, restored, or resized, preserve the user's last
reasonable choice where practical.

## Layout Patterns

### App Shell

The preferred shell is:

- Left navigation for sessions, workspaces, and durable app areas.
- Center work surface for the active thread and composer.
- Optional right-side tools for adjacent context.

This layout supports long-running work because navigation, conversation, and
tools stay visible together.

### Central Work Surface

The transcript and composer should share a visual axis. The user should feel
they are writing into the same space where the answer will appear.

Keep the central column readable. Avoid stretching prose, prompt text, and tool
summaries across the full window width when side panels are closed.

### Sidebar Navigation

Navigation should be optimized for scan and return:

- Group related sessions by meaningful workspace context.
- Sort by recency where recency reflects likely user intent.
- Use concise labels and muted metadata.
- Reveal secondary row actions without making them visually dominant.
- Keep empty states useful and quiet.

### Tool Panels

Tool panels should use the same foundations as the rest of the app, but can be
denser when the tool demands it. A terminal, browser, canvas, and extension
panel have different content needs; their chrome should still feel related.

Prefer attachment or handoff actions that move useful tool context back into the
thread.

### Composer Zone

The composer is the most important input surface. Keep the prompt primary, with
model, reasoning, workspace, attachments, stop, and auxiliary actions arranged
around it by frequency and urgency.

The composer may be visually richer than surrounding chrome because it is the
place where work is initiated. That richness should support input, not distract
from it.

## Component Principles

### Buttons And Icons

Use icons for common concrete actions: new, archive, attach, stop, scroll,
toggle, open, close, search, and settings. Pair icons with text when the action
is uncommon, ambiguous, or high consequence.

Icon buttons should have stable dimensions so hover, active, loading, or selected
states do not shift nearby UI.

### Menus And Pickers

Menus should be compact, searchable when lists can grow, and clear about the
selected item. Put metadata in muted text. Use checkmarks or selected styling,
not both at maximum emphasis.

Pickers should show the current choice in terms users recognize: model name,
folder name, thread title, or provider identity.

### Lists And Rows

Rows should be single-purpose and easy to scan. Put the primary label first,
metadata second, and actions at the edge. Avoid wrapping row labels unless the
row is designed for rich content.

### Transcript Content

Conversation content should prioritize readability. Assistant prose should not
need a heavy container. User messages, tool calls, errors, and phase updates can
use different treatments, but the transcript should remain one continuous work
log.

Markdown rendering should adapt to the conversation context. Headings inside a
message should organize the answer, not compete with app-level headings.

### Empty And Error States

Empty states should explain what is absent and provide the next useful action
when one exists. Keep them brief. Do not use empty states as marketing copy.

Error states should preserve work and offer recovery. If a restart, retry, or
manual action exists, put it near the error.

## Do And Avoid

Do:

- Start from the user's current thread and workspace.
- Keep primary actions close to the surface they affect.
- Use existing tokens, spacing, typography, and row patterns.
- Make active state and selected context visible.
- Preserve user state during updates.
- Prefer compact controls over explanatory text.
- Verify hover-only actions with keyboard focus.

Avoid:

- Marketing layouts inside the app shell.
- Decorative cards, gradients, or illustrations in core work surfaces.
- New arbitrary spacing values without a concrete reason.
- Multiple competing primary actions in one region.
- Modal takeovers for workflows that can live in a panel or menu.
- Source-string tests for visual choices that should be verified by review,
  typecheck, or browser inspection.
- Hiding all context in collapsed states.

## Applying This Document

When designing or changing UI:

1. Identify the user job and where it sits relative to the active thread.
2. Choose the smallest surface that supports the job: inline control, menu,
   sidebar row, composer affordance, side panel, settings panel, or dedicated
   view.
3. Reuse nearby patterns before creating a new one.
4. Check the foundations: color, type, spacing, shape, motion, and accessibility.
5. Ask what state must be preserved while the user or agent keeps working.
6. Verify the result in the app, especially at narrow widths and with active
   side panels.

For implementation reference, the current core surfaces live in:

- `src/App.tsx`
- `src/components/app-sidebar.tsx`
- `src/components/top-bar.tsx`
- `src/components/transcript.tsx`
- `src/components/message-content.tsx`
- `src/components/tool-timeline-item.tsx`
- `src/components/composer.tsx`
- `src/style.css`
