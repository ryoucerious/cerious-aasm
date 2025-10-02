/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{html,ts}',
  ],
  theme: {
    extend: {
      colors: {
        arkbg: '#181e24', // deep slate/metallic
        arkpanel: '#232b33',
        arkaccent: '#00eaff', // teal/cyan accent
        arkblue: '#1e90ff', // blue accent
        arkglow: '#00eaff',
      },
      fontFamily: {
        ark: ['"Orbitron"', '"Segoe UI"', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        ark: '0 0 8px 2px #00eaff99',
      },
      backgroundImage: {
        'ark-texture': 'linear-gradient(135deg, #232b33 60%, #181e24 100%)',
      },
    },
  },
  plugins: [],
}

