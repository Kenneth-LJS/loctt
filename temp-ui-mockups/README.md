# UI mockups

Static HTML/CSS/JS mockups of the LocTT web UI. Open any `.html` file
directly in a browser — there is no build step and no server.

## What these are

A **visual starting point**, not a specification. They were drawn before
most of the UI existed, to decide layout, density, and vocabulary.

Where a mockup and a spec disagree, **the spec wins**:

| Question | Authority |
|---|---|
| What a screen must do | `docs/dev/ui-test-cases/` |
| What the data looks like | `docs/dev/schema-reference.md` |
| What was decided and why | `docs/dev/decisions.md` |
| What it should look like | these mockups |

Drift is expected. These are not kept in sync with the app, and a
difference between a mockup and the shipped UI is not automatically a
bug — check the flow's test cases before treating it as one.

## What is actually live

`tokens.css` is the upstream source of the app's design tokens. All 39
custom properties in `apps/web/src/client/styles/tokens.css` originate
here.

It also defines a further 22 `--sw-*` label swatch tokens (`--sw-amber-bg`
through `--sw-violet-bg`) that the app has **not** adopted. Those are
available if and when label colours are implemented.

Changing a shared token here does not change the app — copy it across
deliberately.

## Files

| File | Screen |
|---|---|
| `index.html` | App shell / navigation |
| `init.html` | Onboarding |
| `list.html` | Task list |
| `board.html` | Board |
| `timeline.html` | Timeline |
| `task-detail.html` | Task detail |
| `create-task.html` | Task creation |
| `settings.html` | Settings |
| `tokens.css` | Design tokens (see above) |
| `app.js`, `views.js` | Mockup interactivity — throwaway, not app code |

`app.js` and `views.js` exist only to make the mockups clickable. They
share no code with `apps/web` and are not a reference implementation.
