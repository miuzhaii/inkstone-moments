import type { BlogSettings } from '@shared/types'
import {
  deleteAttachmentObjects,
  putAttachmentObject,
  selectAttachmentStorage,
} from '../attachments/backend'
import { attachmentCleanupTarget, type AttachmentObjectStorage } from '../attachments/keys'
import { getMeta, setMeta } from '../db/metadata'
import type { Env } from '../env'
import { sha256Hex } from './encoding'
import { ApiError } from './errors'
import { newId } from './id'
import { hasExpectedImageSignature, hasReasonableImageDimensions, readImageSize } from './image'

const KEY_BLOG_SETTINGS = 'setting:blog_appearance'
const MAX_URL_LENGTH = 512
const MAX_TITLE_LENGTH = 40
const MAX_BIO_LENGTH = 120
const COVER_MAX_BYTES = 5 * 1024 * 1024
const LOGO_MAX_BYTES = 512 * 1024

export const DEFAULT_BLOG_SETTINGS: BlogSettings = {
  coverUrl: '',
  logoUrl: '',
  title: '',
  bio: '',
}

export type BlogAssetKind = 'cover' | 'logo'

export interface ParsedBlogAssetUrl {
  storage: AttachmentObjectStorage
  kind: BlogAssetKind
  key: string
  extension: 'png' | 'jpg' | 'webp'
}

const STORED_BLOG_ASSET_RE =
  /^\/api\/blog-assets\/(r2|kv)\/(cover|logo)\/([0-9a-hjkmnp-tv-z]{26})\.(png|jpg|webp)$/i

export function parseStoredBlogAssetUrl(value: string): ParsedBlogAssetUrl | null {
  const match = STORED_BLOG_ASSET_RE.exec(value.trim())
  if (!match) return null
  const storage = match[1]!.toLowerCase() as AttachmentObjectStorage
  const kind = match[2]!.toLowerCase() as BlogAssetKind
  const id = match[3]!.toLowerCase()
  const extension = match[4]!.toLowerCase() as 'png' | 'jpg' | 'webp'
  return {
    storage,
    kind,
    key: `blog/${kind}/${id}.${extension}`,
    extension,
  }
}

export function normalizeBlogAssetUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw ApiError.badRequest('Image URL must be a string')
  }
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length > MAX_URL_LENGTH) {
    throw ApiError.badRequest(`Image URL must not exceed ${MAX_URL_LENGTH} characters`)
  }
  if (parseStoredBlogAssetUrl(trimmed)) return trimmed
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'https:') return trimmed
  } catch {
  }
  throw ApiError.badRequest('Use an uploaded image or an https:// image URL')
}

export function normalizeBlogText(value: unknown, maxLength: number, fieldName: string): string {
  if (typeof value !== 'string') {
    throw ApiError.badRequest(`${fieldName} must be a string`)
  }
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length > maxLength) {
    throw ApiError.badRequest(`${fieldName} must not exceed ${maxLength} characters`)
  }
  return trimmed
}

export async function getBlogSettings(db: D1Database): Promise<BlogSettings> {
  const raw = await getMeta(db, KEY_BLOG_SETTINGS)
  if (!raw) return { ...DEFAULT_BLOG_SETTINGS }
  try {
    const parsed = JSON.parse(raw) as Partial<BlogSettings>
    return {
      coverUrl: typeof parsed.coverUrl === 'string' ? parsed.coverUrl : '',
      logoUrl: typeof parsed.logoUrl === 'string' ? parsed.logoUrl : '',
      title: typeof parsed.title === 'string' ? parsed.title : '',
      bio: typeof parsed.bio === 'string' ? parsed.bio : '',
    }
  } catch {
    return { ...DEFAULT_BLOG_SETTINGS }
  }
}

export async function saveBlogSettings(db: D1Database, settings: BlogSettings): Promise<BlogSettings> {
  await setMeta(db, KEY_BLOG_SETTINGS, JSON.stringify(settings))
  return settings
}

export async function cleanupStoredBlogAsset(env: Env, userId: string, url: string): Promise<void> {
  const parsed = parseStoredBlogAssetUrl(url)
  if (!parsed) return
  try {
    await deleteAttachmentObjects(env, parsed.storage, [parsed.key])
  } catch (error) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO attachment_cleanup (object_key, user_id, created_at)
       VALUES (?1, ?2, ?3)`,
    )
      .bind(attachmentCleanupTarget(parsed.storage, parsed.key), userId, Date.now())
      .run()
      .catch(() => {})
    console.warn('[inkstone] Blog asset cleanup will retry later:', error)
  }
}

export async function persistUploadedBlogAsset(
  env: Env,
  userId: string,
  kind: BlogAssetKind,
  file: File,
): Promise<{ url: string; storage: AttachmentObjectStorage; key: string }> {
  const maxBytes = kind === 'logo' ? LOGO_MAX_BYTES : COVER_MAX_BYTES
  if (file.size <= 0) throw ApiError.badRequest('The uploaded file is empty')
  if (file.size > maxBytes) {
    const limitLabel = kind === 'logo' ? '512 KB' : '5 MB'
    throw new ApiError(413, 'payload_too_large', `Image must not exceed ${limitLabel}`)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!bytes.byteLength || bytes.byteLength > maxBytes) {
    throw new ApiError(413, 'payload_too_large', 'Image exceeds the maximum allowed size')
  }

  const detected = detectSupportedImage(bytes)
  if (!detected) {
    throw ApiError.badRequest('Upload a valid PNG, JPEG, or WebP image')
  }
  const dimensions = readImageSize(bytes, detected.mime)
  if (!dimensions || !hasReasonableImageDimensions(dimensions)) {
    throw ApiError.badRequest('The uploaded image has invalid dimensions')
  }

  const storage = selectAttachmentStorage(env)
  if (!storage) {
    throw new ApiError(
      503,
      'storage_unavailable',
      'Image storage is not configured. Bind R2 or Workers KV before uploading an image.',
    )
  }

  const objectId = newId()
  const key = `blog/${kind}/${objectId}.${detected.extension}`
  const sha256 = await sha256Hex(bytes)
  await putAttachmentObject(env, storage, key, bytes, {
    userId,
    objectId,
    kind: `blog-${kind}`,
    filename: `${kind}.${detected.extension}`,
    mime: detected.mime,
    sha256,
  })
  return {
    url: `/api/blog-assets/${storage}/${kind}/${objectId}.${detected.extension}`,
    storage,
    key,
  }
}

function detectSupportedImage(
  bytes: Uint8Array,
): { mime: 'image/png' | 'image/jpeg' | 'image/webp'; extension: 'png' | 'jpg' | 'webp' } | null {
  if (hasExpectedImageSignature(bytes, 'image/png')) {
    return { mime: 'image/png', extension: 'png' }
  }
  if (hasExpectedImageSignature(bytes, 'image/jpeg')) {
    return { mime: 'image/jpeg', extension: 'jpg' }
  }
  if (hasExpectedImageSignature(bytes, 'image/webp')) {
    return { mime: 'image/webp', extension: 'webp' }
  }
  return null
}

export const BLOG_LIMITS = {
  maxTitleLength: MAX_TITLE_LENGTH,
  maxBioLength: MAX_BIO_LENGTH,
  maxUrlLength: MAX_URL_LENGTH,
  coverMaxBytes: COVER_MAX_BYTES,
  logoMaxBytes: LOGO_MAX_BYTES,
} as const
