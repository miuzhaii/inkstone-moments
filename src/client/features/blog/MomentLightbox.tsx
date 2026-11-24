import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Download, ImageOff, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { PublicBlogImage } from '@shared/types'
import { IconButton } from '../../components/primitives'
import { Tooltip, useDialogFocus, useEscape, useLockScroll } from '../../components/overlay'
import { t } from '../../lib/i18n'

export function MomentLightbox({
  images,
  index,
  onChangeIndex,
  onClose,
}: {
  images: PublicBlogImage[]
  index: number
  onChangeIndex: (next: number) => void
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [failed, setFailed] = useState(false)
  const current = images[index] ?? null
  const open = Boolean(current)

  useEscape(open, onClose)
  useLockScroll(open)
  useDialogFocus(open, panelRef)

  useLayoutEffect(() => {
    setScale(1)
    setFailed(false)
  }, [current?.src])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (images.length <= 1) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onChangeIndex((index - 1 + images.length) % images.length)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        onChangeIndex((index + 1) % images.length)
      }
    }
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      setScale((s) => Math.min(6, Math.max(0.3, s - event.deltaY * 0.002)))
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('wheel', onWheel)
    }
  }, [open, index, images.length, onChangeIndex])

  if (!current) return null

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('preview.image_preview')}
      tabIndex={-1}
      className="app-viewport-fixed anim-fade fixed z-[320] flex items-center justify-center bg-[oklch(0%_0_0/84%)] backdrop-blur-[2px] outline-none"
      onClick={onClose}
    >
      {images.length > 1 && (
        <div
          className="absolute top-[calc(14px+env(safe-area-inset-top))] left-4 rounded-full bg-black/45 px-3 py-1 text-[12px] font-medium tabular text-white/85 md:top-5"
          onClick={(e) => e.stopPropagation()}
        >
          {`${index + 1} / ${images.length}`}
        </div>
      )}

      <div
        className="absolute top-[calc(12px+env(safe-area-inset-top))] right-2 flex items-center gap-1 md:top-4 md:right-4"
        onClick={(e) => e.stopPropagation()}
      >
        <Tooltip label={t('common.zoom_out')} side="bottom">
          <IconButton
            label={t('common.zoom_out')}
            disabled={failed || scale <= 0.3}
            onClick={() => setScale((s) => Math.max(0.3, s - 0.25))}
            className="text-white/75 hover:bg-white/10 hover:text-white"
          >
            <ZoomOut size={16} />
          </IconButton>
        </Tooltip>
        <span aria-live="polite" className="w-11 text-center text-[11.5px] tabular text-white/65">
          {`${Math.round(scale * 100)}%`}
        </span>
        <Tooltip label={t('common.zoom_in')} side="bottom">
          <IconButton
            label={t('common.zoom_in')}
            disabled={failed || scale >= 6}
            onClick={() => setScale((s) => Math.min(6, s + 0.25))}
            className="text-white/75 hover:bg-white/10 hover:text-white"
          >
            <ZoomIn size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip label={t('preview.download_original_image')} side="bottom">
          <a
            href={current.src}
            download
            target="_blank"
            rel="noreferrer"
            aria-label={t('preview.download_original_image')}
            className="inline-flex size-9 items-center justify-center rounded-[var(--r-md)] text-white/75 transition-colors hover:bg-white/10 hover:text-white md:size-7"
          >
            <Download size={16} />
          </a>
        </Tooltip>
        <Tooltip label={t('common.close')} combo="escape" side="bottom">
          <IconButton
            label={t('common.close')}
            onClick={onClose}
            className="text-white/75 hover:bg-white/10 hover:text-white"
          >
            <X size={17} />
          </IconButton>
        </Tooltip>
      </div>

      {images.length > 1 && (
        <>
          <button
            type="button"
            aria-label={t('blog.previous_image')}
            onClick={(e) => {
              e.stopPropagation()
              onChangeIndex((index - 1 + images.length) % images.length)
            }}
            className="absolute left-3 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white/80 transition-colors hover:bg-black/65 hover:text-white md:left-5"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            aria-label={t('blog.next_image')}
            onClick={(e) => {
              e.stopPropagation()
              onChangeIndex((index + 1) % images.length)
            }}
            className="absolute right-3 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white/80 transition-colors hover:bg-black/65 hover:text-white md:right-5"
          >
            <ChevronRight size={20} />
          </button>
        </>
      )}

      {failed ? (
        <div
          role="status"
          className="flex max-w-[80vw] flex-col items-center gap-2 rounded-[var(--r-lg)] bg-black/35 px-5 py-4 text-center text-[12px] text-white/75"
        >
          <ImageOff size={24} />
          {t('preview.could_not_load_image')}
        </div>
      ) : (
        <img
          src={current.src}
          alt={current.alt}
          onError={() => setFailed(true)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={() => setScale((s) => (s === 1 ? 2 : 1))}
          style={{ transform: `scale(${scale})` }}
          className={`max-h-[84vh] max-w-[90vw] rounded-[var(--r-md)] object-contain transition-transform duration-200 ease-[var(--ease-out)] ${scale === 1 ? 'cursor-zoom-in' : 'cursor-zoom-out'}`}
        />
      )}

      {current.alt && (
        <div className="absolute bottom-[calc(16px+env(safe-area-inset-bottom))] left-1/2 max-w-[82vw] -translate-x-1/2 truncate rounded-full bg-black/55 px-3 py-1.5 text-[12px] text-white/85 md:bottom-6 md:max-w-[70vw]">
          {current.alt}
        </div>
      )}
    </div>,
    document.body,
  )
}
