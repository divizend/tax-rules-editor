"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"
import { toast } from "sonner"

const DARK_STORAGE_KEY = "tax-rules-editor:dark"

function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="normal"
      enableSystem={false}
      disableTransitionOnChange
      themes={["normal", "spring", "summer", "autumn", "winter"]}
      value={{
        normal: "theme-normal",
        spring: "theme-spring",
        summer: "theme-summer",
        autumn: "theme-autumn",
        winter: "theme-winter",
      }}
      {...props}
    >
      <ThemeHotkey />
      {children}
    </NextThemesProvider>
  )
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function ThemeHotkey() {
  const { theme, setTheme } = useTheme()
  const [isDark, setIsDark] = React.useState(false)
  const hasMountedRef = React.useRef(false)

  // Apply + persist dark mode separately, so Tailwind `dark:` continues to work.
  React.useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const raw = window.localStorage.getItem(DARK_STORAGE_KEY)
      if (raw === "1") setIsDark(true)
    } catch {
      // ignore
    }
  }, [])

  React.useEffect(() => {
    if (typeof document === "undefined") return
    const el = document.documentElement
    if (isDark) el.classList.add("dark")
    else el.classList.remove("dark")
    try {
      window.localStorage.setItem(DARK_STORAGE_KEY, isDark ? "1" : "0")
    } catch {
      // ignore
    }
  }, [isDark])

  React.useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }
    const family = typeof theme === "string" ? theme : "normal"
    const mode = isDark ? "dark" : "light"
    toast(`Theme: ${family} (${mode})`)
  }, [isDark, theme])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      const key = event.key.toLowerCase()

      const current = typeof theme === "string" ? theme : "normal"

      const families = ["normal", "spring", "summer", "autumn", "winter"] as const

      if (key === "d") {
        setIsDark((v) => !v)
        return
      }

      if (key === "t") {
        const idx = Math.max(
          0,
          families.indexOf(current as (typeof families)[number]),
        )
        const nextFamily = families[(idx + 1) % families.length]!
        setTheme(nextFamily)
      }
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [setIsDark, setTheme, theme])

  return null
}

export { ThemeProvider }
