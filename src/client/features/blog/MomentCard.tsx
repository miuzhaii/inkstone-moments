import { BookOpen, ExternalLink, Heart, Image as ImageIcon, Link2, Lock, LockOpen, MoreHorizontal, Pin } from 'lucide-react'
import type { PublicBlogImage, PublicBlogPost } from '@shared/types'
import { readingMinutes } from '@shared/markdown-utils'
import { cn } from '../../lib/cn'
import { t, useLocale } from '../../lib/i18n'
import { fullTime, shortTime } from '../../lib/time'
import { Avatar } from '../../components/primitives'
import { useUi } from '../../store/ui'

export function MomentCard({
  post,
  liked,
  unlocked,
  menuOpen,
  activeTag,
  onOpenPost,
  onToggleLike,
  onToggleMenu,
  onCloseMenu,
  onSelectTag,
  onOpenImages,
}: {
  post: PublicBlogPost
  liked: boolean
  unlocked: boolean
  menuOpen: boolean
  activeTag: string
  onOpenPost: () => void
  onToggleLike: () => void
  onToggleMenu: () => void
  onCloseMenu: () => void
  onSelectTag: (tag: string) => void
  onOpenImages: (images: PublicBlogImage[], index: number) => void
}) {
  useLocale()
  const toast = useUi((s) => s.toast)
  const articleUrl = `/s/${post.slug}`
  const displayTitle = post.title.trim()

  const copyLink = async () => {
    onCloseMenu()
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

  const handleCardClick = (event: React.MouseEvent<HTMLElement>) => {
    const selection = window.getSelection?.()?.toString().trim()
    if (selection) return
    const target = event.target as HTMLElement
    if (target.closest('a, button, input, [data-moment-stop]')) return
    onOpenPost()
  }

  const gridClass =
    post.images.length === 1
      ? ''
      : post.images.length === 2 || post.images.length === 4
        ? 'grid grid-cols-2 gap-1.5 max-w-[260px]'
        : 'grid grid-cols-3 gap-1.5 max-w-[336px]'

  return (
    <article
      onClick={handleCardClick}
      className="group/card flex cursor-pointer gap-3 border-b border-[var(--border-subtle)] px-4 py-4.5 transition-colors hover:bg-[var(--bg-hover)]/45 sm:px-5 sm:py-5"
    >
      <div className="shrink-0 pt-0.5">
        <Avatar
          src={post.author.avatarUrl}
          name={post.author.name}
          size={42}
          className="rounded-[7px]"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] leading-snug font-semibold text-[var(--moments-link)]">
            {post.author.name}
          </span>
          {post.isPinned && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-[4px] bg-[var(--accent-softer)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--accent)]">
              <Pin size={10} />
              {t('blog.pinned')}
            </span>
          )}
          {post.locked && (
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-0.5 rounded-[4px] px-1.5 py-0.5 text-[10.5px] font-medium',
                unlocked
                  ? 'bg-[color-mix(in_oklab,var(--success)_14%,transparent)] text-[var(--success)]'
                  : 'bg-[var(--bg-inset)] text-[var(--text-tertiary)]',
              )}
            >
              {unlocked ? <LockOpen size={10} /> : <Lock size={10} />}
              {unlocked ? t('blog.unlocked_badge') : t('blog.encrypted_badge')}
            </span>
          )}
        </div>

        {displayTitle && (
          <h2 className="mt-1 text-[15.5px] leading-[1.45] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            <button
              type="button"
              onClick={onOpenPost}
              className="text-left transition-colors hover:text-[var(--moments-link)]"
            >
              {displayTitle}
            </button>
          </h2>
        )}

        {post.locked ? (
          <button
            type="button"
            onClick={onOpenPost}
            className="mt-2 flex w-full items-center justify-between gap-3 rounded-[var(--r-lg)] border border-[var(--border-subtle)] bg-[var(--bg-inset)]/85 px-3.5 py-3 text-left transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--bg-inset)]"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className={cn(
                  'inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]',
                  unlocked ? 'text-[var(--success)]' : 'text-[var(--accent)]',
                )}
              >
                {unlocked ? <LockOpen size={16} /> : <Lock size={16} />}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-medium text-[var(--text-primary)]">
                  {unlocked ? t('blog.unlocked_badge') : t('blog.encrypted_moment_title')}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-[var(--text-tertiary)]">
                  <span>
                    {unlocked ? t('blog.unlocked_moment_hint') : t('blog.encrypted_moment_hint')}
                  </span>
                  {post.imageCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-[var(--text-quaternary)]">
                      <ImageIcon size={11} />
                      {t('blog.encrypted_images_hint', { count: post.imageCount })}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-[var(--accent-softer)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--accent)]">
              {unlocked ? t('blog.open_article') : t('blog.unlock_moment')}
            </span>
          </button>
        ) : (
          <>
            {post.previewText && (
              <p className="mt-1 whitespace-pre-line break-words text-[14.5px] leading-[1.68] text-[var(--text-primary)]">
                {post.previewText}
              </p>
            )}
            {post.hasMoreContent && (
              <button
                type="button"
                onClick={onOpenPost}
                className="mt-1 inline-flex items-center gap-1 text-[13.5px] font-medium text-[var(--moments-link)] transition-opacity hover:opacity-80"
              >
                <span>{t('blog.expand_text')}</span>
              </button>
            )}
          </>
        )}

        {!post.locked && post.images.length > 0 && (
          <div className={cn('mt-2.5', gridClass)} data-moment-stop>
            {post.images.length === 1 ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenImages(post.images, 0)
                }}
                aria-label={post.images[0]!.alt || t('preview.image_preview')}
                className="group relative block max-w-[260px] overflow-hidden rounded-[4px] bg-[var(--bg-inset)] ring-1 ring-[var(--border-subtle)]"
              >
                <img
                  src={post.images[0]!.src}
                  alt={post.images[0]!.alt}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="max-h-[260px] min-h-[110px] w-auto max-w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                />
              </button>
            ) : (
              post.images.map((image, index) => {
                const extraCount = index === 8 ? post.imageCount - 9 : 0
                return (
                  <button
                    key={`${image.src}-${index}`}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpenImages(post.images, index)
                    }}
                    aria-label={image.alt || t('preview.image_preview')}
                    className="group relative aspect-square overflow-hidden rounded-[4px] bg-[var(--bg-inset)] ring-1 ring-[var(--border-subtle)]"
                  >
                    <img
                      src={image.src}
                      alt={image.alt}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    />
                    {extraCount > 0 && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[16px] font-semibold text-white">
                        {t('blog.more_images', { count: extraCount })}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        )}

        {post.tags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5" data-moment-stop>
            {post.tags.map((tag) => {
              const selected = activeTag.toLocaleLowerCase() === tag.toLocaleLowerCase()
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onSelectTag(selected ? '' : tag)
                  }}
                  className={cn(
                    'rounded-[4px] px-1.5 py-0.5 text-[12px] leading-none transition-colors',
                    selected
                      ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                      : 'bg-[var(--bg-inset)] text-[var(--moments-link)] hover:bg-[var(--bg-active)]',
                  )}
                >
                  {`#${tag}`}
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-2.5 flex items-center justify-between gap-2 text-[12px] text-[var(--text-quaternary)]">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <time
              dateTime={new Date(post.publishedAt).toISOString()}
              title={fullTime(post.publishedAt)}
            >
              {shortTime(post.publishedAt)}
            </time>
            <span>{`${t('common.about')}${readingMinutes(post.wordCount)}${t('common.min')}`}</span>
            {post.views > 0 && <span>{t('blog.views_count', { count: post.views })}</span>}
            <button
              type="button"
              onClick={onOpenPost}
              className="text-[var(--moments-link)] transition-opacity hover:opacity-80"
            >
              {post.locked && !unlocked ? t('blog.unlock_moment') : t('blog.open_article')}
            </button>
          </div>

          <div className="relative shrink-0" data-moment-stop data-moment-menu>
            <button
              type="button"
              aria-label={t('blog.actions')}
              aria-expanded={menuOpen}
              onClick={(event) => {
                event.stopPropagation()
                onToggleMenu()
              }}
              className="inline-flex h-[22px] w-8 items-center justify-center rounded-[4px] bg-[var(--bg-inset)] text-[var(--moments-link)] transition-colors hover:bg-[var(--bg-active)]"
            >
              <MoreHorizontal size={15} />
            </button>

            {menuOpen && (
              <div
                role="menu"
                onClick={(event) => event.stopPropagation()}
                className="anim-fade absolute top-1/2 right-10 z-20 flex -translate-y-1/2 items-center overflow-hidden rounded-[6px] bg-[var(--moments-action-bg)] text-[12.5px] font-medium whitespace-nowrap text-white shadow-[var(--shadow-pop)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onToggleLike()
                    onCloseMenu()
                  }}
                  className="inline-flex h-9 items-center gap-1.5 px-3 transition-colors hover:bg-white/10"
                >
                  <Heart
                    size={13}
                    className={cn(liked && 'fill-[#fa5151] text-[#fa5151]')}
                  />
                  <span>{liked ? t('blog.liked') : t('blog.like')}</span>
                </button>
                <span className="h-4 w-px bg-white/15" aria-hidden="true" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void copyLink()}
                  className="inline-flex h-9 items-center gap-1.5 px-3 transition-colors hover:bg-white/10"
                >
                  <Link2 size={13} />
                  <span>{t('blog.copy_link')}</span>
                </button>
                <span className="h-4 w-px bg-white/15" aria-hidden="true" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onCloseMenu()
                    onOpenPost()
                  }}
                  className="inline-flex h-9 items-center gap-1.5 px-3 transition-colors hover:bg-white/10"
                >
                  <BookOpen size={13} />
                  <span>{post.locked && !unlocked ? t('blog.unlock_moment') : t('blog.open_article')}</span>
                </button>
                <span className="h-4 w-px bg-white/15" aria-hidden="true" />
                <a
                  href={articleUrl}
                  target="_blank"
                  rel="noreferrer"
                  role="menuitem"
                  aria-label={t('blog.open_standalone')}
                  className="inline-flex h-9 items-center px-2.5 transition-colors hover:bg-white/10"
                >
                  <ExternalLink size={13} />
                </a>
              </div>
            )}
          </div>
        </div>

        {(liked || post.likes > 0) && (
          <div
            data-moment-stop
            className="relative mt-2.5 rounded-[4px] bg-[var(--bg-inset)] px-2.5 py-1.5 text-[12.5px] text-[var(--moments-link)]"
          >
            <span
              aria-hidden="true"
              className="absolute -top-1 left-3 size-2 rotate-45 bg-[var(--bg-inset)]"
            />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onToggleLike()
              }}
              className="inline-flex items-center gap-1.5 text-left transition-opacity hover:opacity-80"
            >
              <Heart
                size={12}
                className={cn(liked ? 'fill-[#fa5151] text-[#fa5151]' : 'text-[var(--moments-link)]')}
              />
              <span>
                {liked && post.likes > 1
                  ? t('blog.liked_by_you_and_others', { count: post.likes - 1 })
                  : liked
                    ? t('blog.liked_by_you')
                    : t('blog.likes_count', { count: post.likes })}
              </span>
            </button>
          </div>
        )}
      </div>
    </article>
  )
}
