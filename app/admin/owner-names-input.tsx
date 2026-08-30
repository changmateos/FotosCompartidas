"use client";

// Input de nombres de los duenos (F2): chips agregables con Enter o
// coma, removibles con x. Emite un array de strings.
import { useState } from "react";

export function OwnerNamesInput({
  value,
  onChange,
  id = "owner-names",
}: {
  value: string[];
  onChange: (names: string[]) => void;
  id?: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function addName() {
    const name = draft.trim();
    if (!name) {
      setDraft("");
      return;
    }
    if (name.length > 80) {
      setError("Cada nombre debe tener menos de 80 caracteres.");
      return;
    }
    if (value.length >= 10) {
      setError("Maximo 10 duenos por evento.");
      return;
    }
    if (!value.includes(name)) {
      onChange([...value, name]);
    }
    setDraft("");
    setError(null);
  }

  return (
    <div className="adm-field">
      <label className="adm-label" htmlFor={id}>
        Nombres de los duenos
      </label>
      {value.length > 0 && (
        <div className="adm-chips">
          {value.map((name) => (
            <span key={name} className="adm-chip">
              {name}
              <button
                type="button"
                aria-label={"Quitar a " + name}
                onClick={() => onChange(value.filter((n) => n !== name))}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="adm-chip-row">
        <input
          id={id}
          type="text"
          className="adm-input"
          value={draft}
          placeholder={value.length === 0 ? "Ej: Ana y Luis" : "Agregar otro nombre"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addName();
            }
          }}
        />
        <button type="button" className="adm-btn" onClick={addName}>
          Agregar
        </button>
      </div>
      {error && <p className="adm-error">{error}</p>}
      <p className="adm-hint">Enter o coma para agregar cada nombre (maximo 10).</p>
    </div>
  );
}
