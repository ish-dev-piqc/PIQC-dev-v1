# Landing-page product screenshots

These screenshots live under `/screenshots/` and are referenced from the **How Teams Use It** section in `src/components/ValueProps.tsx`.

## What to capture

Run the app locally against the seeded demo dataset (per CLAUDE.md, all test fixtures use the seeded demo set — never real participant data). Capture each shot at 2x resolution (Retina) and save as PNG.

| Filename                | What's in the shot                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `site-mode-calendar.png` | Site Mode visit calendar — week view with a few visits, demo participant labels.   |
| `site-mode-visit.png`   | A single visit expanded, showing a structured procedure step + the deeper detail.  |
| `audit-mode-compare.png` | Audit Mode comparison view — protocol-required vs. what-happened, with a note.    |
| `audit-mode-findings.png` *(optional)* | Findings/notes panel with one entry traced back to protocol logic.  |

## PHI / demo-data audit before commit

Before adding the PNGs:

1. Confirm every name, MRN, DOB, site name, and protocol title is from the seeded demo set.
2. Zoom in on each screenshot. Anything that looks like a real person's name or a real protocol code → re-capture with the seed renamed first.
3. Run `git diff --stat public/screenshots/` and visually inspect each file before committing.

## How to embed them in ValueProps

Open `src/components/ValueProps.tsx`. In the **modes** array (currently text-only `bullets`), add an optional `screenshot` field per mode and render it below the bullets:

```tsx
const modes = [
  {
    icon: Workflow,
    label: 'Site Mode',
    tagline: 'For running the trial',
    screenshot: '/screenshots/site-mode-calendar.png',
    bullets: [ /* ... */ ],
  },
  {
    icon: FileSearch,
    label: 'Audit Mode',
    tagline: 'For reviewing execution',
    screenshot: '/screenshots/audit-mode-compare.png',
    bullets: [ /* ... */ ],
  },
];
```

Then inside the mode card render (after the `<ul>` of bullets):

```tsx
{screenshot && (
  <div className="mt-6 rounded-xl overflow-hidden border border-[#e2e8ee] dark:border-white/[0.07]">
    <img
      src={screenshot}
      alt={`${label} screenshot`}
      className="w-full h-auto block"
      loading="lazy"
    />
  </div>
)}
```

That's the full integration — the FadeInUp wrapper around the card already covers the screenshot animation.
