/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/**/*.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5f5',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        accent: {
          sky: '#38bdf8',
          mint: '#34d399',
          amber: '#fbbf24',
          rose: '#fb7185',
        },
      },
      boxShadow: {
        glass: '0 20px 45px rgba(15, 23, 42, 0.45)',
      },
      borderRadius: {
        glass: '1.5rem',
      },
    },
  },
  plugins: [],
};
