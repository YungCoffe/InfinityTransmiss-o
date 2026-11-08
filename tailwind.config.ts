import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#000000',
        brand: {
          50: '#FFF1F2',
          100: '#FFE1E4',
          200: '#FFC7CD',
          500: '#E5203F',
          600: '#C8102E',
          700: '#A30D25',
          800: '#7F0A1D',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        hard: '4px 4px 0 0 #000000',
        'hard-red': '4px 4px 0 0 #C8102E',
      },
    },
  },
  plugins: [],
};

export default config;
