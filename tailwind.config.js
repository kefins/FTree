/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx,html}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fdf8f0',
          100: '#f9ecd8',
          200: '#f2d5a8',
          300: '#e8b96e',
          400: '#d99a3e',
          500: '#c4822a',
          600: '#a56821',
          700: '#86511e',
          800: '#6e421f',
          900: '#5c381d',
          950: '#341c0d',
        },
        navy: {
          50: '#f0f4f8',
          100: '#d9e2ec',
          200: '#bcccdc',
          300: '#9fb3c8',
          400: '#829ab1',
          500: '#627d98',
          600: '#486581',
          700: '#334e68',
          800: '#243b53',
          900: '#102a43',
          950: '#0a1929',
        },
      },
      fontFamily: {
        serif: ['Georgia', 'Noto Serif SC', 'STSong', 'SimSun', 'serif'],
        sans: ['Inter', 'Noto Sans SC', 'Microsoft YaHei', 'sans-serif'],
      },
    },
  },
  plugins: [],
  corePlugins: {
    preflight: false,
  },
};
