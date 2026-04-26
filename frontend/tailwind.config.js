/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        terminal: 'var(--bg)',
        'terminal-secondary': 'var(--bg-secondary)',
        'terminal-tertiary': 'var(--bg-tertiary)',
        border: 'var(--border)',
        'border-active': 'var(--border-active)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        accent: 'var(--accent)',
        'accent-dim': 'var(--accent-dim)',
        danger: 'var(--danger)',
        warning: 'var(--warning)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0px',
        none: '0px',
        sm: '0px',
        md: '0px',
        lg: '0px',
        xl: '0px',
        '2xl': '0px',
        '3xl': '0px',
        full: '9999px',
      },
      boxShadow: {
        accent: '0 0 20px #00ff8844',
        'accent-lg': '0 0 40px #00ff8888, 0 0 80px #00ff8844',
      },
      animation: {
        'cursor-blink': 'blink 1s step-end infinite',
        'orb-pulse': 'orb-pulse 2s ease-in-out infinite',
        'orb-spin': 'orb-spin 2s linear infinite',
        'wave-1': 'wave-1 0.8s ease-in-out infinite',
        'wave-2': 'wave-2 0.9s ease-in-out infinite 0.1s',
        'wave-3': 'wave-3 0.7s ease-in-out infinite 0.2s',
        'wave-4': 'wave-4 1.0s ease-in-out infinite 0.05s',
        'wave-5': 'wave-5 0.85s ease-in-out infinite 0.15s',
        'slide-up': 'slide-up 0.3s ease forwards',
      },
    },
  },
  plugins: [],
}
