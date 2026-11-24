import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Heart, KeyRound, Link2, Lock, Pin, ShieldAlert, X } from 'lucide-react'
import { LIMITS } from '@shared/constants'
import type { PublicBlogImage, PublicBlogPost, PublicNote } from '@shared/types'
import { countText, readingMinutes } from '@shared/markdown-utils'
import { api, ApiError } from '../../lib/api'
import { cn } from '../../lib/cn'
import { t, useLocale } from '../../lib/i18n'
import { renderMarkdown } from '../../lib/markdown/renderer'
import {
  enhancePreview,
  renderPendingMermaid,
  resetMermaidNode,
  toggleCodeBlockCollapse,
} from '../../lib/markdown/enhance'
import { fullTime } from '../../lib/time'
import { Input } from '../../components/form'
import { LoadingBlock } from '../../components/feedback'
import { Tooltip, useDialogFocus, useEscape, useLockScroll } from '../../components/overlay'
import { Avatar, Button, IconButton } from '../../components/primitives'
import { useUi } from '../../store/ui'
import { moveMarkdownTabFocus, selectMarkdownTab } from '../preview/markdown-tabs'
import { preparePublicMarkdownHtml } from './share-html'

export function extractRetryAfterSeconds(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.status !== 429) return null
  const raw = (err.details as { retryAfter?: unknown } | null)?.retryAfter
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.max(1, Math.ceil(raw))
  }
  return 60
}

export function MomentReaderModal({
  post,
  dark,
  liked,
  cachedNote,
  onUnlocked,
  onToggleLike,
  onSelectTag,
  onOpenImages,
  onClose,
}: {
  post: PublicBlogPost | null
  dark: boolean
  liked: boolean
  cachedNote: PublicNote | null
  onUnlocked: (slug: string, note: PublicNote) => void
  onToggleLike: (slug: string) => void
  onSelectTag: (tag: string) => void
  onOpenImages: (images: PublicBlogImage[], index: number) => void
  onClose: () => void
}) {
  const locale = useLocale()
  const toast = useUi((s) => s.toast)
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const passwordInputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const enhancementRevisionRef = useRef(0)
  const copyResetTimersRef = useRef(new Map<HTMLElement, number>())

  const [note, setNote] = useState<PublicNote | null>(cachedNote)
  const [needPassword, setNeedPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldownSec, setCooldownSec] = useState(0)

  const open = Boolean(post)
  const slug = post?.slug ?? ''

  useEscape(open, onClose)
  useLockScroll(open)
  useDialogFocus(open, panelRef, needPassword ? passwordInputRef : undefined)

  useEffect(
    () => () => {
      requestRef.current?.abort()
      enhancementRevisionRef.current++
      for (const timer of copyResetTimersRef.current.values()) window.clearTimeout(timer)
      copyResetTimersRef.current.clear()
    },
    [],
  )

  useEffect(() => {
    if (cooldownSec <= 0) return
    const timer = window.setInterval(() => {
      setCooldownSec((current) => (current <= 1 ? 0 : current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [cooldownSec])

  const loadNote = useCallback(
    async (targetSlug: string, passcode?: string) => {
      requestRef.current?.abort()
      const controller = new AbortController()
      requestRef.current = controller
      setLoading(true)
      setError(null)
      try {
        const result = await api.share.read(targetSlug, passcode, controller.signal)
        if (controller.signal.aborted) return
        setNote(result)
        setNeedPassword(false)
        setPassword('')
        setCooldownSec(0)
        onUnlocked(targetSlug, result)
      } catch (err) {
        if (controller.signal.aborted || (err as Error)?.name === 'AbortError') return
        const retrySec = extractRetryAfterSeconds(err)
        if (retrySec !== null) {
          setNeedPassword(true)
          setCooldownSec(retrySec)
          setError(null)
        } else if (err instanceof ApiError && err.status === 401) {
          setNote(null)
          setNeedPassword(true)
          if (passcode !== undefined) setError(t('share.incorrect_passcode'))
        } else {
          setError(err instanceof ApiError ? err.message : t('share.content_unavailable'))
        }
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null
          setLoading(false)
        }
      }
    },
    [onUnlocked],
  )

  useEffect(() => {
    requestRef.current?.abort()
    requestRef.current = null
    setPassword('')
    setError(null)
    setCooldownSec(0)
    if (!post) {
      setNote(null)
      setNeedPassword(false)
      setLoading(false)
      return
    }
    if (cachedNote) {
      setNote(cachedNote)
      setNeedPassword(false)
      setLoading(false)
      return
    }
    if (post.locked) {
      setNote(null)
      setNeedPassword(true)
      setLoading(false)
      return
    }
    setNote(null)
    setNeedPassword(false)
    void loadNote(post.slug)
  }, [post?.slug, post?.locked, cachedNote, loadNote])

  const rendered = useMemo(() => {
    if (!note) return null
    const result = renderMarkdown(note.content)
    return {
      ...result,
      html: preparePublicMarkdownHtml(result.html, note.share.slug, { hideFrontMatter: true }),
    }
  }, [note, locale])

  const htmlObj = useMemo(() => ({ __html: rendered?.html ?? '' }), [rendered])

  useEffect(() => {
    if (!rendered || !hostRef.current) return
    const host = hostRef.current
    const revision = ++enhancementRevisionRef.current
    let cancelled = false
    const isCurrent = () =>
      !cancelled && enhancementRevisionRef.current === revision && hostRef.current === host
    void (async () => {
      await enhancePreview(host, { math: true, mermaid: true, dark, codeBlockCollapseLines: 24 })
      if (!isCurrent()) return
      await renderPendingMermaid(host, dark, { isCurrent })
    })()
    return () => {
      cancelled = true
    }
  }, [rendered, dark])

  if (!post) return null

  const articleUrl = `/s/${post.slug}`
  const stats = note ? countText(note.content) : null
  const displayTitle = (note?.title || post.title || '').trim() || t('common.untitled_note')

  const copyLink = async () => {
    const fullUrl = `${window.location.origin}${articleUrl}`
    if (!navigator.clipboard?.writeText) {
      toast({ title: t('preview.could_not_copy'), tone: 'danger' })
      return
    }
    try {
      await navigator.clipboard.writeText(fullUrl)
      toast({ title: t('common.copied'), tone: 'success' })
    } catch {
      toast({ title: t('preview.could_not_copy'), tone: 'danger' })
    }
  }

  const onContentClick = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement
    const mermaidRetry = target.closest<HTMLElement>('[data-mermaid-retry]')
    if (mermaidRetry) {
      const block = mermaidRetry.closest<HTMLElement>('[data-mermaid]')
      const host = hostRef.current
      if (block && host) {
        resetMermaidNode(block)
        const revision = ++enhancementRevisionRef.current
        void renderPendingMermaid(host, dark, {
          isCurrent: () => enhancementRevisionRef.current === revision && hostRef.current === host,
        })
      }
      return
    }

    const copyButton = target.closest<HTMLElement>('[data-copy]')
    if (copyButton) {
      const code = copyButton.closest('.code-block')?.querySelector('pre')?.textContent ?? ''
      if (!navigator.clipboard?.writeText) {
        toast({ title: t('preview.could_not_copy'), tone: 'danger' })
        return
      }
      void navigator.clipboard
        .writeText(code)
        .then(() => {
          if (!hostRef.current?.contains(copyButton)) return
          const existingTimer = copyResetTimersRef.current.get(copyButton)
          if (existingTimer !== undefined) window.clearTimeout(existingTimer)
          copyButton.textContent = t('common.copied')
          copyButton.classList.add('copied')
          const timer = window.setTimeout(() => {
            if (hostRef.current?.contains(copyButton)) {
              copyButton.textContent = t('common.copy')
              copyButton.classList.remove('copied')
            }
            copyResetTimersRef.current.delete(copyButton)
          }, 900)
          copyResetTimersRef.current.set(copyButton, timer)
        })
        .catch(() => toast({ title: t('preview.could_not_copy'), tone: 'danger' }))
      return
    }

    const collapseButton = target.closest<HTMLButtonElement>('[data-code-collapse]')
    if (collapseButton) {
      toggleCodeBlockCollapse(collapseButton)
      return
    }

    const tabButton = target.closest<HTMLButtonElement>('[data-tab-button]')
    if (tabButton) {
      event.preventDefault()
      selectMarkdownTab(tabButton)
      return
    }

    const image = target.closest<HTMLImageElement>('img')
    if (image?.src) {
      event.preventDefault()
      const all = [...(hostRef.current?.querySelectorAll<HTMLImageElement>('img') ?? [])]
        .filter((item) => Boolean(item.src))
        .map((item) => ({ src: item.src, alt: item.alt }))
      const clickedIndex = Math.max(0, all.findIndex((item) => item.src === image.src))
      onOpenImages(all.length ? all : [{ src: image.src, alt: image.alt }], clickedIndex)
    }
  }

  const onContentKeyDown = (event: React.KeyboardEvent) => {
    const tab = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tab-button]')
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      moveMarkdownTabFocus(tab, event.key)
    }
  }

  const submitPasscode = (event: React.FormEvent) => {
    event.preventDefault()
    if (loading || cooldownSec > 0) return
    if (!password.trim()) {
      setError(t('share.enter_a_passcode'))
      return
    }
    void loadNote(slug, password)
  }

  return createPortal(
    <div className="app-viewport-fixed fixed z-[250] flex items-end justify-center overflow-hidden md:items-center md:p-6">
      <div
        className="anim-fade absolute inset-0 bg-[var(--scrim)] backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'anim-pop relative flex max-h-[calc(var(--app-viewport-height,100dvh)-env(safe-area-inset-top)-8px)] w-full max-w-[740px] flex-col overflow-hidden rounded-t-[var(--r-2xl)] border border-b-0 border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-modal)] outline-none',
          'md:max-h-[min(86dvh,860px)] md:rounded-[var(--r-2xl)] md:border-b',
        )}
      >
        <header className="flex shrink-0 items-center gap-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 px-4 py-3 backdrop-blur sm:px-5">
          <Avatar
            src={note?.author.avatarUrl || post.author.avatarUrl}
            name={note?.author.name || post.author.name}
            size={32}
            className="rounded-[7px]"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13.5px] font-semibold text-[var(--text-primary)]">
                {note?.author.name || post.author.name}
              </span>
              {post.isPinned && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-[4px] bg-[var(--accent-softer)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                  <Pin size={9} />
                  {t('blog.pinned')}
                </span>
              )}
              {post.locked && (
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-0.5 rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium',
                    note
                      ? 'bg-[color-mix(in_oklab,var(--success)_14%,transparent)] text-[var(--success)]'
                      : 'bg-[var(--bg-inset)] text-[var(--text-tertiary)]',
                  )}
                >
                  <Lock size={9} />
                  {note ? t('blog.unlocked_badge') : t('blog.encrypted_badge')}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-[var(--text-quaternary)]">
              <span>{fullTime(note?.updatedAt ?? post.publishedAt)}</span>
              {stats && (
                <>
                  <span>·</span>
                  <span>{`${t('common.about')}${readingMinutes(stats.words)}${t('common.min')}`}</span>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onToggleLike(post.slug)}
            aria-label={liked ? t('blog.liked') : t('blog.like')}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border px-2.5 text-[12px] font-medium transition-colors',
              liked
                ? 'border-[#fa5151]/35 bg-[#fa5151]/10 text-[#fa5151]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
            )}
          >
            <Heart size={13} className={cn(liked && 'fill-[#fa5151] text-[#fa5151]')} />
            {post.likes > 0 && <span>{post.likes}</span>}
          </button>

          <Tooltip label={t('blog.copy_link')} side="bottom">
            <IconButton label={t('blog.copy_link')} size="sm" onClick={() => void copyLink()}>
              <Link2 size={14} />
            </IconButton>
          </Tooltip>

          <Tooltip label={t('blog.open_standalone')} side="bottom">
            <a
              href={articleUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={t('blog.open_standalone')}
              className="inline-flex size-8 items-center justify-center rounded-[var(--r-md)] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] md:size-7"
            >
              <ExternalLink size={14} />
            </a>
          </Tooltip>

          <Tooltip label={t('common.close')} combo="escape" side="left">
            <IconButton label={t('common.close')} size="sm" onClick={onClose}>
              <X size={15} />
            </IconButton>
          </Tooltip>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 pb-[calc(24px+env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
          {loading && !needPassword ? (
            <div className="py-20">
              <LoadingBlock label={t('share.opening')} />
            </div>
          ) : needPassword ? (
            <div className="mx-auto max-w-[360px] py-8 text-center sm:py-12">
              <div className="mx-auto mb-4 flex size-13 items-center justify-center rounded-[16px] border border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--accent)] shadow-[var(--shadow-sm)]">
                <Lock size={21} />
              </div>
              <h2
                id={titleId}
                className="text-[17px] leading-snug font-semibold text-[var(--text-primary)]"
              >
                {displayTitle}
              </h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--text-tertiary)]">
                {t('blog.encrypted_moment_hint')}
              </p>

              <form className="mt-5 space-y-2.5 text-left" onSubmit={submitPasscode}>
                <Input
                  ref={passwordInputRef}
                  aria-label={t('common.access_passcode')}
                  type="password"
                  value={password}
                  disabled={loading || cooldownSec > 0}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    if (error) setError(null)
                  }}
                  placeholder={t('common.access_passcode')}
                  autoComplete="current-password"
                  maxLength={LIMITS.passwordMaxLength}
                  data-autofocus
                  leading={<KeyRound size={13} />}
                  invalid={Boolean(error || cooldownSec > 0)}
                />

                {cooldownSec > 0 && (
                  <div
                    role="alert"
                    className="flex items-center gap-2 rounded-[var(--r-md)] border border-[color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[color-mix(in_oklab,var(--danger)_9%,transparent)] px-3 py-2 text-[12px] text-[var(--danger)]"
                  >
                    <ShieldAlert size={14} className="shrink-0" />
                    <span>{t('blog.retry_after_seconds', { seconds: cooldownSec })}</span>
                  </div>
                )}

                {error && cooldownSec <= 0 && (
                  <p role="alert" className="text-center text-[12px] text-[var(--danger)]">
                    {error}
                  </p>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  block
                  loading={loading}
                  disabled={cooldownSec > 0}
                >
                  {cooldownSec > 0
                    ? t('blog.retry_after_seconds', { seconds: cooldownSec })
                    : t('blog.unlock_submit')}
                </Button>
              </form>

              <p className="mt-4 text-[11px] text-[var(--text-quaternary)]">
                {t('blog.encrypted_security_hint')}
              </p>
            </div>
          ) : error ? (
            <div className="mx-auto max-w-[380px] py-16 text-center">
              <h2 id={titleId} className="text-[16px] font-semibold text-[var(--text-primary)]">
                {t('share.content_unavailable')}
              </h2>
              <p role="alert" className="mt-2 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
                {error}
              </p>
              <div className="mt-4">
                <Button size="sm" variant="secondary" onClick={() => void loadNote(post.slug)}>
                  {t('common.retry')}
                </Button>
              </div>
            </div>
          ) : note ? (
            <article>
              <h2
                id={titleId}
                className="text-[22px] leading-[1.3] font-bold tracking-[-0.025em] text-[var(--text-primary)] sm:text-[26px]"
              >
                {displayTitle}
              </h2>

              {post.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {post.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        onSelectTag(tag)
                        onClose()
                      }}
                      className="rounded-[4px] bg-[var(--bg-inset)] px-2 py-0.5 text-[12px] text-[var(--moments-link)] transition-colors hover:bg-[var(--bg-active)]"
                    >
                      {`#${tag}`}
                    </button>
                  ))}
                </div>
              )}

              <div
                ref={hostRef}
                onClick={onContentClick}
                onKeyDown={onContentKeyDown}
                className="ink-prose mt-5"
                style={{ maxWidth: 'none', paddingBlock: 0 }}
                dangerouslySetInnerHTML={htmlObj}
              />
            </article>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
