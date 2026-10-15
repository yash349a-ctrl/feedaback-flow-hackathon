/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  // The app already has a complete custom design system in globals.css.
  // Keep it intact while enabling Tailwind utility classes for the React UI.
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: []
};
