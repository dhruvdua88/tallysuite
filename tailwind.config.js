/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          base: v('--bg-base'),
          panel: v('--bg-panel'),
          raised: v('--bg-raised'),
          hover: v('--bg-hover'),
        },
        line: {
          DEFAULT: v('--line'),
          strong: v('--line-strong'),
        },
        ink: {
          DEFAULT: v('--ink'),
          muted: v('--ink-muted'),
          faint: v('--ink-faint'),
        },
        accent: {
          DEFAULT: v('--accent'),
          hover: v('--accent-hover'),
          soft: v('--accent-soft'),
          ink: v('--accent-ink'),
        },
        debit: v('--debit'),
        credit: v('--credit'),
        delta: v('--delta'),
        good: v('--good'),
        warn: v('--warn'),
        bad: v('--bad'),
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.06)',
        raised: '0 4px 12px -2px rgb(16 24 40 / 0.10), 0 2px 4px -2px rgb(16 24 40 / 0.06)',
        pop: '0 12px 32px -8px rgb(16 24 40 / 0.18)',
      },
      borderRadius: {
        card: '10px',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.28s cubic-bezier(0.16,1,0.3,1)',
      },
    },
  },
  plugins: [],
}
