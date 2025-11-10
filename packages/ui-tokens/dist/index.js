export const spacing = {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
};
export const radii = {
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
};
export const controls = {
    sm: 40,
    md: 44,
    lg: 48,
};
export const typography = {
    fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
    },
    fontWeight: {
        regular: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
    },
    fontSize: {
        xs: 12,
        sm: 14,
        md: 16,
        lg: 20,
    },
    lineHeight: {
        snug: 20,
        normal: 24,
    },
};
export const themes = {
    dark: {
        colors: {
            background: {
                primary: '#0B1526',
                secondary: '#1f2a44',
                tertiary: '#101d35',
                hover: 'rgba(31, 42, 68, 0.65)',
            },
            accent: {
                primary: '#3A7EFB',
                hover: '#2F6AD9',
            },
            text: {
                primary: '#FFFFFF',
                secondary: '#9ba9c5',
                accent: '#8EB2FF',
                inverted: '#0B1526',
                placeholder: '#6c7aa6',
            },
            border: {
                primary: '#1f2a44',
                secondary: 'rgba(16, 29, 53, 0.6)',
            },
            ring: {
                focus: '#3A7EFB',
            },
            mention: {
                background: 'rgba(58, 126, 251, 0.2)',
                text: '#A4C6FF',
                selfBackground: 'rgba(234, 179, 8, 0.3)',
                selfText: '#FACC15',
            },
            chip: {
                selected: 'rgba(58, 126, 251, 0.2)',
            },
            status: {
                offline: '#f97316',
                danger: '#d1485f',
            },
            controls: {
                surface: '#1f2a44',
                recording: '#d1485f',
            },
        },
        typography,
        spacing,
        radii,
        controls,
    },
    light: {
        colors: {
            background: {
                primary: '#ffffff',
                secondary: '#f9fafb',
                tertiary: '#e5e7eb',
                hover: 'rgba(229, 231, 235, 0.5)',
            },
            accent: {
                primary: '#4f46e5',
                hover: '#4338ca',
            },
            text: {
                primary: '#111827',
                secondary: '#6b7280',
                accent: '#4338ca',
                inverted: '#ffffff',
                placeholder: '#9ca3af',
            },
            border: {
                primary: '#d1d5db',
                secondary: '#e5e7eb',
            },
            ring: {
                focus: '#6366f1',
            },
            mention: {
                background: 'rgba(79, 70, 229, 0.2)',
                text: '#3730a3',
                selfBackground: 'rgba(250, 204, 21, 0.3)',
                selfText: '#ca8a04',
            },
            chip: {
                selected: 'rgba(79, 70, 229, 0.15)',
            },
            status: {
                offline: '#ea580c',
                danger: '#ef4444',
            },
            controls: {
                surface: '#e5e7eb',
                recording: '#ef4444',
            },
        },
        typography,
        spacing,
        radii,
        controls,
    },
    midnight: {
        colors: {
            background: {
                primary: '#0d1117',
                secondary: '#010409',
                tertiary: '#161b22',
                hover: 'rgba(22, 27, 34, 0.5)',
            },
            accent: {
                primary: '#58a6ff',
                hover: '#388bfd',
            },
            text: {
                primary: '#c9d1d9',
                secondary: '#8b949e',
                accent: '#58a6ff',
                inverted: '#ffffff',
                placeholder: '#6e7681',
            },
            border: {
                primary: '#30363d',
                secondary: 'rgba(48, 54, 61, 0.5)',
            },
            ring: {
                focus: '#58a6ff',
            },
            mention: {
                background: 'rgba(88, 166, 255, 0.3)',
                text: '#80b6ff',
                selfBackground: 'rgba(210, 153, 34, 0.2)',
                selfText: '#e3b341',
            },
            chip: {
                selected: 'rgba(88, 166, 255, 0.25)',
            },
            status: {
                offline: '#f97316',
                danger: '#f85149',
            },
            controls: {
                surface: '#161b22',
                recording: '#f85149',
            },
        },
        typography,
        spacing,
        radii,
        controls,
    },
};
export const getTheme = (name) => themes[name];
