/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
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
        blue: {
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        // Semantic text-tone tokens (CSS-variable-backed; switch automatically
        // with html.dark). Use as text-fg-heading / text-fg-sub / etc.
        // See src/index.css for the variable definitions.
        fg: {
          heading: 'var(--fg-heading)',
          body: 'var(--fg-body)',
          sub: 'var(--fg-sub)',
          muted: 'var(--fg-muted)',
          label: 'var(--fg-label)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'hero-glow': 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(37,99,235,0.25) 0%, transparent 70%)',
        'card-glow': 'radial-gradient(ellipse 60% 60% at 50% 0%, rgba(37,99,235,0.08) 0%, transparent 70%)',
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3)',
        'card-hover': '0 4px 24px rgba(37,99,235,0.15), 0 1px 3px rgba(0,0,0,0.5)',
        'btn': '0 2px 8px rgba(37,99,235,0.4)',
        'btn-hover': '0 4px 16px rgba(37,99,235,0.5)',
      },
      borderRadius: {
        'xl': '0.875rem',
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
      keyframes: {
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'slide-in-right': 'slide-in-right 200ms cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in': 'fade-in 150ms ease-out',
      },
    },
  },
  plugins: [],
};
