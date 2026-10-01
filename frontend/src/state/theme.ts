import { create } from 'zustand'

export type Theme = 'dark' | 'light'
const KEY = 'rie.theme'

function stored(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.classList.toggle('dark', theme === 'dark')
}

/** Dark-first (MVP_SPEC §8.3); the choice persists per browser when storage is available. */
export const useTheme = create<{ theme: Theme; toggle: () => void }>()((set, get) => ({
  theme: stored(),
  toggle: () => {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* private mode: keep it for this session only */
    }
    applyTheme(theme)
    set({ theme })
  },
}))
