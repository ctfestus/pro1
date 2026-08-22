/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
    // Required, not redundant. Next's own CSS pipeline (next/font in particular) resolves
    // 'autoprefixer' from the project directly, so the package has to stay installed even
    // though Tailwind v4 already prefixes our own CSS through Lightning CSS. Dropping it
    // appears to work only while some other dependency still happens to pull it into
    // node_modules; once that goes, `next build` dies with "Cannot find module
    // 'autoprefixer'" out of getPostCssPlugins.
    autoprefixer: {},
  },
};

export default config;
