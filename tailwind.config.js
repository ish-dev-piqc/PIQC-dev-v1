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
    },
  },
  plugins: [],
};
