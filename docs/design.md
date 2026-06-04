# Roder Desktop Design

Use this when adding or changing product UI in Roder Desktop. It is a working
contract, not a mood board.

Roder is a desktop workbench for agentic software work. The interface should
help people move between conversation, code, terminal output, browser state,
files, and tools without losing their place.

## Defaults

Start here before inventing a new treatment.

- Use the existing Base UI primitives and local shadcn-style wrappers.
- Use semantic Tailwind tokens before raw colors.
- Use `text-base` for normal UI text. In this app `text-base` maps to
  `--font-size-ui`, currently `14px`.
- Use `font-medium` by default for product UI text.
- Use `bg-background`, `bg-card`, `bg-popover`, or `bg-white` for primary
  surfaces. In the light theme these are white.
- Use lighter grey state fills: `bg-accent/60`, `bg-muted/30`,
  `bg-muted/40`, `bg-muted/50`, `bg-sidebar-active/20`, and
  `bg-sidebar-active/25`.
- Prefer `rounded-lg` for ordinary controls and contained blocks.
- Prefer `rounded-xl` for app chrome, sidebar rows, settings sections, and
  larger row hit areas.
- Use `rounded-md` for compact buttons, inputs, badges, code chips, and dense
  tool controls.
- Use `rounded-full` only for pills, toggles, avatars, circular icon buttons,
  and the composer submit button.
- Reserve `rounded-2xl` and `rounded-3xl` for deliberately soft surfaces such
  as the composer, completion popups, dialogs, and marketplace cards.
- Prefer Tailwind's standard spacing scale. Avoid arbitrary values unless they
  come from a platform constraint, an asset size, or a measured interaction need.

## Typography

- Default to `text-base`.
- Use `text-sm` for secondary metadata, timestamps, keyboard hints, and compact
  status labels.
- Use `text-xs` rarely, only where space is genuinely constrained.
- Do not use hero-scale type inside app surfaces. Settings headings, sidebar
  groups, transcript headings, menus, and panel titles should stay modest.
- Use `font-normal` only for longer prose, muted descriptions, markdown body
  text, and places where medium weight creates too much visual noise.
- Use `font-semibold` sparingly for section titles, important status, and
  selected states that need more emphasis than a background change.
- Use `font-mono` with `--font-size-code` for code, terminal output, command
  telemetry, and file paths.
- Composer input can use `--font-size-composer` because it is the primary
  writing surface.

## Color And Surfaces

The default app material is white. Add grey only to show hierarchy, hover,
selection, disabled state, or muted structure.

- Main work surfaces: `bg-background`.
- Cards and raised input surfaces: `bg-card` or `bg-card/95`.
- Floating menus, dialogs, and popovers: `bg-white` or `bg-popover`.
- Subtle contained areas: `bg-muted/30` through `bg-muted/50`.
- Hover on white/card surfaces: `hover:bg-accent/60` or `hover:bg-muted/40`.
- Sidebar row hover: `hover:bg-sidebar-active/20` or
  `hover:bg-sidebar-active/25`.
- Lightweight selected state: `bg-muted/50`, `bg-accent/60`, or the matching
  sidebar active token at low opacity.

Avoid heavy grey blocks that make the interface feel dirty or reduce contrast.
Use full-strength `bg-muted`, `bg-accent`, or `bg-sidebar-active` only when the
state needs to be unmistakable.

Accent colors should communicate status or action. They should not become a
theme wash across ordinary chrome.

## Radius

Use radius to clarify interaction shape. Do not use radius to make every region
look like a card.

- `rounded-md`: dense controls, toolbar buttons, badges, code chips, compact
  inputs, keyboard hints.
- `rounded-lg`: default control radius for rows, inputs, empty-state blocks,
  small tool panels, and ordinary contained areas.
- `rounded-xl`: app chrome rows, sidebar rows, settings shells, larger list
  items, and comfortable hit areas.
- `rounded-full`: pills, toggles, avatars, circular icon buttons, submit/stop
  buttons.
- `rounded-2xl` / `rounded-3xl`: high-emphasis soft surfaces such as the
  composer, completion popups, large dialogs, marketplace cards, and sketch/canvas
  tools.

When nesting rounded surfaces, account for padding so the radii align
optically. As a rule of thumb, the outer radius should be the inner radius plus
the visible inset between them. If a `rounded-lg` child sits inside a padded
surface, the parent usually needs a larger radius such as `rounded-xl` or
`rounded-2xl`.

Avoid new `rounded-[...]` values unless they match an existing nearby component
or solve a measured visual mismatch.

## Borders, Rings, And Elevation

- Use borders for structural separators, flat controls, attachment dividers,
  list rules, dashed drop targets, and table-like content.
- Use `ring-1` for raised surfaces so the frame does not affect layout.
- Use `ring-border/70` for ordinary raised app surfaces.
- Use `ring-foreground/10` for floating menus and dialogs.
- Use `ring-ring` only for focus, drag, active interaction, or validation.
- Avoid combining `shadow-*` with `border border-*` on the same raised surface;
  prefer `shadow-* ring-1 ring-border/70`.
- Keep shadows subtle. Elevation should separate layers, not decorate.

## Spacing And Density

Roder should fit real work on screen without feeling cramped.

- Use tight gaps for controls in the same action group.
- Use moderate gaps between independent controls.
- Use larger gaps between major regions.
- Keep transcript and composer content on the same visual axis.
- Keep page headers, filters, empty states, and first grid columns aligned.
- For square buttons or icons, use `size-*` instead of separate `h-*` and `w-*`.
- Make fixed-format controls stable so hover, active, loading, and selected
  states do not resize nearby UI.

Filters should usually live inline with the content they affect. If a filter row
must stay visible while content scrolls, make it sticky inside the scroll area
with the same horizontal inset as the grid and a quiet white or light grey
background.

## Motion

When UI appears, hides, expands, collapses, moves, or changes visibility, use
the web animation and Interface Craft skills for the specific animation design
and implementation guidance.

In this document, keep only the product intent: motion should explain state
change, preserve orientation, and avoid slowing down repeated work.

## Component Rules

- Buttons: use icons for concrete common actions; add text for ambiguous,
  uncommon, or high-consequence actions.
- Icon buttons: keep stable dimensions across hover, active, loading, and
  selected states.
- Icons: balance them optically with adjacent text and their hit area. Center
  icons by visual weight, choose sizes that feel proportional to the label and
  control height, and adjust gaps before reaching for a custom icon size.
- Menus: keep compact, searchable when lists can grow, and clear about the
  selected item.
- Pickers: show choices using names users recognize: model, folder, thread, or
  provider.
- Rows: primary label first, metadata second, actions at the edge.
- Empty states: explain what is absent and provide the next useful action when
  one exists. Keep copy short.
- Error states: preserve work and put retry, restart, or manual recovery near
  the error.

## Implementation Checklist

Before finishing UI work:

1. Confirm the job belongs where you placed it relative to the active thread.
2. Reuse nearby component patterns before introducing a new one.
3. Check text size, white surface use, grey state strength, radius, spacing,
   borders/rings, and motion.
4. Verify hover-only actions with keyboard focus.
5. Preserve scroll, selection, workspace, typed input, attachments, panel state,
   and active tool state.
6. Run typecheck, relevant tests, build, or another verification that matches
   the risk of the change.
7. For desktop UI visual verification, ask the user to test in the running
   Electron app instead of relying on a plain browser against the Vite renderer.

Current reference files:

- `src/components/app-shell-layout.tsx`
- `src/components/app-sidebar.tsx`
- `src/components/top-bar.tsx`
- `src/components/transcript.tsx`
- `src/components/message-content.tsx`
- `src/components/composer.tsx`
- `src/components/right-workspace-panel-shell.tsx`
- `src/style.css`
