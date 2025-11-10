export declare const themeTokensPlugin: any;
export declare const accessibilityPlugin: any;
export declare const tailwindThemeExtension: {
    colors: {
        'bg-primary': string;
        'bg-secondary': string;
        'bg-tertiary': string;
        'bg-hover': string;
        accent: string;
        'accent-hover': string;
        'text-primary': string;
        'text-secondary': string;
        'text-accent': string;
        'text-inverted': string;
        'text-placeholder': string;
        'border-primary': string;
        'border-secondary': string;
        'ring-focus': string;
        error: string;
        'mention-bg': string;
        'mention-text': string;
        'mention-self-bg': string;
        'mention-self-text': string;
        'chip-selected': string;
        'status-offline': string;
        'control-surface': string;
        'control-recording': string;
    };
    fontFamily: {
        sans: string[];
    };
    fontWeight: {
        regular: import("./index.js").FontWeightValue;
        medium: import("./index.js").FontWeightValue;
        semibold: import("./index.js").FontWeightValue;
        bold: import("./index.js").FontWeightValue;
    };
    fontSize: {
        [k: string]: string;
    };
    lineHeight: {
        [k: string]: string;
    };
    spacing: {
        [k: string]: string;
    };
    borderRadius: {
        [k: string]: string;
    };
    width: {
        'control-sm': string;
        'control-md': string;
        'control-lg': string;
    };
    height: {
        'control-sm': string;
        'control-md': string;
        'control-lg': string;
    };
};
export declare const uiTailwindPreset: {
    theme: {
        extend: {
            colors: {
                'bg-primary': string;
                'bg-secondary': string;
                'bg-tertiary': string;
                'bg-hover': string;
                accent: string;
                'accent-hover': string;
                'text-primary': string;
                'text-secondary': string;
                'text-accent': string;
                'text-inverted': string;
                'text-placeholder': string;
                'border-primary': string;
                'border-secondary': string;
                'ring-focus': string;
                error: string;
                'mention-bg': string;
                'mention-text': string;
                'mention-self-bg': string;
                'mention-self-text': string;
                'chip-selected': string;
                'status-offline': string;
                'control-surface': string;
                'control-recording': string;
            };
            fontFamily: {
                sans: string[];
            };
            fontWeight: {
                regular: import("./index.js").FontWeightValue;
                medium: import("./index.js").FontWeightValue;
                semibold: import("./index.js").FontWeightValue;
                bold: import("./index.js").FontWeightValue;
            };
            fontSize: {
                [k: string]: string;
            };
            lineHeight: {
                [k: string]: string;
            };
            spacing: {
                [k: string]: string;
            };
            borderRadius: {
                [k: string]: string;
            };
            width: {
                'control-sm': string;
                'control-md': string;
                'control-lg': string;
            };
            height: {
                'control-sm': string;
                'control-md': string;
                'control-lg': string;
            };
        };
    };
    plugins: any[];
};
