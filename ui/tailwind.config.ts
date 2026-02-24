import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        sibyl: {
          blue: '#1652a0',
          'blue-light': '#1e6bc0',
          accent: '#4a9ed6',
          cyan: '#29b6d8',
        },
      },
    },
  },
  plugins: [],
};

export default config;
