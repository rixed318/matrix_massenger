import { uiTailwindPreset, tailwindThemeExtension } from '@matrix-messenger/ui-tokens/tailwind';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [uiTailwindPreset],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './packages/**/*.{js,ts,jsx,tsx}',
    './mobile/**/*.{js,ts,jsx,tsx}',
    './.storybook/**/*.{js,ts,jsx,tsx,mdx}',
    './storybook/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: tailwindThemeExtension,
  },
};
