"use client";

import { createClient } from "@/lib/supabase";

export function LogoutButton() {
  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      style={{
        padding: "0.5rem 1rem",
        borderRadius: "9999px",
        border: "1px solid var(--border)",
        background: "transparent",
        color: "var(--text)",
        cursor: "pointer",
        fontSize: "0.875rem",
      }}
    >
      Cerrar sesion
    </button>
  );
}
