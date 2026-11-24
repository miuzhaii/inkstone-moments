const DEFAULT_FAVICON_HREF =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='3' y='3' width='26' height='26' rx='8' fill='%231C1917'/%3E%3Cpath d='M16 8.5c2.6 3.4 5.2 6.1 5.2 9a5.2 5.2 0 1 1-10.4 0c0-2.9 2.6-5.6 5.2-9z' fill='%23E06A4F'/%3E%3C/svg%3E"

const DEFAULT_APPLE_TOUCH_ICON = '/apple-touch-icon.png'

const STORED_LOGO_RE =
  /^\/api\/blog-assets\/(r2|kv)\/logo\/([0-9a-hjkmnp-tv-z]{26}\.(?:png|jpg|webp))$/i

const roundedFaviconCache = new Map<string, string>()
let activeFaviconSource = ''

export function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

export function storedLogoFaviconUrl(logoUrl: string): string {
  const match = STORED_LOGO_RE.exec(logoUrl.trim())
  if (!match) return logoUrl.trim()
  return `/api/blog-assets/favicon/${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}`
}

export function resolveSiteBrandName(siteName?: string | null, blogTitle?: string | null): string {
  const cleanSite = siteName?.trim() || ''
  const cleanBlog = blogTitle?.trim() || ''
  if (cleanSite && cleanSite !== 'Inkstone') return cleanSite
  if (cleanBlog) return cleanBlog
  return cleanSite || 'Inkstone'
}

function setIconLinkHref(href: string, mimeType?: string): void {
  let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]')
  if (!icon) {
    icon = document.createElement('link')
    icon.rel = 'icon'
    document.head.appendChild(icon)
  }
  if (mimeType) icon.type = mimeType
  else icon.removeAttribute('type')
  if (icon.getAttribute('href') !== href) {
    icon.setAttribute('href', href)
  }
}

function renderRoundedFaviconDataUrl(src: string): Promise<string | null> {
  const cached = roundedFaviconCache.get(src)
  if (cached) return Promise.resolve(cached)
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    if (/^https?:\/\//i.test(src)) {
      try {
        if (new URL(src, window.location.href).origin !== window.location.origin) {
          img.crossOrigin = 'anonymous'
        }
      } catch {
      }
    }
    img.onload = () => {
      try {
        const size = 64
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx || !img.naturalWidth || !img.naturalHeight) {
          resolve(null)
          return
        }
        ctx.clearRect(0, 0, size, size)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        traceRoundedRect(ctx, 0, 0, size, size, 16)
        ctx.clip()
        const side = Math.min(img.naturalWidth, img.naturalHeight)
        const sx = (img.naturalWidth - side) / 2
        const sy = (img.naturalHeight - side) / 2
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
        const dataUrl = canvas.toDataURL('image/png')
        if (roundedFaviconCache.size > 24) roundedFaviconCache.clear()
        roundedFaviconCache.set(src, dataUrl)
        resolve(dataUrl)
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

export function applyDocumentBranding(options: {
  title?: string | null
  logoUrl?: string | null
}): void {
  if (typeof document === 'undefined') return
  if (typeof options.title === 'string' && options.title.trim()) {
    document.title = options.title.trim()
  }
  if (options.logoUrl !== undefined) {
    const customLogo = options.logoUrl?.trim() || ''
    activeFaviconSource = customLogo
    if (!customLogo) {
      setIconLinkHref(DEFAULT_FAVICON_HREF)
      const appleIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
      if (appleIcon && appleIcon.getAttribute('href') !== DEFAULT_APPLE_TOUCH_ICON) {
        appleIcon.setAttribute('href', DEFAULT_APPLE_TOUCH_ICON)
      }
      return
    }

    const immediateHref = storedLogoFaviconUrl(customLogo)
    setIconLinkHref(
      immediateHref,
      immediateHref.startsWith('/api/blog-assets/favicon/') ? 'image/svg+xml' : undefined,
    )
    const appleIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
    if (appleIcon && appleIcon.getAttribute('href') !== customLogo) {
      appleIcon.setAttribute('href', customLogo)
    }

    void renderRoundedFaviconDataUrl(customLogo).then((roundedPng) => {
      if (!roundedPng || activeFaviconSource !== customLogo) return
      setIconLinkHref(roundedPng, 'image/png')
      if (appleIcon && appleIcon.getAttribute('href') !== roundedPng) {
        appleIcon.setAttribute('href', roundedPng)
      }
    })
  }
}
