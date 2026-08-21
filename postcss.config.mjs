/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    // Tailwind v4 compiles through Lightning CSS, which already applies vendor prefixes for the
    // browserslist range. autoprefixer used to sit here from the v3 setup and is now redundant.
    '@tailwindcss/postcss': {},
  },
};

export default config;
