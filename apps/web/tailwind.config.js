/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#172033',
        brand: { 50: '#eef9f4', 500: '#20a66a', 600: '#178354', 700: '#126744' },
      },
      boxShadow: { soft: '0 14px 40px rgba(23,32,51,.08)' },
    },
  },
  plugins: [],
};
