/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'bg-primary': 'var(--color-bg-primary)',
        'bg-secondary': 'var(--color-bg-secondary)',
        'bg-tertiary': 'var(--color-bg-tertiary)',
        'bg-hover': 'var(--color-bg-hover)',
        'accent': 'var(--color-bg-accent)',
        'accent-hover': 'var(--color-bg-accent-hover)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-accent': 'var(--color-text-accent)',
        'text-inverted': 'var(--color-text-inverted)',
        'border-primary': 'var(--color-border-primary)',
        'border-secondary': 'var(--color-border-secondary)',
        'ring-focus': 'var(--color-ring-focus)',
        'error': 'var(--color-error)',
        'mention-bg': 'var(--color-mention-bg)',
        'mention-text': 'var(--color-mention-text)',
        'mention-self-bg': 'var(--color-mention-self-bg)',
        'mention-self-text': 'var(--color-mention-self-text)',
      }
    },
  },
  plugins: [],
}
