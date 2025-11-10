import plugin from 'tailwindcss/plugin';
import { themes, spacing, radii, typography, controls } from './index.js';
const colorVariableMap = (theme) => ({
    '--color-bg-primary': theme.colors.background.primary,
    '--color-bg-secondary': theme.colors.background.secondary,
    '--color-bg-tertiary': theme.colors.background.tertiary,
    '--color-bg-hover': theme.colors.background.hover,
    '--color-bg-accent': theme.colors.accent.primary,
    '--color-bg-accent-hover': theme.colors.accent.hover,
    '--color-text-primary': theme.colors.text.primary,
    '--color-text-secondary': theme.colors.text.secondary,
    '--color-text-accent': theme.colors.text.accent,
    '--color-text-inverted': theme.colors.text.inverted,
    '--color-text-placeholder': theme.colors.text.placeholder,
    '--color-border-primary': theme.colors.border.primary,
    '--color-border-secondary': theme.colors.border.secondary,
    '--color-ring-focus': theme.colors.ring.focus,
    '--color-error': theme.colors.status.danger,
    '--color-mention-bg': theme.colors.mention.background,
    '--color-mention-text': theme.colors.mention.text,
    '--color-mention-self-bg': theme.colors.mention.selfBackground,
    '--color-mention-self-text': theme.colors.mention.selfText,
    '--color-chip-selected': theme.colors.chip.selected,
    '--color-status-offline': theme.colors.status.offline,
    '--color-control-surface': theme.colors.controls.surface,
    '--color-control-recording': theme.colors.controls.recording,
});
const entries = [
    [':root', themes.dark],
    ['.theme-light', themes.light],
    ['.theme-midnight', themes.midnight],
];
const toPx = (value) => `${value}px`;
const mapScale = (scale) => Object.fromEntries(Object.entries(scale).map(([key, value]) => [key, toPx(value)]));
export const themeTokensPlugin = plugin(({ addBase }) => {
    const baseStyles = Object.fromEntries(entries.map(([selector, theme]) => [selector, colorVariableMap(theme)]));
    addBase({
        ...baseStyles,
        ':root': {
            ...baseStyles[':root'],
            colorScheme: 'dark',
            fontFamily: typography.fontFamily.sans.join(', '),
        },
        body: {
            fontFamily: typography.fontFamily.sans.join(', '),
            backgroundColor: 'var(--color-bg-primary)',
            color: 'var(--color-text-primary)',
        },
    });
});
export const accessibilityPlugin = plugin(({ addVariant }) => {
    addVariant('aria-expanded', '&[aria-expanded="true"]');
    addVariant('aria-pressed', '&[aria-pressed="true"]');
    addVariant('aria-selected', '&[aria-selected="true"]');
    addVariant('aria-current', '&[aria-current]');
    addVariant('focus-visible-within', '&:focus-visible, &:focus-within');
});
export const tailwindThemeExtension = {
    colors: {
        'bg-primary': 'var(--color-bg-primary)',
        'bg-secondary': 'var(--color-bg-secondary)',
        'bg-tertiary': 'var(--color-bg-tertiary)',
        'bg-hover': 'var(--color-bg-hover)',
        accent: 'var(--color-bg-accent)',
        'accent-hover': 'var(--color-bg-accent-hover)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-accent': 'var(--color-text-accent)',
        'text-inverted': 'var(--color-text-inverted)',
        'text-placeholder': 'var(--color-text-placeholder)',
        'border-primary': 'var(--color-border-primary)',
        'border-secondary': 'var(--color-border-secondary)',
        'ring-focus': 'var(--color-ring-focus)',
        error: 'var(--color-error)',
        'mention-bg': 'var(--color-mention-bg)',
        'mention-text': 'var(--color-mention-text)',
        'mention-self-bg': 'var(--color-mention-self-bg)',
        'mention-self-text': 'var(--color-mention-self-text)',
        'chip-selected': 'var(--color-chip-selected)',
        'status-offline': 'var(--color-status-offline)',
        'control-surface': 'var(--color-control-surface)',
        'control-recording': 'var(--color-control-recording)',
    },
    fontFamily: {
        sans: typography.fontFamily.sans,
    },
    fontWeight: typography.fontWeight,
    fontSize: mapScale(typography.fontSize),
    lineHeight: mapScale(typography.lineHeight),
    spacing: mapScale(spacing),
    borderRadius: mapScale(radii),
    width: {
        'control-sm': toPx(controls.sm),
        'control-md': toPx(controls.md),
        'control-lg': toPx(controls.lg),
    },
    height: {
        'control-sm': toPx(controls.sm),
        'control-md': toPx(controls.md),
        'control-lg': toPx(controls.lg),
    },
};
export const uiTailwindPreset = {
    theme: {
        extend: tailwindThemeExtension,
    },
    plugins: [themeTokensPlugin, accessibilityPlugin],
};
