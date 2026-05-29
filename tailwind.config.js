/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // =====================================================================
        // Brand — PRIMARY (Site Mode anchor)
        // Anchor at blue-500 (#1595D1), matches the main logo ribbon and the
        // PIQC wordmark color. Use blue-600 for default CTAs.
        // See docs/brand-and-web-design.md (TBD) for the full design system.
        // =====================================================================
        blue: {
          50:  '#F0F9FE',
          100: '#D6EFFF',
          200: '#AEE0FC',
          300: '#74B4DC',
          400: '#3CACF4',
          500: '#1595D1',
          600: '#017BC8',
          700: '#026BBE',
          800: '#0477BF',
          900: '#033E80',
          950: '#021F40',
        },

        // =====================================================================
        // Brand — SECONDARY (Audit Mode anchor)
        // Anchor at teal-500 (#06BFAD), matches the logo ribbon's gradient
        // endpoint and the pale wing tint (teal-100 / teal-200).
        // =====================================================================
        teal: {
          50:  '#ECF7F6',
          100: '#DCEDEB',
          200: '#9FD7D6',
          300: '#6FC9C7',
          400: '#2CCCC8',
          500: '#06BFAD',
          600: '#02BBB8',
          700: '#028E8B',
          800: '#016663',
          900: '#014442',
          950: '#002221',
        },

        // =====================================================================
        // Neutrals — slate (cool-leaning gray, complements the blue brand).
        // Replaces the legacy ad-hoc blue-gray hex literals scattered through
        // the codebase (#374152, #d2d7e0, #e2e8ee, etc.). Tailwind's default
        // slate values are explicitly redeclared so the palette is auditable
        // from one place and no defaults leak through.
        // =====================================================================
        slate: {
          50:  '#F8FAFC',
          100: '#F2F2F2',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
          950: '#020617',
        },

        // =====================================================================
        // Semantic text tokens (CSS-variable-backed; switch with html.dark).
        // Variable definitions live in src/index.css. The variable values map
        // onto the slate scale above per the brand overhaul.
        // =====================================================================
        fg: {
          heading: 'var(--fg-heading)',
          body:    'var(--fg-body)',
          sub:     'var(--fg-sub)',
          muted:   'var(--fg-muted)',
          label:   'var(--fg-label)',
        },

        // =====================================================================
        // Brand (mode-aware) — CSS-variable-backed. Default resolves to the
        // blue scale (Site Mode / SOTR / landing / auth). Components inside a
        // `.mode-audit` root pick up the teal scale automatically.
        //
        // Variable values live in src/index.css. Using the
        // `rgb(var(--brand-N) / <alpha-value>)` form means Tailwind's opacity
        // modifiers work: `bg-brand-600/30` renders as
        // `rgb(<active-brand-600-rgb> / 0.3)`.
        //
        // Usage:
        //   bg-brand-600       → primary CTA color, mode-aware
        //   text-brand-500     → brand text accent
        //   border-brand-300   → light brand border
        //   hover:bg-brand-700 → hover state for primary CTA
        // =====================================================================
        brand: {
          50:  'rgb(var(--brand-50)  / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
          950: 'rgb(var(--brand-950) / <alpha-value>)',
        },

        // =====================================================================
        // DEPRECATED — `navy` palette retained for one PR cycle to avoid
        // breaking any lingering references. Will be removed in a follow-up
        // PR once a clean build confirms no usages remain. Do NOT add new
        // navy-* references; use `slate-*` or the brand `blue-*` scale.
        // =====================================================================
        navy: {
          950: '#040810',
          900: '#070d1a',
          850: '#0a1020',
          800: '#0d1528',
          750: '#111c33',
          700: '#162240',
          600: '#1e3060',
          500: '#1e4080',
        },
      },

      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },

      // =======================================================================
      // Decorative gradients. Use the mode-aware `--brand-500` CSS variable
      // so glows shift hue based on the active mode without any per-mode
      // class names needed at the call site. The legacy `-teal` variants
      // are removed because `bg-hero-glow` is now mode-aware.
      // =======================================================================
      backgroundImage: {
        'hero-glow': 'radial-gradient(ellipse 80% 60% at 50% -10%, rgb(var(--brand-500) / 0.25) 0%, transparent 70%)',
        'card-glow': 'radial-gradient(ellipse 60% 60% at 50%   0%, rgb(var(--brand-500) / 0.08) 0%, transparent 70%)',
      },

      // =======================================================================
      // Shadows. Card-hover, btn, btn-hover all use the mode-aware
      // `--brand-N` CSS variables so a Site Mode button glows blue and an
      // Audit Mode button glows teal, automatically. The legacy `-teal`
      // suffix variants are no longer needed.
      // =======================================================================
      boxShadow: {
        'card':       '0 1px 3px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3)',
        'card-hover': '0 4px 24px rgb(var(--brand-500) / 0.15), 0 1px 3px rgba(0,0,0,0.5)',
        'btn':        '0 2px 8px rgb(var(--brand-600) / 0.4)',
        'btn-hover':  '0 4px 16px rgb(var(--brand-600) / 0.5)',
      },

      borderRadius: {
        'xl':  '0.875rem',
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },

      keyframes: {
        'slide-in-right': {
          '0%':   { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },

      animation: {
        'slide-in-right': 'slide-in-right 200ms cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in':        'fade-in 150ms ease-out',
      },
    },
  },
  plugins: [],
};
