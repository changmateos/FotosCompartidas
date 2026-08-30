"use client";

// Selector de tema (F2, T2.3): 6 temas x 2 variantes (lib/themes.ts).
// Emite { themeKey, variantKey } con el key concreto de la variante
// (ej. "elegante-marfil") para que /e/[slug] lo aplique exacto.
import { THEMES } from "@/lib/themes";

export type ThemeSelection = { themeKey: string; variantKey: string };

export function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeSelection;
  onChange: (selection: ThemeSelection) => void;
}) {
  return (
    <div className="adm-theme-picker">
      {THEMES.map((theme) => {
        const active = theme.key === value.themeKey;
        return (
          <div key={theme.key} className={"adm-theme-group" + (active ? " adm-theme-group-active" : "")}>
            <button
              type="button"
              className="adm-theme-name"
              onClick={() => onChange({ themeKey: theme.key, variantKey: theme.variants[0].dataTheme })}
            >
              {theme.label}
            </button>
            <div className="adm-theme-variants">
              {theme.variants.map((variant) => {
                const selected = active && value.variantKey === variant.dataTheme;
                return (
                  <button
                    key={variant.key}
                    type="button"
                    className={"adm-theme-variant" + (selected ? " adm-theme-variant-active" : "")}
                    onClick={() => onChange({ themeKey: theme.key, variantKey: variant.dataTheme })}
                    aria-pressed={selected}
                  >
                    {variant.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
