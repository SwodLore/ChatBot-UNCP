/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'uncp-green':  '#1B5E20',
        'uncp-dark':   '#0d2d0d',
        'uncp-gold':   '#F5C400',
      },
    },
  },
  plugins: [],
}

