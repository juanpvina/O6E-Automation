/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        'slate-850': '#172033',
        'slate-955': '#090d16',
        'slate-350': '#cbd5e1',
        'slate-450': '#64748b',
        'slate-455': '#475569',
        'slate-505': '#94a3b8',
        'slate-250': '#cbd5e1',
        'slate-255': '#cbd5e1',
        'slate-355': '#cbd5e1',
        'slate-550': '#64748b',
        'slate-555': '#64748b',
        'slate-805': '#1e293b',
        'slate-855': '#1e293b',
        'emerald-450': '#10b981',
        'emerald-455': '#34d399',
        'rose-450': '#fb7185',
        'rose-455': '#ef4444',
      },
      spacing: {
        '4.5': '1.125rem'
      }
    }
  },
  plugins: []
}
