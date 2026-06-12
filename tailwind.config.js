/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Dark-first audit-desk palette. Slate base, electric-indigo accent,
        // semantic ledger colours (debit/credit/delta).
        bg: {
          base: '#0a0c12',
          panel: '#11141d',
          raised: '#171b27',
          hover: '#1d2230',
        },
        line: {
          DEFAULT: '#232838',
          strong: '#323a52',
        },
        ink: {
          DEFAULT: '#e7eaf3',
          muted: '#9aa3bd',
          faint: '#5e6781',
        },
        accent: {
          DEFAULT: '#6d7cff',
          hover: '#8390ff',
          soft: 'rgba(109,124,255,0.12)',
        },
        debit: '#f0708a',
        credit: '#39c08a',
        delta: '#f5b454',
        good: '#39c08a',
        warn: '#f5b454',
        bad: '#f0708a',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 30px -12px rgba(0,0,0,0.6)',
        glow: '0 0 0 1px rgba(109,124,255,0.4), 0 8px 40px -8px rgba(109,124,255,0.35)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s cubic-bezier(0.16,1,0.3,1)',
      },
    },
  },
  plugins: [],
}
