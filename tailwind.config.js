/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
      boxShadow: {
        card: '0 10px 30px -12px rgba(15, 23, 42, 0.18)',
        soft: '0 2px 10px -2px rgba(15, 23, 42, 0.12)'
      },
      keyframes: {
        fadeUp: { '0%': { opacity: 0, transform: 'translateY(8px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        pop: { '0%': { opacity: 0, transform: 'scale(.97)' }, '100%': { opacity: 1, transform: 'scale(1)' } }
      },
      animation: { fadeUp: 'fadeUp .35s ease both', pop: 'pop .18s ease both' }
    }
  },
  plugins: []
};
