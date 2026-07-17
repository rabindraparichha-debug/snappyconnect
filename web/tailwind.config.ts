import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dee9ff',
          200: '#c4d6fe',
          300: '#a0bcfc',
          400: '#7a97f8',
          500: '#5a72f1',
          600: '#4152e4',
          700: '#3540c9',
          800: '#2e37a2',
          900: '#2b3480',
          950: '#1a1e4b'
        }
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif'
        ]
      }
    }
  },
  plugins: []
};

export default config;
