/** Descarga una tabla como CSV. Sin dependencias: el navegador ya sabe hacerlo. */
export function bajarCSV(nombre: string, filas: (string | number | null)[][]) {
  const escapar = (v: string | number | null) => {
    const s = v == null ? '' : String(v)
    // Comillas dobles si hay separador, comillas o saltos de línea.
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  // Punto y coma: Excel en configuración regional es-AR usa la coma como
  // separador decimal, así que con comas rompe las columnas.
  const texto = filas.map(f => f.map(escapar).join(';')).join('\n')
  // BOM para que Excel reconozca UTF-8 y no rompa los acentos.
  const blob = new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8;' })

  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${nombre}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
