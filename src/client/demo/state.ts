import { LIMITS, mergeSettings } from '@shared/constants'
import { ZH_CN_MESSAGES } from '@shared/locales/zh-CN'
import { countText, deriveExcerpt, deriveTitle, extractTags, sortTagNames } from '@shared/markdown-utils'
import { truncateText } from '@shared/text-utils'
import { welcomeNoteTemplates } from '@shared/welcome-notes'
import type {
  Attachment,
  BackupRun,
  BackupTarget,
  BlogSettings,
  Folder,
  Note,
  NoteSummary,
  NoteVersion,
  PublicUser,
  ShareInfo,
  Tag,
  UserSettings,
} from '@shared/types'

export interface DemoAttachment {
  meta: Attachment
  file: File
}

export interface DemoShare {
  info: ShareInfo
  password: string | null
  likes: number
}

export interface DemoState {
  authenticated: boolean
  password: string
  registrationOpen: boolean
  cursor: number
  user: PublicUser
  settings: UserSettings
  blogSettings: BlogSettings
  notes: Map<string, Note>
  folders: Map<string, Folder>
  tagIds: Map<string, string>
  tagColors: Map<string, string | null>
  versions: Map<string, NoteVersion[]>
  attachments: Map<string, DemoAttachment>
  shares: Map<string, DemoShare>
  backupTargets: Map<string, BackupTarget>
  backupRuns: BackupRun[]
}

const seedId = (value: number) => `01j${String(value).padStart(23, '0')}`

export function newDemoId(): string {
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz'
  const bytes = crypto.getRandomValues(new Uint8Array(26))
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join('')
}

export function createDemoState(): DemoState {
  const now = Date.now()
  const hour = 3_600_000
  const day = 86_400_000
  const folders: Folder[] = []

  const demoMoments: Array<{
    slug: string
    content: string
    publishedAt: number
    views: number
    isPinned?: boolean
  }> = [
    {
      slug: 'inkstone-moments-blog',
      content: ZH_CN_MESSAGES['seed.demo_moment_1'],
      publishedAt: now - 25 * 60_000,
      views: 42,
      isPinned: true,
    },
    {
      slug: 'autumn-weekend-walk',
      content: ZH_CN_MESSAGES['seed.demo_moment_2'],
      publishedAt: now - 5 * hour,
      views: 31,
    },
    {
      slug: 'cloudflare-workers-blog-notes',
      content: ZH_CN_MESSAGES['seed.demo_moment_3'],
      publishedAt: now - day - 2 * hour,
      views: 87,
    },
    {
      slug: 'november-reading-list',
      content: ZH_CN_MESSAGES['seed.demo_moment_4'],
      publishedAt: now - 2 * day - 4 * hour,
      views: 19,
    },
    {
      slug: 'november-film-roll',
      content: ZH_CN_MESSAGES['seed.demo_moment_5'],
      publishedAt: now - 3 * day - 6 * hour,
      views: 64,
    },
  ]

  const momentNotes = demoMoments.map((item, index) =>
    note(seedId(30 + index), item.content, null, item.publishedAt, {
      isPinned: item.isPinned ?? false,
      isStarred: index === 0,
    }),
  )
  const welcomeNotes = welcomeNoteTemplates('zh-CN').map(({ content }, index) =>
    note(seedId(20 + index), content, null, now - (4 + index) * day, {
      isPinned: false,
      isStarred: true,
    }),
  )
  const notes = [...momentNotes, ...welcomeNotes]
  const tagIds = new Map<string, string>()
  for (const item of notes) {
    for (const name of item.tags) if (!tagIds.has(name)) tagIds.set(name, newDemoId())
  }
  const tagColors = new Map<string, string | null>([['getting-started', '#6366f1']])
  const preferredLocaleTag = welcomeNotes[0]?.tags.find((name) => name !== 'Inkstone')
  if (preferredLocaleTag) tagColors.set(preferredLocaleTag, '#b5482e')

  const initialShares: Array<[string, DemoShare]> = demoMoments.map((item, index) => {
    const shareNote = momentNotes[index]!
    const info: ShareInfo = {
      slug: item.slug,
      noteId: shareNote.id,
      url: `/s/${item.slug}`,
      hasPassword: false,
      expiresAt: null,
      views: item.views,
      listed: true,
      createdAt: item.publishedAt,
    }
    return [shareNote.id, { info, password: null, likes: 3 + index * 2 }]
  })

  const welcomeShare: ShareInfo = {
    slug: 'welcome',
    noteId: welcomeNotes[0]!.id,
    url: '/s/welcome',
    hasPassword: false,
    expiresAt: null,
    views: 12,
    listed: true,
    createdAt: now - 4 * day,
  }
  initialShares.push([welcomeShare.noteId, { info: welcomeShare, password: null, likes: 2 }])

  return {
    authenticated: false,
    password: 'password',
    registrationOpen: false,
    cursor: 1,
    user: {
      id: seedId(1),
      login: 'admin',
      username: 'admin',
      name: 'Inkstone',
      avatarUrl: 'dicebear:0123456789abcdef0123456789abcdef',
      role: 'owner',
      createdAt: now - 30 * day,
    },
    settings: mergeSettings({ sync: { realtime: false, pollIntervalMs: 300_000 } }),
    blogSettings: {
      coverUrl: '',
      logoUrl: '',
      title: '',
      bio: '',
    },
    notes: new Map(notes.map((item) => [item.id, item])),
    folders: new Map(folders.map((item) => [item.id, item])),
    tagIds,
    tagColors,
    versions: new Map(),
    attachments: new Map(),
    shares: new Map(initialShares),
    backupTargets: new Map(),
    backupRuns: [],
  }
}

export function summarize(note: Note): NoteSummary {
  const { content: _content, ...summary } = note
  return summary
}

export function refreshNote(note: Note, content: string, title?: string): Note {
  const counted = countText(content)
  return {
    ...note,
    content,
    title: title === undefined ? note.title : truncateText(title.trim(), LIMITS.titleMaxLength),
    excerpt: deriveExcerpt(content),
    tags: sortTagNames(extractTags(content)),
    wordCount: counted.words,
    charCount: counted.chars,
  }
}

export function listFolders(state: DemoState): Folder[] {
  return [...state.folders.values()]
    .map((item) => ({
      ...item,
      noteCount: [...state.notes.values()].filter(
        (note) => note.folderId === item.id && note.deletedAt === null,
      ).length,
    }))
    .sort((left, right) => left.position - right.position || left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}

export function listTags(state: DemoState): Tag[] {
  const counts = new Map<string, number>()
  for (const item of state.notes.values()) {
    if (item.deletedAt !== null) continue
    for (const name of item.tags) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const names = new Set([...state.tagIds.keys(), ...counts.keys()])
  return sortTagNames(names).map((name) => {
    let id = state.tagIds.get(name)
    if (!id) {
      id = newDemoId()
      state.tagIds.set(name, id)
    }
    return {
      id,
      name,
      color: state.tagColors.get(name) ?? null,
      count: counts.get(name) ?? 0,
      createdAt: Date.now() - 86_400_000,
    }
  })
}

function note(
  id: string,
  content: string,
  folderId: string | null,
  createdAt: number,
  flags: Partial<Pick<Note, 'isPinned' | 'isStarred' | 'isArchived' | 'deletedAt'>> = {},
): Note {
  const counted = countText(content)
  return {
    id,
    title: deriveTitle(content),
    excerpt: deriveExcerpt(content),
    content,
    folderId,
    tags: sortTagNames(extractTags(content)),
    isPinned: flags.isPinned ?? false,
    isStarred: flags.isStarred ?? false,
    isArchived: flags.isArchived ?? false,
    wordCount: counted.words,
    charCount: counted.chars,
    rev: 1,
    position: createdAt,
    createdAt,
    updatedAt: createdAt,
    deletedAt: flags.deletedAt ?? null,
  }
}
