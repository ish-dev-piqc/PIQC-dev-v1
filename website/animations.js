/* ============================================================================
   animations.js — behavior for the PIQClinical marketing site (ES module).
   No frameworks. Copy/mock data comes from /content.js.

   ────────────────────────── DATA-API CONTRACT ──────────────────────────
   Pages MUST match these hooks exactly. Everything below is progressive
   enhancement: with JS disabled (or prefers-reduced-motion) the markup's
   default state is the complete, settled final state.

   GLOBAL
   • On load this module adds class "js" to <html>. site.css uses it to keep
     [data-reveal] content visible when JS never runs.
   • prefers-reduced-motion: reduce → all sequencing is skipped and final
     states are set immediately.

   SCROLL REVEAL
   • [data-reveal] — IntersectionObserver adds .is-visible once, then
     unobserves. CSS transition lives in site.css.

   SEQUENCED MOCKUP INTROS
   • [data-anim="home-flow" | "ask-source" | "site-checklist" |
     "audit-pipeline" | "sponsor-fanout" | "security-shield"]
     — container gets .anim-prep at init (JS only), then when it scrolls into
     view each child [data-step] receives .is-shown, staggered using the
     --anim-base token. ONE pass to a settled end state; nothing loops, so no
     .anim-pause control is rendered (any future looping animation MUST
     render one — the .anim-pause class is styled in site.css).

   ROLE-FILTER DEMO
   • [data-demo="role-filter"] root contains:
       – buttons .chip[data-role="all|coordinator|nurse|investigator|lab|pharmacy"]
         (matched case-insensitively; label text is what's displayed)
       – rows [data-row] with data-roles="coordinator investigator" (space-
         separated, lowercase; empty/absent = visible for every role)
       – optional [data-count]        → textContent set to visible-row count
       – optional [data-export-label] → "Export <Role> worksheet", or
                                        "Export full worksheet" when All
     Chips get aria-pressed + .is-active; default = All.

   ASK DEMO
   • [data-demo="ask"] root contains:
       – chips .chip[data-example-idx="0|1|2"] (index into
         content.askSourceOfTruth.examples)
       – [data-ask-answer]   → answer text target
       – [data-ask-citation] → citation card; gets .is-entering flick to
         re-run its slide-in transition
       – [data-ask-quote], [data-ask-ref] → citation quote/ref targets
       – optional [data-ask-input] → free-text input; JS keeps it disabled
         with content.askSourceOfTruth.inputPlaceholder
     Markup default = examples[0] fully rendered (JS-off fallback).

   MOBILE NAV
   • .site-nav contains .nav-toggle[aria-controls="site-menu"] and
     .nav-links#site-menu. Toggle syncs aria-expanded and .is-open on
     .site-nav. Escape closes; choosing a link closes.
   ──────────────────────────────────────────────────────────────────────── */

import { content } from '/content.js';

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.documentElement.classList.add('js');

/* ── Motion token (ms) read from tokens.css so pacing is tuned in one place ── */
function tokenMs(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

/* ── Scroll reveal ─────────────────────────────────────────────────────── */
function initReveal() {
  const els = document.querySelectorAll('[data-reveal]');
  if (!els.length) return;
  if (REDUCED || !('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      io.unobserve(entry.target);
    });
  }, { threshold: 0.15 });
  els.forEach((el) => io.observe(el));
}

/* ── Sequenced mockup intros (one pass, settled end state) ─────────────── */
function initSequences() {
  const roots = document.querySelectorAll('[data-anim]');
  if (!roots.length) return;
  // Reduced motion / no IO: markup already shows the settled final state.
  if (REDUCED || !('IntersectionObserver' in window)) return;
  const stagger = tokenMs('--anim-base', 220);
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const root = entry.target;
      io.unobserve(root);
      root.querySelectorAll('[data-step]').forEach((step, i) => {
        window.setTimeout(() => step.classList.add('is-shown'), i * stagger);
      });
    });
  }, { threshold: 0.35 });
  roots.forEach((root) => {
    root.classList.add('anim-prep'); // initial state is set by JS, never by markup
    io.observe(root);
  });
}

/* ── Role-filter demo ──────────────────────────────────────────────────── */
function initRoleFilter() {
  document.querySelectorAll('[data-demo="role-filter"]').forEach((root) => {
    const chips = Array.from(root.querySelectorAll('.chip[data-role]'));
    const rows = Array.from(root.querySelectorAll('[data-row]'));
    const countEl = root.querySelector('[data-count]');
    const exportEl = root.querySelector('[data-export-label]');
    if (!chips.length || !rows.length) return;

    const apply = (role) => {
      let visible = 0;
      rows.forEach((row) => {
        const roles = (row.getAttribute('data-roles') || '')
          .toLowerCase().split(/\s+/).filter(Boolean);
        const show = role === 'all' || roles.length === 0 || roles.includes(role);
        row.hidden = !show;
        if (show) visible += 1;
      });
      if (countEl) countEl.textContent = String(visible);
      let activeLabel = '';
      chips.forEach((chip) => {
        const active = (chip.getAttribute('data-role') || '').toLowerCase() === role;
        chip.classList.toggle('is-active', active);
        chip.setAttribute('aria-pressed', String(active));
        if (active) activeLabel = chip.textContent.trim();
      });
      if (exportEl) {
        exportEl.textContent = role === 'all'
          ? 'Export full worksheet'
          : 'Export ' + activeLabel + ' worksheet';
      }
    };

    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        apply((chip.getAttribute('data-role') || 'all').toLowerCase());
      });
    });
    apply('all');
  });
}

/* ── Ask demo ──────────────────────────────────────────────────────────── */
function initAsk() {
  const ask = content && content.askSourceOfTruth;
  const examples = (ask && ask.examples) || [];
  document.querySelectorAll('[data-demo="ask"]').forEach((root) => {
    const chips = Array.from(root.querySelectorAll('[data-example-idx]'));
    const answerEl = root.querySelector('[data-ask-answer]');
    const citationEl = root.querySelector('[data-ask-citation]');
    const quoteEl = root.querySelector('[data-ask-quote]');
    const refEl = root.querySelector('[data-ask-ref]');
    const inputEl = root.querySelector('[data-ask-input]');
    if (inputEl) {
      inputEl.disabled = true;
      if (ask && ask.inputPlaceholder) inputEl.placeholder = ask.inputPlaceholder;
    }
    if (!chips.length) return;

    const select = (idx, animate) => {
      const example = examples[idx];
      if (!example) return;
      if (answerEl) answerEl.textContent = example.answer;
      if (quoteEl) quoteEl.textContent = example.citation.quote;
      if (refEl) refEl.textContent = example.citation.ref;
      if (citationEl && animate && !REDUCED) {
        citationEl.classList.add('is-entering');
        void citationEl.offsetWidth; // restart the slide-in transition
        citationEl.classList.remove('is-entering');
      }
      chips.forEach((chip) => {
        const active = Number(chip.getAttribute('data-example-idx')) === idx;
        chip.classList.toggle('is-active', active);
        chip.setAttribute('aria-pressed', String(active));
      });
    };

    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        select(Number(chip.getAttribute('data-example-idx')), true);
      });
    });
    select(0, false); // markup default is examples[0]; sync chip state only
  });
}

/* ── Mobile nav ────────────────────────────────────────────────────────── */
function initNav() {
  const header = document.querySelector('.site-nav');
  if (!header) return;
  const toggle = header.querySelector('.nav-toggle');
  const menu = header.querySelector('.nav-links');
  if (!toggle || !menu) return;

  const setOpen = (open) => {
    header.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => {
    setOpen(!header.classList.contains('is-open'));
  });
  header.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && header.classList.contains('is-open')) {
      setOpen(false);
      toggle.focus();
    }
  });
  menu.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a')) setOpen(false);
  });
}

initNav();
initReveal();
initSequences();
initRoleFilter();
initAsk();
