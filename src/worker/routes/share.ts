import { Hono, type Context } from 'hono'
import { setCookie } from 'hono/cookie'
import { LIMITS } from '@shared/constants'
import {
  deriveMomentsPreview,
  extractMarkdownImages,
  rewriteShareImageUrl,
} from '@shared/markdown-utils'
import type {
  BlogSettings,
  PublicBlogPost,
  PublicBlogResponse,
  PublicBlogTag,
  PublicNote,
  ShareInfo,
  ShareListItem,
} from '@shared/types'
import type { AppBindings } from '../env'
import {
  BLOG_LIMITS,
  cleanupStoredBlogAsset,
  getBlogSettings,
  normalizeBlogAssetUrl,
  normalizeBlogText,
  parseStoredBlogAssetUrl,
  persistUploadedBlogAsset,
  saveBlogSettings,
  type BlogAssetKind,
} from '../lib/blog-settings'
import { ApiError } from '../lib/errors'
import { isValidSlug, newSlug } from '../lib/id'
import {
  FORM_BODY_LIMITS,
  JSON_BODY_LIMITS,
  readFormDataWithinLimit,
  readJson,
  readOptionalJson,
  requestClientIp,
} from '../lib/request'
import { hashPassword, verifyPassword } from '../lib/password'
import {
  createShareAssetSession,
  shareAssetCookieName,
} from '../lib/share-asset-session'
import {
  assertNotLocked,
  clearLoginFailures,
  consumeAttemptBudget,
  recordLoginFailure,
  ThrottleError,
} from '../lib/throttle'
import { requireAuth } from '../middleware/auth'


export const shareManageRoutes = new Hono<AppBindings>()

export const shareRoutes = new Hono<AppBindings>()

export const sharePageRoutes = new Hono<AppBindings>()

export const blogPageRoutes = new Hono<AppBindings>()

interface ShareRow {
  slug: string
  note_id: string
  user_id: string
  password_hash: string | null
  expires_at: number | null
  views: number
  listed: number
  created_at: number
}

function toShareInfo(row: ShareRow, origin: string): ShareInfo {
  return {
    slug: row.slug,
    noteId: row.note_id,
    url: `${origin}/s/${row.slug}`,
    hasPassword: Boolean(row.password_hash),
    expiresAt: row.expires_at,
    views: row.views,
    listed: Boolean(row.listed),
    createdAt: row.created_at,
  }
}


shareManageRoutes.use('*', requireAuth)

shareManageRoutes.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.slug, s.note_id, s.user_id, s.password_hash, s.expires_at, s.views, s.listed, s.created_at,
            n.title AS note_title, n.deleted_at
       FROM shares s JOIN notes n ON n.id = s.note_id AND n.user_id = s.user_id
      WHERE s.user_id = ?1
      ORDER BY s.created_at DESC, s.slug DESC`,
  ).bind(c.get('userId')).all<ShareRow & { note_title: string; deleted_at: number | null }>()
  const origin = new URL(c.req.url).origin
  const shares: ShareListItem[] = rows.results.map((row) => ({
    ...toShareInfo(row, origin),
    noteTitle: row.note_title,
    deletedAt: row.deleted_at,
  }))
  return c.json({ shares })
})

shareManageRoutes.get('/blog-settings', async (c) => {
  const settings = await getBlogSettings(c.env.DB)
  const canManage = c.get('user')?.role === 'owner'
  return c.json({ settings, canManage })
})

shareManageRoutes.put('/blog-settings', async (c) => {
  if (c.get('user')?.role !== 'owner') {
    throw ApiError.forbidden('Only the site owner can update blog appearance')
  }
  const userId = c.get('userId')
  const current = await getBlogSettings(c.env.DB)
  const body = await readJson<Partial<BlogSettings>>(c, JSON_BODY_LIMITS.small)

  const next: BlogSettings = {
    coverUrl: body.coverUrl !== undefined ? normalizeBlogAssetUrl(body.coverUrl) : current.coverUrl,
    logoUrl: body.logoUrl !== undefined ? normalizeBlogAssetUrl(body.logoUrl) : current.logoUrl,
    title:
      body.title !== undefined
        ? normalizeBlogText(body.title, BLOG_LIMITS.maxTitleLength, 'title')
        : current.title,
    bio:
      body.bio !== undefined
        ? normalizeBlogText(body.bio, BLOG_LIMITS.maxBioLength, 'bio')
        : current.bio,
  }

  await saveBlogSettings(c.env.DB, next)
  if (current.coverUrl && current.coverUrl !== next.coverUrl) {
    await cleanupStoredBlogAsset(c.env, userId, current.coverUrl)
  }
  if (current.logoUrl && current.logoUrl !== next.logoUrl) {
    await cleanupStoredBlogAsset(c.env, userId, current.logoUrl)
  }
  return c.json({ settings: next })
})

shareManageRoutes.post('/blog-settings/upload', async (c) => {
  if (c.get('user')?.role !== 'owner') {
    throw ApiError.forbidden('Only the site owner can upload blog images')
  }
  const userId = c.get('userId')
  const form = await readFormDataWithinLimit(c.req, FORM_BODY_LIMITS.attachment)
  const rawKind = form.get('kind')
  const kind: BlogAssetKind | null =
    rawKind === 'cover' || rawKind === 'logo' ? rawKind : null
  if (!kind) throw ApiError.badRequest('kind must be cover or logo')
  const file = form.get('file')
  if (!(file instanceof File)) throw ApiError.badRequest('file is required')

  const current = await getBlogSettings(c.env.DB)
  const uploaded = await persistUploadedBlogAsset(c.env, userId, kind, file)
  const next: BlogSettings = {
    ...current,
    ...(kind === 'cover' ? { coverUrl: uploaded.url } : { logoUrl: uploaded.url }),
  }
  try {
    await saveBlogSettings(c.env.DB, next)
  } catch (error) {
    await cleanupStoredBlogAsset(c.env, userId, uploaded.url)
    throw error
  }
  const previousUrl = kind === 'cover' ? current.coverUrl : current.logoUrl
  if (previousUrl && previousUrl !== uploaded.url) {
    await cleanupStoredBlogAsset(c.env, userId, previousUrl)
  }
  return c.json({ url: uploaded.url, settings: next })
})

shareManageRoutes.get('/:noteId', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT * FROM shares WHERE note_id = ?1 AND user_id = ?2`,
  )
    .bind(c.req.param('noteId'), c.get('userId'))
    .first<ShareRow>()
  if (!row) return c.json({ share: null })
  return c.json({ share: toShareInfo(row, new URL(c.req.url).origin) })
})

shareManageRoutes.post('/:noteId', async (c) => {
  const userId = c.get('userId')
  const noteId = c.req.param('noteId')
  const body = await readJson<{
    password?: string | null
    expiresIn?: number | null
    listed?: boolean
  }>(c, JSON_BODY_LIMITS.small)

  const note = await c.env.DB.prepare(
    `SELECT id FROM notes WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL`,
  )
    .bind(noteId, userId)
    .first<{ id: string }>()
  if (!note) throw ApiError.notFound('Note not found')

  const slug = newSlug()
  if (body.password !== undefined && body.password !== null && typeof body.password !== 'string') {
    throw ApiError.badRequest('password must be a string or null')
  }
  if (typeof body.password === 'string' && body.password.length > LIMITS.passwordMaxLength) {
    throw ApiError.badRequest(`The access password must not exceed ${LIMITS.passwordMaxLength} characters`)
  }
  if (typeof body.password === 'string' && body.password.length > 0 && body.password.length < 4) {
    throw ApiError.badRequest('The access password must be at least 4 characters')
  }
  if (
    body.expiresIn !== undefined &&
    body.expiresIn !== null &&
    (!Number.isFinite(body.expiresIn) || body.expiresIn < 0)
  ) {
    throw ApiError.badRequest('expiresIn must be a non-negative number or null')
  }
  if (body.listed !== undefined && typeof body.listed !== 'boolean') {
    throw ApiError.badRequest('listed must be a boolean')
  }
  const expiresAt =
    typeof body.expiresIn === 'number' && body.expiresIn > 0
        ? Date.now() + Math.min(body.expiresIn, 365 * 24 * 60 * 60 * 1000)
        : null

  const replacePassword = body.password === null || typeof body.password === 'string'
  const passwordHash =
    body.password === null
      ? null
      : typeof body.password === 'string' && body.password
        ? await hashPassword(body.password)
        : null
  const listedProvided = body.listed !== undefined ? 1 : 0
  const listedValue = body.listed === true ? 1 : 0

  const written = await c.env.DB.prepare(
    `INSERT INTO shares (slug, note_id, user_id, password_hash, expires_at, views, listed, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)
     ON CONFLICT(note_id) DO UPDATE SET
       password_hash = CASE WHEN ?8 = 1 THEN excluded.password_hash ELSE shares.password_hash END,
       expires_at = CASE WHEN ?9 = 1 THEN excluded.expires_at ELSE shares.expires_at END,
       listed = CASE
         WHEN ?10 = 1 THEN excluded.listed
         ELSE shares.listed
       END
     WHERE shares.user_id = excluded.user_id`,
  )
    .bind(
      slug,
      noteId,
      userId,
      passwordHash,
      expiresAt,
      listedValue,
      Date.now(),
      replacePassword ? 1 : 0,
      body.expiresIn !== undefined ? 1 : 0,
      listedProvided,
    )
    .run()
  if (!written.meta.changes) throw new ApiError(409, 'conflict', 'Share state changed. Refresh and try again')

  const row = await c.env.DB.prepare(`SELECT * FROM shares WHERE note_id = ?1 AND user_id = ?2`)
    .bind(noteId, userId)
    .first<ShareRow>()
  return c.json({ share: toShareInfo(row!, new URL(c.req.url).origin) })
})

shareManageRoutes.delete('/:noteId', async (c) => {
  const noteId = c.req.param('noteId')
  const userId = c.get('userId')
  await c.env.DB.prepare(`DELETE FROM shares WHERE note_id = ?1 AND user_id = ?2`)
    .bind(noteId, userId)
    .run()
  return c.json({ ok: true })
})


const BLOG_DEFAULT_LIMIT = 20
const BLOG_MAX_LIMIT = 50
const BLOG_MAX_IMAGES = 9

function parseBlogCursor(value: string | undefined): { pinned: number; createdAt: number; slug: string } | null {
  if (!value) return null
  const match = /^([01])\.(\d{1,16})\.([A-Za-z0-9_-]{1,64})$/.exec(value)
  if (!match) throw ApiError.badRequest('Invalid blog cursor')
  const pinned = Number(match[1])
  const createdAt = Number(match[2])
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    throw ApiError.badRequest('Invalid blog cursor')
  }
  return { pinned, createdAt, slug: match[3]! }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

interface BlogFeedRow {
  slug: string
  note_id: string
  is_locked: number
  views: number
  likes: number
  share_created_at: number
  title: string
  content: string
  word_count: number
  is_pinned: number
  note_created_at: number
  note_updated_at: number
  author_name: string
  author_avatar_url: string
}

shareRoutes.get('/blog', async (c) => {
  const now = Date.now()
  const siteName = c.env.APP_NAME || 'Inkstone'
  const blogSettings = await getBlogSettings(c.env.DB)
  const rawTag = c.req.query('tag')?.trim()
  const tagFilter = rawTag ? rawTag.slice(0, LIMITS.tagNameMaxLength) : ''
  const rawQuery = c.req.query('q')?.trim()
  const searchQuery = rawQuery ? rawQuery.slice(0, 120) : ''
  const cursor = parseBlogCursor(c.req.query('cursor'))
  const parsedLimit = Number(c.req.query('limit'))
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(BLOG_MAX_LIMIT, Math.floor(parsedLimit))
    : BLOG_DEFAULT_LIMIT

  const conditions: string[] = [
    `s.listed = 1`,
    `(s.expires_at IS NULL OR s.expires_at > ?1)`,
    `n.deleted_at IS NULL`,
  ]
  const bindings: unknown[] = [now]

  if (tagFilter) {
    bindings.push(tagFilter)
    conditions.push(
      `EXISTS (
        SELECT 1 FROM note_tags nt
        JOIN tags t ON t.id = nt.tag_id
        WHERE nt.note_id = n.id AND t.name = ?${bindings.length} COLLATE NOCASE
      )`,
    )
  }

  if (searchQuery) {
    const pattern = `%${escapeLikePattern(searchQuery)}%`
    bindings.push(pattern)
    const idx = bindings.length
    conditions.push(
      `(n.title LIKE ?${idx} ESCAPE '\\' OR (s.password_hash IS NULL AND n.content LIKE ?${idx} ESCAPE '\\'))`,
    )
  }

  if (cursor) {
    bindings.push(cursor.pinned, cursor.createdAt, cursor.slug)
    const pIdx = bindings.length - 2
    const tIdx = bindings.length - 1
    const sIdx = bindings.length
    conditions.push(
      `(n.is_pinned < ?${pIdx} OR (n.is_pinned = ?${pIdx} AND (s.created_at < ?${tIdx} OR (s.created_at = ?${tIdx} AND s.slug < ?${sIdx}))))`,
    )
  }

  bindings.push(limit + 1)
  const limitIdx = bindings.length

  const [countRow, ownerRow, tagRows, postRows] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM shares s
         JOIN notes n ON n.id = s.note_id AND n.user_id = s.user_id
        WHERE s.listed = 1
          AND (s.expires_at IS NULL OR s.expires_at > ?1)
          AND n.deleted_at IS NULL`,
    ).bind(now),
    c.env.DB.prepare(
      `SELECT name, avatar_url FROM users WHERE role = 'owner' ORDER BY created_at ASC LIMIT 1`,
    ),
    c.env.DB.prepare(
      `SELECT t.name, COUNT(DISTINCT s.note_id) AS count
         FROM shares s
         JOIN notes n ON n.id = s.note_id AND n.user_id = s.user_id
         JOIN note_tags nt ON nt.note_id = n.id
         JOIN tags t ON t.id = nt.tag_id
        WHERE s.listed = 1
          AND (s.expires_at IS NULL OR s.expires_at > ?1)
          AND n.deleted_at IS NULL
        GROUP BY t.name
        ORDER BY count DESC, t.name COLLATE NOCASE ASC
        LIMIT 40`,
    ).bind(now),
    c.env.DB.prepare(
      `SELECT s.slug, s.note_id,
              CASE WHEN s.password_hash IS NOT NULL THEN 1 ELSE 0 END AS is_locked,
              s.views, s.likes, s.created_at AS share_created_at,
              n.title, n.content, n.word_count, n.is_pinned,
              n.created_at AS note_created_at, n.updated_at AS note_updated_at,
              u.name AS author_name, u.avatar_url AS author_avatar_url
         FROM shares s
         JOIN notes n ON n.id = s.note_id AND n.user_id = s.user_id
         JOIN users u ON u.id = s.user_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY n.is_pinned DESC, s.created_at DESC, s.slug DESC
        LIMIT ?${limitIdx}`,
    ).bind(...bindings),
  ])

  const totalPosts = Number((countRow as D1Result<{ total: number }>).results[0]?.total ?? 0)
  const owner = (ownerRow as D1Result<{ name: string; avatar_url: string }>).results[0]
  const tags: PublicBlogTag[] = (tagRows as D1Result<{ name: string; count: number }>).results.map((row) => ({
    name: row.name,
    count: Number(row.count),
  }))

  const fetched = (postRows as D1Result<BlogFeedRow>).results
  const hasMore = fetched.length > limit
  const page = fetched.slice(0, limit)

  const tagsByNote = new Map<string, string[]>()
  if (page.length > 0) {
    const placeholders = page.map((_, index) => `?${index + 1}`).join(', ')
    const noteTagRows = await c.env.DB.prepare(
      `SELECT nt.note_id, t.name
         FROM note_tags nt
         JOIN tags t ON t.id = nt.tag_id
        WHERE nt.note_id IN (${placeholders})
        ORDER BY t.name COLLATE NOCASE ASC`,
    )
      .bind(...page.map((row) => row.note_id))
      .all<{ note_id: string; name: string }>()
    for (const row of noteTagRows.results) {
      const list = tagsByNote.get(row.note_id)
      if (list) list.push(row.name)
      else tagsByNote.set(row.note_id, [row.name])
    }
  }

  const posts: PublicBlogPost[] = page.map((row) => {
    const locked = Boolean(row.is_locked)
    const allImages = extractMarkdownImages(row.content)
    const images = locked
      ? []
      : allImages.slice(0, BLOG_MAX_IMAGES).map((image) => ({
          src: rewriteShareImageUrl(image.src, row.slug),
          alt: image.alt,
        }))
    const preview = locked ? null : deriveMomentsPreview(row.content, row.title)
    return {
      slug: row.slug,
      title: row.title,
      locked,
      previewText: preview ? preview.text : '',
      hasMoreContent: locked ? true : Boolean(preview?.truncated || preview?.hasRichBlocks),
      images,
      imageCount: allImages.length,
      tags: tagsByNote.get(row.note_id) ?? [],
      wordCount: row.word_count,
      isPinned: Boolean(row.is_pinned),
      views: row.views,
      likes: Number(row.likes ?? 0),
      publishedAt: row.share_created_at,
      updatedAt: row.note_updated_at,
      createdAt: row.note_created_at,
      author: {
        name: row.author_name,
        avatarUrl: row.author_avatar_url,
      },
    }
  })

  const last = page[page.length - 1]
  const nextCursor = hasMore && last
    ? `${last.is_pinned ? 1 : 0}.${last.share_created_at}.${last.slug}`
    : null

  const fallbackAuthor = page[0]
  const payload: PublicBlogResponse = {
    profile: {
      name: owner?.name || fallbackAuthor?.author_name || siteName,
      avatarUrl: owner?.avatar_url || fallbackAuthor?.author_avatar_url || '',
      siteName,
      blogTitle: blogSettings.title,
      bio: blogSettings.bio,
      coverUrl: blogSettings.coverUrl,
      logoUrl: blogSettings.logoUrl,
      totalPosts,
    },
    tags,
    posts,
    nextCursor,
  }
  return c.json(payload)
})

shareRoutes.post('/blog/:slug/like', async (c) => {
  const slug = c.req.param('slug')
  if (!isValidSlug(slug)) throw ApiError.notFound('Moment not found')
  const body = await readOptionalJson<{ action?: string }>(c, JSON_BODY_LIMITS.small, {})
  const delta = body.action === 'unlike' ? -1 : 1
  const now = Date.now()

  try {
    await consumeAttemptBudget(c.env.DB, [
      {
        key: `blog-like:ip:${requestClientIp(c)}`,
        maxAttempts: 40,
        windowMs: 10 * 60 * 1000,
      },
      {
        key: `blog-like:slug:${slug}`,
        maxAttempts: 200,
        windowMs: 10 * 60 * 1000,
      },
    ])
  } catch (err) {
    if (err instanceof ThrottleError) {
      throw new ApiError(429, 'too_many_attempts', `Too many attempts. Try again in ${err.retryAfterSec} seconds`, {
        retryAfter: err.retryAfterSec,
      })
    }
    throw err
  }

  const updated = await c.env.DB.prepare(
    `UPDATE shares
        SET likes = MAX(0, likes + ?1)
      WHERE slug = ?2
        AND listed = 1
        AND (expires_at IS NULL OR expires_at > ?3)
        AND EXISTS (
          SELECT 1 FROM notes n
           WHERE n.id = shares.note_id AND n.user_id = shares.user_id AND n.deleted_at IS NULL
        )`,
  )
    .bind(delta, slug, now)
    .run()
  if (!updated.meta.changes) throw ApiError.notFound('Moment not found')

  const row = await c.env.DB.prepare(`SELECT likes FROM shares WHERE slug = ?1`)
    .bind(slug)
    .first<{ likes: number }>()
  return c.json({ slug, likes: Number(row?.likes ?? 0) })
})


shareRoutes.post('/:slug', async (c) => {
  const slug = c.req.param('slug')
  if (!isValidSlug(slug)) throw ApiError.notFound('The link does not exist or has been revoked')
  const body = await readOptionalJson<{ password?: string }>(c, JSON_BODY_LIMITS.small, {})
  const password = typeof body.password === 'string'
    ? body.password.slice(0, LIMITS.passwordMaxLength)
    : ''

  const share = await c.env.DB.prepare(`SELECT * FROM shares WHERE slug = ?1`)
    .bind(slug)
    .first<ShareRow>()
  if (!share) throw ApiError.notFound('The link does not exist or has been revoked')
  if (share.expires_at && share.expires_at < Date.now()) throw ApiError.notFound('The link has expired')

  const blogSettings = await getBlogSettings(c.env.DB)
  const siteName = c.env.APP_NAME || 'Inkstone'

  if (share.password_hash) {
    if (!password) {
      return c.json(
        {
          error: {
            code: 'password_required',
            message: 'An access password is required',
            details: {
              siteName,
              logoUrl: blogSettings.logoUrl || undefined,
              blogTitle: blogSettings.title || undefined,
            },
          },
        },
        401,
      )
    }
    const clientIp = requestClientIp(c)
    const throttleKeys = [
      { key: `share:${slug}:ip:${clientIp}`, freeFails: 5 },
      { key: `share-ip:${clientIp}`, freeFails: 12 },
      { key: `share-slug:${slug}`, freeFails: 30 },
    ]
    const workKeys = [
      {
        key: `share-work:${slug}:ip:${clientIp}`,
        maxAttempts: 8,
        windowMs: 10 * 60 * 1000,
        lockMs: 5 * 60 * 1000,
      },
      {
        key: `share-work-ip:${clientIp}`,
        maxAttempts: 20,
        windowMs: 10 * 60 * 1000,
        lockMs: 5 * 60 * 1000,
      },
      {
        key: `share-work-slug:${slug}`,
        maxAttempts: 60,
        windowMs: 10 * 60 * 1000,
        lockMs: 2 * 60 * 1000,
      },
    ]
    try {
      await consumeAttemptBudget(c.env.DB, workKeys)
      await assertNotLocked(c.env.DB, throttleKeys)
    } catch (err) {
      if (err instanceof ThrottleError) {
        throw new ApiError(429, 'too_many_attempts', `Too many attempts. Try again in ${err.retryAfterSec} seconds`, {
          retryAfter: err.retryAfterSec,
        })
      }
      throw err
    }
    if (!(await verifyPassword(password, share.password_hash))) {
      await recordLoginFailure(c.env.DB, throttleKeys)
      return c.json({ error: { code: 'password_invalid', message: "Incorrect passcode" } }, 401)
    }
    await clearLoginFailures(c.env.DB, [
      `share:${slug}:ip:${clientIp}`,
      `share-ip:${clientIp}`,
      `share-work:${slug}:ip:${clientIp}`,
      `share-work-ip:${clientIp}`,
    ])
  }

  const note = await c.env.DB.prepare(
    `SELECT n.title, n.content, n.created_at, n.updated_at, u.name, u.avatar_url
       FROM notes n JOIN users u ON u.id = n.user_id
      WHERE n.id = ?1 AND n.user_id = ?2 AND n.deleted_at IS NULL`,
  )
    .bind(share.note_id, share.user_id)
    .first<{
      title: string
      content: string
      created_at: number
      updated_at: number
      name: string
      avatar_url: string
    }>()
  if (!note) throw ApiError.notFound('The note has been deleted')

  c.executionCtx?.waitUntil(
    c.env.DB.prepare(`UPDATE shares SET views = views + 1 WHERE slug = ?1`).bind(slug).run().catch(() => {}),
  )

  if (share.password_hash) {
    const expiresAt = Math.min(
      share.expires_at ?? Number.MAX_SAFE_INTEGER,
      Date.now() + 12 * 60 * 60 * 1000,
    )
    const token = await createShareAssetSession(c.env.DB, slug, share.password_hash, expiresAt)
    setCookie(c, shareAssetCookieName(slug), token, {
      path: '/api/files/',
      httpOnly: true,
      sameSite: 'Strict',
      maxAge: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)),
      secure: new URL(c.req.url).protocol === 'https:',
    })
  }

  const body_: PublicNote = {
    title: note.title,
    content: note.content,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
    author: { name: note.name, avatarUrl: note.avatar_url },
    site: { name: siteName, logoUrl: blogSettings.logoUrl || undefined },
    share: { slug },
  }
  return c.json(body_)
})


sharePageRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  const url = new URL(c.req.url)

  if (!isValidSlug(slug)) {
    return renderShareShell(c, url, null)
  }

  const row = await c.env.DB.prepare(
    `SELECT s.password_hash, s.expires_at, s.listed, n.title, n.excerpt
       FROM shares s JOIN notes n ON n.id = s.note_id AND n.user_id = s.user_id
      WHERE s.slug = ?1 AND n.deleted_at IS NULL`,
  )
    .bind(slug)
    .first<{
      password_hash: string | null
      expires_at: number | null
      listed: number
      title: string
      excerpt: string
    }>()

  return renderShareShell(c, url, row)
})

blogPageRoutes.get('/', async (c) => renderBlogShell(c, new URL(c.req.url)))
blogPageRoutes.get('/*', async (c) => renderBlogShell(c, new URL(c.req.url)))

function applyCustomFavicon(html: string, logoUrl: string): string {
  if (!logoUrl) return html
  const storedLogo = parseStoredBlogAssetUrl(logoUrl)
  const faviconHref =
    storedLogo && storedLogo.kind === 'logo'
      ? `/api/blog-assets/favicon/${storedLogo.storage}/${logoUrl.trim().split('/').pop()!}`
      : logoUrl
  const iconTag =
    storedLogo && storedLogo.kind === 'logo'
      ? `<link rel="icon" type="image/svg+xml" href="${escapeHtml(faviconHref)}" />`
      : `<link rel="icon" href="${escapeHtml(faviconHref)}" />`
  let next = html
  if (/<link\b[^>]*rel=["']icon["'][^>]*>/i.test(next)) {
    next = next.replace(/<link\b[^>]*rel=["']icon["'][^>]*>/i, iconTag)
  } else {
    next = next.replace('</head>', `    ${iconTag}\n  </head>`)
  }
  if (/<link\b[^>]*rel=["']apple-touch-icon["'][^>]*>/i.test(next)) {
    next = next.replace(
      /<link\b[^>]*rel=["']apple-touch-icon["'][^>]*>/i,
      `<link rel="apple-touch-icon" href="${escapeHtml(logoUrl)}" />`,
    )
  }
  return next
}

export async function renderNotebookShell(c: Context<AppBindings>, url: URL) {
  const shell = await c.env.ASSETS.fetch(new Request(new URL('/index.html', url.origin)))
  if (!shell.ok) return shell
  let html = await shell.text()

  const rawSiteName = c.env.APP_NAME || ''
  const blogSettings = await getBlogSettings(c.env.DB)
  const displayName =
    rawSiteName && rawSiteName !== 'Inkstone'
      ? rawSiteName
      : blogSettings.title || rawSiteName || 'Inkstone'

  html = applyCustomFavicon(html, blogSettings.logoUrl)
  const titleTag = `<title>${escapeHtml(displayName)}</title>`
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, titleTag)
  } else {
    html = html.replace('</head>', `    ${titleTag}\n  </head>`)
  }
  html = html.replace('</head>', `    <meta name="robots" content="noindex, nofollow" />\n  </head>`)

  return c.html(html, 200, {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
  })
}

export async function renderBlogShell(c: Context<AppBindings>, url: URL) {
  const shell = await c.env.ASSETS.fetch(new Request(new URL('/index.html', url.origin)))
  if (!shell.ok) return shell
  let html = await shell.text()

  const siteName = c.env.APP_NAME || 'Inkstone'
  const [owner, blogSettings] = await Promise.all([
    c.env.DB.prepare(
      `SELECT name FROM users WHERE role = 'owner' ORDER BY created_at ASC LIMIT 1`,
    ).first<{ name: string }>(),
    getBlogSettings(c.env.DB),
  ])
  const titleHead = blogSettings.title || owner?.name || siteName
  const displayName = titleHead === siteName ? siteName : `${titleHead} · ${siteName}`
  const coverOg = blogSettings.coverUrl
    ? blogSettings.coverUrl.startsWith('/')
      ? `${url.origin}${blogSettings.coverUrl}`
      : blogSettings.coverUrl
    : ''
  const meta = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(displayName)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(siteName)}" />`,
    blogSettings.bio ? `<meta property="og:description" content="${escapeHtml(blogSettings.bio)}" />` : '',
    coverOg ? `<meta property="og:image" content="${escapeHtml(coverOg)}" />` : '',
    `<meta name="twitter:card" content="${coverOg ? 'summary_large_image' : 'summary'}" />`,
  ]
    .filter(Boolean)
    .join('\n    ')

  html = applyCustomFavicon(html, blogSettings.logoUrl)
  const titleTag = `<title>${escapeHtml(displayName)}</title>`
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, titleTag)
  } else {
    html = html.replace('</head>', `    ${titleTag}\n  </head>`)
  }
  if (blogSettings.bio && /<meta\b[^>]*name=["']description["'][^>]*>/i.test(html)) {
    html = html.replace(
      /<meta\b[^>]*name=["']description["'][^>]*>/i,
      `<meta name="description" content="${escapeHtml(blogSettings.bio)}" />`,
    )
  }
  html = html.replace('</head>', `    ${meta}\n  </head>`)

  return c.html(html, 200, {
    'Cache-Control': 'no-store',
  })
}

async function renderShareShell(
  c: Context<AppBindings>,
  url: URL,
  row: {
    password_hash: string | null
    expires_at: number | null
    listed: number
    title: string
    excerpt: string
  } | null,
) {
  const shell = await c.env.ASSETS.fetch(new Request(new URL('/index.html', url.origin)))
  if (!shell.ok) return shell
  let html = await shell.text()

  const siteName = c.env.APP_NAME || 'Inkstone'
  const blogSettings = await getBlogSettings(c.env.DB)
  const expired = row?.expires_at ? row.expires_at < Date.now() : false
  const publicVisible = Boolean(row && !expired && !row.password_hash)
  const passwordProtected = Boolean(row && !expired && row.password_hash)
  const indexable = Boolean(publicVisible && row?.listed)
  const title = publicVisible && row ? publicShareTitle(row.title) : passwordProtected ? siteName : "Content unavailable"
  const fullTitle = title === siteName ? siteName : `${title} · ${siteName}`
  const description = publicVisible && row ? row.excerpt : ''

  const meta = [
    `<meta property="og:type" content="article" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(siteName)}" />`,
    description ? `<meta property="og:description" content="${escapeHtml(description)}" />` : '',
    `<meta name="twitter:card" content="summary" />`,
    indexable ? '' : `<meta name="robots" content="noindex, nofollow" />`,
  ]
    .filter(Boolean)
    .join('\n    ')

  html = applyCustomFavicon(html, blogSettings.logoUrl)
  const titleTag = `<title>${escapeHtml(fullTitle)}</title>`
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, titleTag)
  } else {
    html = html.replace('</head>', `    ${titleTag}\n  </head>`)
  }
  html = html.replace('</head>', `    ${meta}\n  </head>`)

  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
  }
  if (!indexable) headers['X-Robots-Tag'] = 'noindex'

  return c.html(html, 200, headers)
}

export function publicShareTitle(title: string): string {
  return title || 'Untitled note'
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
