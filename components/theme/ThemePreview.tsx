"use client";

// Galeria de vista previa de los 6 temas x 2 variantes (F8, T8.1).
// Cada tarjeta se envuelve en su propio [data-theme] y usa las CSS
// variables, demostrando que los 12 combos se aplican correctamente.
// Se muestra en /e/[slug]?vista=temas (util para el organizador).
import { THEMES } from "@/lib/themes";
import "./theme-preview.css";

export function ThemePreview() {
  return (
    <section className="tp-gallery" aria-label="Vista previa de temas">
      {THEMES.map((theme) => (
        <div key={theme.key} className="tp-theme">
          <h3 className="tp-theme-name">{theme.label}</h3>
          <div className="tp-variants">
            {theme.variants.map((variant) => (
              <div key={variant.key} data-theme={variant.dataTheme} className="tp-card">
                <p className="tp-variant-label">{variant.label}</p>
                <p className="tp-title">Titulo del evento</p>
                <p className="tp-owners">Ana y Luis</p>
                <p className="tp-muted">Mensaje de dedicatoria y texto secundario.</p>
                <div className="tp-swatches" aria-hidden="true">
                  <span className="tp-swatch" style={{ background: "var(--bg)" }} />
                  <span className="tp-swatch" style={{ background: "var(--surface)" }} />
                  <span className="tp-swatch" style={{ background: "var(--primary)" }} />
                  <span className="tp-swatch" style={{ background: "var(--accent)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
