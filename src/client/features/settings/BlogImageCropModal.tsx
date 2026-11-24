import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw, Upload, ZoomIn, ZoomOut } from 'lucide-react'
import { traceRoundedRect } from '../../lib/branding'
import { cn } from '../../lib/cn'
import { t } from '../../lib/i18n'
import { Modal } from '../../components/overlay'
import { Button } from '../../components/primitives'

const COVER_ASPECT = 640 / 268
const MIN_ZOOM = 1
const MAX_ZOOM = 3

export type CropKind = 'cover' | 'logo'

interface NaturalSize {
  width: number
  height: number
}

interface Offset {
  x: number
  y: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function computeBounds(
  natural: NaturalSize,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
) {
  const baseScale = Math.max(viewportWidth / natural.width, viewportHeight / natural.height)
  const scale = baseScale * zoom
  const renderedWidth = natural.width * scale
  const renderedHeight = natural.height * scale
  const maxX = Math.max(0, (renderedWidth - viewportWidth) / 2)
  const maxY = Math.max(0, (renderedHeight - viewportHeight) / 2)
  return { baseScale, scale, renderedWidth, renderedHeight, maxX, maxY }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality)
  })
}

export function BlogImageCropModal({
  kind,
  source,
  submitting,
  onConfirm,
  onClose,
}: {
  kind: CropKind
  source: File | string
  submitting: boolean
  onConfirm: (file: File) => void
  onClose: () => void
}) {
  const aspect = kind === 'cover' ? COVER_ASPECT : 1
  const stageRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [natural, setNatural] = useState<NaturalSize | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })
  const [viewportWidth, setViewportWidth] = useState(kind === 'cover' ? 460 : 240)

  useEffect(() => {
    let revokedUrl: string | null = null
    let cancelled = false
    setNatural(null)
    setLoadFailed(false)
    setZoom(1)
    setOffset({ x: 0, y: 0 })

    const url = typeof source === 'string' ? source : URL.createObjectURL(source)
    if (typeof source !== 'string') revokedUrl = url
    setPreviewUrl(url)

    const img = new Image()
    img.decoding = 'async'
    if (typeof source === 'string' && /^https?:\/\//i.test(source)) {
      try {
        if (new URL(source, window.location.href).origin !== window.location.origin) {
          img.crossOrigin = 'anonymous'
        }
      } catch {
      }
    }
    img.onload = () => {
      if (cancelled) return
      if (!img.naturalWidth || !img.naturalHeight) {
        setLoadFailed(true)
        return
      }
      imageRef.current = img
      setNatural({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      if (!cancelled) setLoadFailed(true)
    }
    img.src = url

    return () => {
      cancelled = true
      imageRef.current = null
      if (revokedUrl) URL.revokeObjectURL(revokedUrl)
    }
  }, [source])

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const update = () => {
      const width = element.clientWidth
      if (width > 0) setViewportWidth(width)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [natural])

  const viewportHeight = viewportWidth / aspect

  const applyZoom = useCallback(
    (nextZoomRaw: number) => {
      const nextZoom = clamp(Math.round(nextZoomRaw * 100) / 100, MIN_ZOOM, MAX_ZOOM)
      setZoom(nextZoom)
      if (!natural) return
      const bounds = computeBounds(natural, viewportWidth, viewportHeight, nextZoom)
      setOffset((current) => ({
        x: clamp(current.x, -bounds.maxX, bounds.maxX),
        y: clamp(current.y, -bounds.maxY, bounds.maxY),
      }))
    },
    [natural, viewportWidth, viewportHeight],
  )

  useEffect(() => {
    const element = stageRef.current
    if (!element || !natural) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const delta = -event.deltaY * 0.0018
      applyZoom(zoom + delta)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [natural, zoom, applyZoom])

  const bounds = natural ? computeBounds(natural, viewportWidth, viewportHeight, zoom) : null
  const clampedOffset: Offset = bounds
    ? {
        x: clamp(offset.x, -bounds.maxX, bounds.maxX),
        y: clamp(offset.y, -bounds.maxY, bounds.maxY),
      }
    : { x: 0, y: 0 }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!bounds || submitting || exporting) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: clampedOffset.x,
      originY: clampedOffset.y,
    }
    setDragging(true)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = dragRef.current
    if (!active || active.pointerId !== event.pointerId || !bounds) return
    const nextX = clamp(active.originX + (event.clientX - active.startX), -bounds.maxX, bounds.maxX)
    const nextY = clamp(active.originY + (event.clientY - active.startY), -bounds.maxY, bounds.maxY)
    setOffset({ x: nextX, y: nextY })
  }

  const endPointerDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
  }

  const resetTransform = () => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }

  const confirmCrop = async () => {
    const img = imageRef.current
    if (!img || !natural || !bounds || submitting || exporting) return
    setExporting(true)
    try {
      const sourceX = clamp(
        ((bounds.renderedWidth - viewportWidth) / 2 - clampedOffset.x) / bounds.scale,
        0,
        natural.width,
      )
      const sourceY = clamp(
        ((bounds.renderedHeight - viewportHeight) / 2 - clampedOffset.y) / bounds.scale,
        0,
        natural.height,
      )
      const sourceW = clamp(viewportWidth / bounds.scale, 1, natural.width - sourceX)
      const sourceH = clamp(viewportHeight / bounds.scale, 1, natural.height - sourceY)

      const canvas = document.createElement('canvas')
      if (kind === 'logo') {
        const size = 256
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas unavailable')
        ctx.clearRect(0, 0, size, size)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        traceRoundedRect(ctx, 0, 0, size, size, Math.round(size * 0.25))
        ctx.clip()
        ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, size, size)

        let blob = await canvasToBlob(canvas, 'image/png')
        let mime = 'image/png'
        let ext = 'png'
        if (!blob || blob.size > 490 * 1024) {
          const webp = await canvasToBlob(canvas, 'image/webp', 0.9)
          if (webp) {
            blob = webp
            mime = 'image/webp'
            ext = 'webp'
          }
        }
        if (!blob) throw new Error('Encode failed')
        onConfirm(new File([blob], `logo.${ext}`, { type: mime }))
      } else {
        const outW = Math.min(1600, Math.max(640, Math.round(sourceW)))
        const outH = Math.max(1, Math.round(outW / COVER_ASPECT))
        canvas.width = outW
        canvas.height = outH
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas unavailable')
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, outW, outH)

        let blob = await canvasToBlob(canvas, 'image/webp', 0.88)
        let mime = 'image/webp'
        let ext = 'webp'
        if (!blob) {
          blob = await canvasToBlob(canvas, 'image/jpeg', 0.88)
          mime = 'image/jpeg'
          ext = 'jpg'
        }
        if (!blob) throw new Error('Encode failed')
        onConfirm(new File([blob], `cover.${ext}`, { type: mime }))
      }
    } catch {
      setLoadFailed(true)
    } finally {
      setExporting(false)
    }
  }

  const busy = submitting || exporting

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose()
      }}
      title={kind === 'cover' ? t('blog.crop_cover_title') : t('blog.crop_logo_title')}
      description={t('blog.crop_hint')}
      width={kind === 'cover' ? 560 : 420}
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw size={12} />}
            disabled={busy || !natural || (zoom === 1 && clampedOffset.x === 0 && clampedOffset.y === 0)}
            onClick={resetTransform}
            className="mr-auto"
          >
            {t('blog.crop_reset')}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            icon={<Upload size={13} />}
            loading={busy}
            disabled={!natural || loadFailed}
            onClick={() => void confirmCrop()}
          >
            {t('blog.crop_confirm')}
          </Button>
        </>
      }
    >
      {loadFailed ? (
        <p role="alert" className="py-6 text-center text-[12.5px] text-[var(--danger)]">
          {t('blog.crop_load_failed')}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-center">
            <div
              ref={stageRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endPointerDrag}
              onPointerCancel={endPointerDrag}
              style={{ aspectRatio: String(aspect) }}
              className={cn(
                'relative select-none overflow-hidden border border-[var(--border-default)] bg-black/85 touch-none',
                kind === 'cover' ? 'w-full rounded-[var(--r-lg)]' : 'w-[220px] rounded-[55px]',
                dragging ? 'cursor-grabbing' : 'cursor-grab',
              )}
            >
              {previewUrl && bounds && (
                <img
                  src={previewUrl}
                  alt=""
                  draggable={false}
                  style={{
                    width: `${bounds.renderedWidth}px`,
                    height: `${bounds.renderedHeight}px`,
                    left: `${(viewportWidth - bounds.renderedWidth) / 2 + clampedOffset.x}px`,
                    top: `${(viewportHeight - bounds.renderedHeight) / 2 + clampedOffset.y}px`,
                  }}
                  className="pointer-events-none absolute max-w-none select-none"
                />
              )}

              {kind === 'cover' && (
                <>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/45 to-transparent" />
                  <div
                    className={cn(
                      'pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 transition-opacity duration-150',
                      dragging ? 'opacity-100' : 'opacity-0',
                    )}
                  >
                    {Array.from({ length: 9 }).map((_, index) => (
                      <span key={index} className="border border-white/20" />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 px-1">
            <span className="shrink-0 text-[12px] text-[var(--text-tertiary)]">
              {t('blog.crop_zoom')}
            </span>
            <button
              type="button"
              aria-label={t('common.zoom_out')}
              disabled={busy || !natural || zoom <= MIN_ZOOM}
              onClick={() => applyZoom(zoom - 0.15)}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
            >
              <ZoomOut size={14} />
            </button>
            <input
              type="range"
              aria-label={t('blog.crop_zoom')}
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.02}
              value={zoom}
              disabled={busy || !natural}
              onChange={(event) => applyZoom(Number(event.target.value))}
              className="h-1.5 flex-1 cursor-pointer accent-[var(--accent)]"
            />
            <button
              type="button"
              aria-label={t('common.zoom_in')}
              disabled={busy || !natural || zoom >= MAX_ZOOM}
              onClick={() => applyZoom(zoom + 0.15)}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--r-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
            >
              <ZoomIn size={14} />
            </button>
            <span className="w-11 shrink-0 text-right font-mono text-[11.5px] text-[var(--text-tertiary)]">
              {`${Math.round(zoom * 100)}%`}
            </span>
          </div>
        </div>
      )}
    </Modal>
  )
}
