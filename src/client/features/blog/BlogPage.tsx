import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, BookOpen, Moon, RefreshCw, Search, Sun, X } from 'lucide-react'
import type {
  PublicBlogImage,
  PublicBlogPost,
  PublicBlogProfile,
  PublicBlogTag,
  PublicNote,
} from '@shared/types'
import { api, ApiError } from '../../lib/api'
import { applyDocumentBranding } from '../../lib/branding'
import { cn } from '../../lib/cn'
import { useDebounced } from '../../lib/hooks'
import { t, useLocale } from '../../lib/i18n'
import { preferredScrollBehavior } from '../../lib/motion'
import { Avatar, Button, Logo } from '../../components/primitives'
import { Empty, LoadingBlock } from '../../components/feedback'
import { Tooltip } from '../../components/overlay'
import { useUi } from '../../store/ui'
import { MomentCard } from './MomentCard'
import { MomentLightbox } from './MomentLightbox'
import { MomentReaderModal } from './MomentReaderModal'

const LIKES_STORAGE_KEY = 'inkstone.blog.likes'

function readLikedSlugs(): Set<string> {
  try {
    const raw = localStorage.getItem(LIKES_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeLikedSlugs(slugs: Set<string>): void {
  try {
    localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify([...slugs]))
  } catch {
  }
}

function readInitialTag(): string {
  try {
    return new URLSearchParams(window.location.search).get('tag')?.trim() ?? ''
  } catch {
    return ''
  }
}

export function BlogPage() {
  useLocale()
  const toast = useUi((s) => s.toast)
  const [profile, setProfile] = useState<PublicBlogProfile | null>(null)
  const [tags, setTags] = useState<PublicBlogTag[]>([])
  const [posts, setPosts] = useState<PublicBlogPost[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTag, setActiveTag] = useState<string>(readInitialTag)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebounced(searchInput.trim(), 220)
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark')
  const [scrolled, setScrolled] = useState(false)
  const [openMenuSlug, setOpenMenuSlug] = useState<string | null>(null)
  const [likedSlugs, setLikedSlugs] = useState<Set<string>>(readLikedSlugs)
  const [coverFailed, setCoverFailed] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
  const [activePostSlug, setActivePostSlug] = useState<string | null>(null)
  const [unlockedNotes, setUnlockedNotes] = useState<Record<string, PublicNote>>({})
  const [gallery, setGallery] = useState<{ images: PublicBlogImage[]; index: number } | null>(null)

  const scrollerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const loadMoreRef = useRef<AbortController | null>(null)
  const likingRef = useRef(new Set<string>())

  const syncTagToUrl = useCallback((tag: string) => {
    try {
      const url = new URL(window.location.href)
      if (tag) url.searchParams.set('tag', tag)
      else url.searchParams.delete('tag')
      window.history.replaceState(null, '', `${url.pathname}${url.search}`)
    } catch {
    }
  }, [])

  const selectTag = useCallback(
    (tag: string) => {
      setActiveTag(tag)
      syncTagToUrl(tag)
    },
    [syncTagToUrl],
  )

  const fetchFeed = useCallback(
    async (options: { initial?: boolean; silent?: boolean } = {}) => {
      requestRef.current?.abort()
      loadMoreRef.current?.abort()
      const controller = new AbortController()
      requestRef.current = controller
      if (options.initial) setLoading(true)
      else if (!options.silent) setRefreshing(true)
      setError(null)
      try {
        const result = await api.share.blog(
          {
            tag: activeTag || undefined,
            q: debouncedSearch || undefined,
          },
          controller.signal,
        )
        if (controller.signal.aborted) return
        setProfile(result.profile)
        setCoverFailed(false)
        setLogoFailed(false)
        setTags(result.tags)
        setPosts(result.posts)
        setNextCursor(result.nextCursor)
        const titlePrefix = result.profile.blogTitle || result.profile.name || t('blog.moments_title')
        const nextTitle =
          titlePrefix === result.profile.siteName
            ? result.profile.siteName
            : `${titlePrefix} · ${result.profile.siteName}`
        applyDocumentBranding({
          title: nextTitle,
          logoUrl: result.profile.logoUrl,
        })
      } catch (err) {
        if (controller.signal.aborted || (err as Error)?.name === 'AbortError') return
        setError(err instanceof ApiError ? err.message : t('blog.load_failed'))
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [activeTag, debouncedSearch],
  )

  useEffect(() => {
    void fetchFeed({ initial: profile === null })
    return () => {
      requestRef.current?.abort()
      loadMoreRef.current?.abort()
    }
  }, [fetchFeed])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    if (!openMenuSlug) return
    const close = () => setOpenMenuSlug(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuSlug(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenuSlug])

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    loadMoreRef.current?.abort()
    const controller = new AbortController()
    loadMoreRef.current = controller
    setLoadingMore(true)
    try {
      const result = await api.share.blog(
        {
          tag: activeTag || undefined,
          q: debouncedSearch || undefined,
          cursor: nextCursor,
        },
        controller.signal,
      )
      if (controller.signal.aborted) return
      setPosts((current) => {
        const seen = new Set(current.map((item) => item.slug))
        const added = result.posts.filter((item) => !seen.has(item.slug))
        return [...current, ...added]
      })
      setNextCursor(result.nextCursor)
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof ApiError ? err.message : t('blog.load_failed'))
      }
    } finally {
      if (loadMoreRef.current === controller) {
        loadMoreRef.current = null
        setLoadingMore(false)
      }
    }
  }

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.dataset.theme = next ? 'dark' : 'light'
  }

  const toggleLike = async (slug: string) => {
    if (likingRef.current.has(slug)) return
    likingRef.current.add(slug)
    const wasLiked = likedSlugs.has(slug)
    const action: 'like' | 'unlike' = wasLiked ? 'unlike' : 'like'
    const delta = wasLiked ? -1 : 1

    setLikedSlugs((current) => {
      const next = new Set(current)
      if (wasLiked) next.delete(slug)
      else next.add(slug)
      writeLikedSlugs(next)
      return next
    })
    setPosts((current) =>
      current.map((item) =>
        item.slug === slug ? { ...item, likes: Math.max(0, item.likes + delta) } : item,
      ),
    )

    try {
      const result = await api.share.likeBlogPost(slug, action)
      setPosts((current) =>
        current.map((item) => (item.slug === slug ? { ...item, likes: result.likes } : item)),
      )
    } catch (err) {
      setLikedSlugs((current) => {
        const next = new Set(current)
        if (wasLiked) next.add(slug)
        else next.delete(slug)
        writeLikedSlugs(next)
        return next
      })
      setPosts((current) =>
        current.map((item) =>
          item.slug === slug ? { ...item, likes: Math.max(0, item.likes - delta) } : item,
        ),
      )
      toast({
        title: t('blog.like_failed'),
        description: err instanceof ApiError ? err.message : undefined,
        tone: 'danger',
      })
    } finally {
      likingRef.current.delete(slug)
    }
  }

  const scrollToTop = () => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: preferredScrollBehavior() })
  }

  const handleNoteUnlocked = useCallback((slug: string, note: PublicNote) => {
    setUnlockedNotes((current) => {
      const alreadyCached = Boolean(current[slug])
      if (!alreadyCached) {
        setPosts((items) =>
          items.map((item) => (item.slug === slug ? { ...item, views: item.views + 1 } : item)),
        )
      }
      return { ...current, [slug]: note }
    })
  }, [])

  const activePost = activePostSlug ? posts.find((item) => item.slug === activePostSlug) ?? null : null

  const hasFilters = Boolean(activeTag || debouncedSearch)
  const siteName = profile?.siteName ?? 'Inkstone'
  const authorName = profile?.name || siteName
  const headerTitle = profile?.blogTitle || t('blog.moments_title')
  const subtitle = profile?.bio || siteName
  const customCover = Boolean(profile?.coverUrl && !coverFailed)
  const customLogo = Boolean(profile?.logoUrl && !logoFailed)

  const renderBrandIcon = (size: number) =>
    customLogo && profile?.logoUrl ? (
      <img
        src={profile.logoUrl}
        alt=""
        width={size}
        height={size}
        onError={() => setLogoFailed(true)}
        className="shrink-0 object-cover"
        style={{ width: size, height: size, borderRadius: `${Math.max(4, Math.round(size * 0.28))}px` }}
      />
    ) : (
      <Logo size={size} />
    )

  return (
    <div
      ref={scrollerRef}
      onScroll={(event) => {
        const nextScrolled = event.currentTarget.scrollTop > 175
        setScrolled((current) => (current === nextScrolled ? current : nextScrolled))
      }}
      className="h-full overflow-y-auto overscroll-contain bg-[var(--bg-sunken)]"
    >
      <div className="mx-auto min-h-full max-w-[640px] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)] md:border-x md:border-[var(--border-subtle)]">
        <header
          className={cn(
            'sticky top-0 z-30 -mb-12 flex h-12 items-center gap-2 px-3 pt-[env(safe-area-inset-top)] transition-[background-color,border-color,color] duration-200 sm:px-4',
            scrolled
              ? 'border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/92 text-[var(--text-primary)] backdrop-blur-md'
              : 'border-b border-transparent bg-gradient-to-b from-black/40 to-transparent text-white',
          )}
        >
          <button
            type="button"
            onClick={scrollToTop}
            aria-label={t('blog.scroll_to_top')}
            className="flex min-w-0 items-center gap-2 text-left"
          >
            {renderBrandIcon(16)}
            <span className="truncate text-[14px] font-semibold tracking-[-0.01em]">
              {scrolled ? `${authorName} · ${headerTitle}` : headerTitle}
            </span>
          </button>

          <span className="flex-1" />

          <Tooltip label={t('blog.search_toggle')} side="bottom">
            <button
              type="button"
              aria-label={t('blog.search_toggle')}
              aria-pressed={searchOpen}
              onClick={() => {
                setSearchOpen((open) => {
                  if (open) setSearchInput('')
                  return !open
                })
              }}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-[var(--r-md)] transition-colors',
                scrolled
                  ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  : 'text-white/90 hover:bg-white/15 hover:text-white',
              )}
            >
              <Search size={15} />
            </button>
          </Tooltip>

          <Tooltip label={t('blog.refresh')} side="bottom">
            <button
              type="button"
              aria-label={t('blog.refresh')}
              disabled={refreshing}
              onClick={() => void fetchFeed()}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-[var(--r-md)] transition-colors disabled:opacity-50',
                scrolled
                  ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  : 'text-white/90 hover:bg-white/15 hover:text-white',
              )}
            >
              <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
            </button>
          </Tooltip>

          <Tooltip label={t('share.switch_theme')} side="bottom">
            <button
              type="button"
              aria-label={t('share.switch_theme')}
              onClick={toggleTheme}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-[var(--r-md)] transition-colors',
                scrolled
                  ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  : 'text-white/90 hover:bg-white/15 hover:text-white',
              )}
            >
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </Tooltip>

          <Tooltip label={t('blog.go_to_notebook')} side="left">
            <a
              href="/notes"
              aria-label={t('blog.go_to_notebook')}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-[var(--r-md)] transition-colors',
                scrolled
                  ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  : 'text-white/90 hover:bg-white/15 hover:text-white',
              )}
            >
              <BookOpen size={15} />
            </a>
          </Tooltip>
        </header>

        <section className="relative">
          <div className="relative h-[230px] sm:h-[268px]">
            <div className="size-full overflow-hidden">
              {customCover && profile?.coverUrl ? (
                <img
                  src={profile.coverUrl}
                  alt={t('blog.cover_image')}
                  onError={() => setCoverFailed(true)}
                  className="size-full object-cover"
                />
              ) : (
                <MomentsCoverBackdrop />
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/55 via-black/20 to-transparent" />
            </div>

            <div className="absolute right-4 -bottom-6 z-10 flex items-end gap-3.5 sm:right-5">
              <span className="mb-8 text-[17px] leading-none font-bold tracking-[-0.01em] text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.65)] sm:text-[18px]">
                {authorName}
              </span>
              <div className="shrink-0 rounded-[11px] bg-[var(--bg-surface)] p-[2px] shadow-[var(--shadow-sm)]">
                <Avatar
                  src={profile?.avatarUrl}
                  name={authorName}
                  size={68}
                  className="rounded-[9px] ring-0"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-4 pt-8 pb-3 text-[12px] text-[var(--text-tertiary)] sm:px-5">
            <span className="truncate">{subtitle}</span>
            {profile && (
              <>
                <span aria-hidden="true">·</span>
                <span className="shrink-0">{t('blog.moments_count', { count: profile.totalPosts })}</span>
              </>
            )}
          </div>
        </section>

        {(searchOpen || tags.length > 0) && (
          <div className="border-y border-[var(--border-subtle)] bg-[var(--bg-base)]/60 px-4 py-2.5 sm:px-5">
            {searchOpen && (
              <div className="relative mb-2.5 last:mb-0">
                <Search
                  size={14}
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-quaternary)]"
                />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder={t('blog.search_placeholder')}
                  aria-label={t('blog.search_placeholder')}
                  className="h-9 w-full rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] pr-8 pl-8.5 text-[13px] text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
                />
                {searchInput && (
                  <button
                    type="button"
                    aria-label={t('blog.clear_filters')}
                    onClick={() => setSearchInput('')}
                    className="absolute top-1/2 right-2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            )}

            {tags.length > 0 && (
              <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto py-0.5">
                <button
                  type="button"
                  onClick={() => selectTag('')}
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors',
                    !activeTag
                      ? 'bg-[var(--text-primary)] text-[var(--text-inverse)]'
                      : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] ring-1 ring-[var(--border-subtle)] hover:bg-[var(--bg-hover)]',
                  )}
                >
                  {t('blog.all_tags')}
                </button>
                {tags.map((item) => {
                  const selected = activeTag.toLocaleLowerCase() === item.name.toLocaleLowerCase()
                  return (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => selectTag(selected ? '' : item.name)}
                      className={cn(
                        'shrink-0 rounded-full px-2.5 py-1 text-[12px] transition-colors',
                        selected
                          ? 'bg-[var(--accent)] font-medium text-[var(--accent-contrast)]'
                          : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] ring-1 ring-[var(--border-subtle)] hover:bg-[var(--bg-hover)]',
                      )}
                    >
                      {`#${item.name}`}
                      <span className="ml-1 opacity-65">{item.count}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <main className="pb-[calc(40px+env(safe-area-inset-bottom))]">
          {loading ? (
            <div className="py-20">
              <LoadingBlock label={t('blog.loading')} />
            </div>
          ) : error && posts.length === 0 ? (
            <div className="px-4 py-16">
              <Empty
                art="notes"
                title={t('blog.load_failed')}
                description={error}
                action={
                  <Button size="sm" variant="secondary" onClick={() => void fetchFeed({ initial: true })}>
                    {t('common.retry')}
                  </Button>
                }
              />
            </div>
          ) : posts.length === 0 ? (
            <div className="px-4 py-16">
              <Empty
                art="notes"
                title={hasFilters ? t('blog.empty_filtered_title') : t('blog.empty_title')}
                description={hasFilters ? t('blog.empty_filtered_description') : t('blog.empty_description')}
                action={
                  hasFilters ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        selectTag('')
                        setSearchInput('')
                      }}
                    >
                      {t('blog.clear_filters')}
                    </Button>
                  ) : (
                    <a
                      href="/notes"
                      className="inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--accent)] px-3.5 text-[12.5px] font-medium text-[var(--accent-contrast)] transition-opacity hover:opacity-92"
                    >
                      <BookOpen size={13} />
                      {t('blog.go_to_notebook')}
                    </a>
                  )
                }
              />
            </div>
          ) : (
            <>
              <div>
                {posts.map((post) => (
                  <MomentCard
                    key={post.slug}
                    post={post}
                    liked={likedSlugs.has(post.slug)}
                    unlocked={Boolean(unlockedNotes[post.slug])}
                    menuOpen={openMenuSlug === post.slug}
                    activeTag={activeTag}
                    onOpenPost={() => setActivePostSlug(post.slug)}
                    onToggleLike={() => void toggleLike(post.slug)}
                    onToggleMenu={() =>
                      setOpenMenuSlug((current) => (current === post.slug ? null : post.slug))
                    }
                    onCloseMenu={() => setOpenMenuSlug(null)}
                    onSelectTag={selectTag}
                    onOpenImages={(images, index) => setGallery({ images, index })}
                  />
                ))}
              </div>

              <div className="flex flex-col items-center gap-3 px-4 pt-6 pb-8">
                {nextCursor ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={loadingMore}
                    onClick={() => void loadMore()}
                  >
                    {loadingMore ? t('blog.loading_more') : t('blog.load_more')}
                  </Button>
                ) : (
                  <p className="text-[11.5px] text-[var(--text-quaternary)]">
                    {t('blog.no_more_moments')}
                  </p>
                )}

                <a
                  href="/notes"
                  className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] text-[var(--text-quaternary)] transition-colors hover:text-[var(--accent)]"
                >
                  {renderBrandIcon(12)}
                  <span>{t('blog.powered_by', { site: siteName })}</span>
                </a>
              </div>
            </>
          )}
        </main>
      </div>

      {scrolled && (
        <Tooltip label={t('blog.scroll_to_top')} side="left">
          <button
            type="button"
            aria-label={t('blog.scroll_to_top')}
            onClick={scrollToTop}
            className="fixed right-4 bottom-[calc(20px+env(safe-area-inset-bottom))] z-20 inline-flex size-10 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)]/92 text-[var(--text-secondary)] shadow-[var(--shadow-pop)] backdrop-blur transition-colors hover:text-[var(--text-primary)] md:right-6 md:bottom-6"
          >
            <ArrowUp size={16} />
          </button>
        </Tooltip>
      )}

      <MomentReaderModal
        post={activePost}
        dark={dark}
        liked={activePost ? likedSlugs.has(activePost.slug) : false}
        cachedNote={activePost ? unlockedNotes[activePost.slug] ?? null : null}
        onUnlocked={handleNoteUnlocked}
        onToggleLike={(slug) => void toggleLike(slug)}
        onSelectTag={selectTag}
        onOpenImages={(images, index) => setGallery({ images, index })}
        onClose={() => setActivePostSlug(null)}
      />

      {gallery && (
        <MomentLightbox
          images={gallery.images}
          index={gallery.index}
          onChangeIndex={(next) => setGallery((current) => (current ? { ...current, index: next } : null))}
          onClose={() => setGallery(null)}
        />
      )}
    </div>
  )
}

function MomentsCoverBackdrop() {
  return (
    <div
      className="size-full"
      style={{
        background:
          'linear-gradient(155deg, var(--moments-cover-from) 0%, var(--moments-cover-mid) 54%, var(--moments-cover-to) 100%)',
      }}
    >
      <svg
        viewBox="0 0 640 280"
        preserveAspectRatio="xMidYMid slice"
        className="size-full"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="moments-moon" cx="76%" cy="28%" r="36%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.32" />
            <stop offset="48%" stopColor="#f5d9c6" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="moments-ridge-far" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1c2430" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#1c2430" stopOpacity="0.62" />
          </linearGradient>
          <linearGradient id="moments-ridge-mid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#161b22" stopOpacity="0.48" />
            <stop offset="100%" stopColor="#12161c" stopOpacity="0.82" />
          </linearGradient>
          <linearGradient id="moments-ridge-near" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#111317" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#0c0e11" stopOpacity="0.88" />
          </linearGradient>
        </defs>
        <rect width="640" height="280" fill="url(#moments-moon)" />
        <circle cx="486" cy="78" r="24" fill="#fff7ee" fillOpacity="0.26" />
        <path
          d="M0 178 Q92 128 190 156 T396 138 T640 162 L640 280 L0 280 Z"
          fill="url(#moments-ridge-far)"
        />
        <path
          d="M0 212 Q128 164 252 194 T492 176 T640 202 L640 280 L0 280 Z"
          fill="url(#moments-ridge-mid)"
        />
        <path
          d="M0 242 Q140 206 290 232 T540 214 T640 238 L640 280 L0 280 Z"
          fill="url(#moments-ridge-near)"
        />
      </svg>
    </div>
  )
}
