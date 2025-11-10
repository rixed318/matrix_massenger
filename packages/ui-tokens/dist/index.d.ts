export type HexColor = `#${string}`;
export type RgbaColor = `rgba(${string})`;
export type ColorValue = HexColor | RgbaColor | string;
export interface ThemeColorScale<TColor extends ColorValue = ColorValue> {
    background: {
        primary: TColor;
        secondary: TColor;
        tertiary: TColor;
        hover: TColor;
    };
    accent: {
        primary: TColor;
        hover: TColor;
    };
    text: {
        primary: TColor;
        secondary: TColor;
        accent: TColor;
        inverted: TColor;
        placeholder: TColor;
    };
    border: {
        primary: TColor;
        secondary: TColor;
    };
    ring: {
        focus: TColor;
    };
    mention: {
        background: TColor;
        text: TColor;
        selfBackground: TColor;
        selfText: TColor;
    };
    chip: {
        selected: TColor;
    };
    status: {
        offline: TColor;
        danger: TColor;
    };
    controls: {
        surface: TColor;
        recording: TColor;
    };
}
export type FontWeightValue = '400' | '500' | '600' | '700';
export interface TypographyScale<TSize> {
    fontFamily: {
        sans: string[];
    };
    fontWeight: {
        regular: FontWeightValue;
        medium: FontWeightValue;
        semibold: FontWeightValue;
        bold: FontWeightValue;
    };
    fontSize: {
        xs: TSize;
        sm: TSize;
        md: TSize;
        lg: TSize;
    };
    lineHeight: {
        snug: TSize;
        normal: TSize;
    };
}
export interface SizeScale<TSize> {
    xs: TSize;
    sm: TSize;
    md: TSize;
    lg: TSize;
    xl: TSize;
    [key: string]: TSize;
}
export interface ControlScale<TSize> {
    sm: TSize;
    md: TSize;
    lg: TSize;
    [key: string]: TSize;
}
export interface ThemeTokens<TColor extends ColorValue, TSize> {
    colors: ThemeColorScale<TColor>;
    typography: TypographyScale<TSize>;
    spacing: SizeScale<TSize>;
    radii: SizeScale<TSize>;
    controls: ControlScale<TSize>;
}
export type WebThemeTokens = ThemeTokens<string, string>;
export type NativeThemeTokens = ThemeTokens<string, number>;
export declare const spacing: SizeScale<number>;
export declare const radii: SizeScale<number>;
export declare const controls: ControlScale<number>;
export declare const typography: TypographyScale<number>;
export declare const themes: Record<'dark' | 'light' | 'midnight', ThemeTokens<string, number>>;
export type ThemeName = keyof typeof themes;
export declare const getTheme: (name: ThemeName) => ThemeTokens<string, number>;
