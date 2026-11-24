import { Hono } from 'hono'
import { hasAttachmentStorage, readAttachmentObject } from '../attachments/backend'
import type { AppBindings } from '../env'
import { getBlogSettings, parseStoredBlogAssetUrl } from '../lib/blog-settings'
import { ApiError } from '../lib/errors'

export const blogAssetRoutes = new Hono<AppBindings>()

function toBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

blogAssetRoutes.get('/favicon/:storage/:file', async (c) => {
  const path = `/api/blog-assets/${c.req.param('storage')}/logo/${c.req.param('file')}`
  const location = parseStoredBlogAssetUrl(path)
  if (!location || location.kind !== 'logo') throw ApiError.notFound('Blog favicon not found')

  const settings = await getBlogSettings(c.env.DB)
  if (settings.logoUrl !== path) throw ApiError.notFound('Blog favicon not found')

  if (!hasAttachmentStorage(c.env, location.storage)) {
    throw new ApiError(
      503,
      'storage_unavailable',
      `${location.storage === 'r2' ? 'R2' : 'Workers KV'} storage is not bound`,
    )
  }

  const bytes = await readAttachmentObject(c.env, location.storage, location.key)
  if (!bytes) throw ApiError.notFound('Blog favicon data is missing')

  const contentType = location.extension === 'jpg' ? 'image/jpeg' : `image/${location.extension}`
  const dataUri = `data:${contentType};base64,${toBase64(bytes)}`
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    '<defs><clipPath id="r"><rect width="64" height="64" rx="16" ry="16"/></clipPath></defs>',
    `<image width="64" height="64" preserveAspectRatio="xMidYMid slice" clip-path="url(#r)" href="${dataUri}"/>`,
    '</svg>',
  ].join('')

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

blogAssetRoutes.get('/:storage/:kind/:file', async (c) => {
  const path = `/api/blog-assets/${c.req.param('storage')}/${c.req.param('kind')}/${c.req.param('file')}`
  const location = parseStoredBlogAssetUrl(path)
  if (!location) throw ApiError.notFound('Blog asset not found')

  const settings = await getBlogSettings(c.env.DB)
  const activeUrl = location.kind === 'cover' ? settings.coverUrl : settings.logoUrl
  if (activeUrl !== path) throw ApiError.notFound('Blog asset not found')

  if (!hasAttachmentStorage(c.env, location.storage)) {
    throw new ApiError(
      503,
      'storage_unavailable',
      `${location.storage === 'r2' ? 'R2' : 'Workers KV'} storage is not bound`,
    )
  }

  const bytes = await readAttachmentObject(c.env, location.storage, location.key)
  if (!bytes) throw ApiError.notFound('Blog asset data is missing')

  const contentType = location.extension === 'jpg' ? 'image/jpeg' : `image/${location.extension}`
  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
