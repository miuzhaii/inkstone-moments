import { lazy, Suspense, useEffect, useState } from 'react'
import { ConfirmHost } from './components/overlay'
import { Toaster } from './components/feedback'
import { Spinner } from './components/primitives'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LoginPage } from './features/auth/LoginPage'
import { dismissBootScreen } from './lib/boot'
import { t, useLocale } from './lib/i18n'
import { initializePwa, requestOfflineWarmup } from './store/pwa'
import { useSession, watchSystemTheme } from './store/session'

const AppShell = lazy(() =>
  import('./features/shell/AppShell').then((module) => ({ default: module.AppShell })),
)
const SharePage = lazy(() =>
  import('./features/share/SharePage').then((module) => ({ default: module.SharePage })),
)
const BlogPage = lazy(() =>
  import('./features/blog/BlogPage').then((module) => ({ default: module.BlogPage })),
)

export function App() {

  useLocale()
  const status = useSession((s) => s.status)
  const load = useSession((s) => s.load)
  const [route] = useState(() => {
    const pathname = location.pathname
    const shareMatch = /^\/s\/([A-Za-z0-9_-]+)/.exec(pathname)
    if (shareMatch?.[1]) return { kind: 'share' as const, slug: shareMatch[1] }
    if (
      pathname === '/notes' ||
      pathname.startsWith('/notes/') ||
      pathname === '/login' ||
      pathname.startsWith('/login/') ||
      pathname === '/admin' ||
      pathname.startsWith('/admin/') ||
      /^\/n\/[0-9a-hjkmnp-tv-z]{26}\/?$/i.test(pathname)
    ) {
      return { kind: 'notebook' as const }
    }
    return { kind: 'blog' as const }
  })
  const shareSlug = route.kind === 'share' ? route.slug : null
  const blogMode = route.kind === 'blog'
  const isPublicPage = Boolean(shareSlug || blogMode)

  useEffect(() => {
    if (isPublicPage) return
    void load()
  }, [load, isPublicPage])

  useEffect(() => watchSystemTheme(), [])

  useEffect(() => {
    initializePwa()
  }, [])

  useEffect(() => {
    if (!isPublicPage && status !== 'loading') requestOfflineWarmup()
  }, [isPublicPage, status])

  useEffect(() => {
    if (isPublicPage || status !== 'loading') dismissBootScreen()
  }, [status, isPublicPage])

  useEffect(() => {
    if (isPublicPage) return
    const timer = window.setTimeout(() => dismissBootScreen(), 8000)
    return () => window.clearTimeout(timer)
  }, [isPublicPage])

  if (blogMode) {
    return (
      <>
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <BlogPage />
          </Suspense>
        </ErrorBoundary>
        <Toaster />
      </>
    )
  }

  if (shareSlug) {
    return (
      <>
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <SharePage slug={shareSlug} />
          </Suspense>
        </ErrorBoundary>
        <Toaster />
      </>
    )
  }

  return (
    <>
      <ErrorBoundary>
        {status === 'loading' && <div className="h-full" />}
        {status === 'anonymous' && <LoginPage />}
        {status === 'authed' && (
          <Suspense fallback={<PageFallback />}>
            <AppShell />
          </Suspense>
        )}
      </ErrorBoundary>
      <Toaster />
      <ConfirmHost />
    </>
  )
}

function PageFallback() {
  return (
    <div
      role="status"
      aria-label={t("common.loading")}
      className="flex h-full items-center justify-center bg-[var(--bg-base)] text-[var(--text-tertiary)]"
    >
      <Spinner size={18} />
    </div>
  )
}
