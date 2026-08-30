// Temas aprobados (handshake, decision 6) · se aplican via [data-theme] en globals.css
export type ThemeVariant = {
  key: string;       // ej: "clasico-bn"
  label: string;     // ej: "Blanco y negro"
  dataTheme: string; // ej: "clasico-bn" (debe existir en globals.css)
};

export type Theme = {
  key: string;    // ej: "clasico"
  label: string;  // ej: "Clasico"
  variants: ThemeVariant[];
};

export const THEMES: Theme[] = [
  {
    key: "elegante",
    label: "Elegante",
    variants: [
      { key: "elegante-marfil", label: "Marfil y dorado", dataTheme: "elegante-marfil" },
      { key: "elegante-negro", label: "Negro y dorado", dataTheme: "elegante-negro" },
    ],
  },
  {
    key: "fiesta",
    label: "Fiesta",
    variants: [
      { key: "fiesta-fucsia", label: "Fucsia y violeta", dataTheme: "fiesta-fucsia" },
      { key: "fiesta-neon", label: "Neon", dataTheme: "fiesta-neon" },
    ],
  },
  {
    key: "naturaleza",
    label: "Naturaleza",
    variants: [
      { key: "naturaleza-bosque", label: "Verde bosque y madera", dataTheme: "naturaleza-bosque" },
      { key: "naturaleza-arena", label: "Arena y terracota", dataTheme: "naturaleza-arena" },
    ],
  },
  {
    key: "clasico",
    label: "Clasico",
    variants: [
      { key: "clasico-bn", label: "Blanco y negro", dataTheme: "clasico-bn" },
      { key: "clasico-beige", label: "Beige y nogal", dataTheme: "clasico-beige" },
    ],
  },
  {
    key: "institucional",
    label: "Institucional",
    variants: [
      { key: "institucional-azul", label: "Azul marino y blanco", dataTheme: "institucional-azul" },
      { key: "institucional-rojo", label: "Rojo y gris", dataTheme: "institucional-rojo" },
    ],
  },
  {
    key: "tropical",
    label: "Tropical",
    variants: [
      { key: "tropical-turquesa", label: "Turquesa y arena", dataTheme: "tropical-turquesa" },
      { key: "tropical-coral", label: "Coral y amarillo", dataTheme: "tropical-coral" },
    ],
  },
];

export const DEFAULT_THEME_VARIANT = "clasico-bn";

/**
 * Resuelve la variante concreta de un tema (F8). Acepta el key de la
 * variante o su dataTheme; si no matchea, devuelve la primera variante
 * del tema. null si el tema no existe.
 */
export function getThemeVariant(themeKey: string, variantKey?: string | null): ThemeVariant | null {
  const theme = THEMES.find((t) => t.key === themeKey);
  if (!theme) return null;
  return (
    theme.variants.find((v) => v.key === variantKey || v.dataTheme === variantKey) ??
    theme.variants[0] ??
    null
  );
}

/**
 * Color de fondo (hex) de cada dataTheme, espejo de globals.css.
 * Se usa para el meta theme-color (barra del navegador en movil).
 */
export const THEME_BG: Record<string, string> = {
  "clasico-bn": "#ffffff",
  "clasico-beige": "#f7f3ea",
  "elegante-marfil": "#fdfaf3",
  "elegante-negro": "#121212",
  "fiesta-fucsia": "#fff0f5",
  "fiesta-neon": "#0f1114",
  "naturaleza-bosque": "#f4f7f2",
  "naturaleza-arena": "#faf6ef",
  "institucional-azul": "#f2f5f8",
  "institucional-rojo": "#f8f2f2",
  "tropical-turquesa": "#f0fbfb",
  "tropical-coral": "#fff6f2",
};
