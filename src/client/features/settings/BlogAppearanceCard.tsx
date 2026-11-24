import { useEffect, useRef, useState } from 'react'
import { Crop, Image as ImageIcon, RotateCcw, Save, Upload } from 'lucide-react'
import type { BlogSettings } from '@shared/types'
import { api, ApiError } from '../../lib/api'
import { t } from '../../lib/i18n'
import { Button, Logo } from '../../components/primitives'
import { Field, Input } from '../../components/form'
import { useSession } from '../../store/session'
import { useUi } from '../../store/ui'
import { BlogImageCropModal, type CropKind } from './BlogImageCropModal'

export function BlogAppearanceCard() {
  const toast = useUi((state) => state.toast)
  const [canManage, setCanManage] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [settings, setSettings] = useState<BlogSettings>({
    coverUrl: '',
    logoUrl: '',
    title: '',
    bio: '',
  })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<CropKind | null>(null)
  const [cropSession, setCropSession] = useState<{ kind: CropKind; source: File | string } | null>(
    null,
  )
  const coverInputRef = useRef<HTMLInputElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    api.share.blogSettings
      .get(controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return
        setCanManage(res.canManage)
        setSettings(res.settings)
        setLoaded(true)
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded(true)
      })
    return () => controller.abort()
  }, [])

  if (!loaded || !canManage) return null

  const save = async (next: BlogSettings = settings) => {
    if (saving || uploading) return
    setSaving(true)
    try {
      const res = await api.share.blogSettings.save(next)
      setSettings(res.settings)
      useSession.getState().updateSiteBranding({
        logoUrl: res.settings.logoUrl || undefined,
        blogTitle: res.settings.title || undefined,
      })
      toast({ title: t('blog.appearance_saved'), tone: 'success' })
    } catch (err) {
      toast({
        title: t('common.action_failed'),
        description: err instanceof ApiError ? err.message : String(err),
        tone: 'danger',
      })
    } finally {
      setSaving(false)
    }
  }

  const uploadCroppedAsset = async (kind: CropKind, file: File) => {
    if (saving || uploading) return
    setUploading(kind)
    try {
      const res = await api.share.blogSettings.upload(kind, file)
      setSettings(res.settings)
      useSession.getState().updateSiteBranding({
        logoUrl: res.settings.logoUrl || undefined,
        blogTitle: res.settings.title || undefined,
      })
      setCropSession(null)
      toast({ title: t('blog.image_uploaded'), tone: 'success' })
    } catch (err) {
      toast({
        title: t('workspace.upload_failed'),
        description: err instanceof ApiError ? err.message : String(err),
        tone: 'danger',
      })
    } finally {
      setUploading(null)
    }
  }

  return (
    <div className="mb-5 rounded-[var(--r-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3.5">
      <div className="mb-3">
        <h4 className="text-[12.5px] font-semibold text-[var(--text-primary)]">
          {t('blog.appearance_title')}
        </h4>
        <p className="mt-0.5 text-[11.5px] text-[var(--text-tertiary)]">
          {t('blog.appearance_description')}
        </p>
      </div>

      <div className="space-y-3">
        <Field label={t('blog.cover_image')}>
          <div className="space-y-2">
            <div
              style={{ aspectRatio: '640 / 268' }}
              className="relative w-full overflow-hidden rounded-[var(--r-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)]"
            >
              {settings.coverUrl ? (
                <img
                  src={settings.coverUrl}
                  alt={t('blog.cover_image')}
                  className="size-full object-cover"
                />
              ) : (
                <div
                  className="flex size-full items-center justify-center text-white/75"
                  style={{
                    background:
                      'linear-gradient(155deg, var(--moments-cover-from) 0%, var(--moments-cover-mid) 54%, var(--moments-cover-to) 100%)',
                  }}
                >
                  <ImageIcon size={20} />
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Input
                value={settings.coverUrl}
                onChange={(event) => setSettings((cur) => ({ ...cur, coverUrl: event.target.value }))}
                placeholder={t('blog.cover_placeholder')}
                aria-label={t('blog.cover_image')}
                className="min-w-0 flex-1"
              />
              <Button
                size="sm"
                variant="secondary"
                icon={<Upload size={12} />}
                loading={uploading === 'cover'}
                disabled={saving || uploading !== null}
                onClick={() => coverInputRef.current?.click()}
              >
                {t('blog.upload_image')}
              </Button>
              {settings.coverUrl && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Crop size={12} />}
                    disabled={saving || uploading !== null}
                    onClick={() => setCropSession({ kind: 'cover', source: settings.coverUrl })}
                  >
                    {t('blog.crop_adjust')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<RotateCcw size={12} />}
                    disabled={saving || uploading !== null}
                    onClick={() => void save({ ...settings, coverUrl: '' })}
                  >
                    {t('blog.reset_default')}
                  </Button>
                </>
              )}
            </div>
          </div>
        </Field>

        <Field label={t('blog.logo_image')}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[9px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
              {settings.logoUrl ? (
                <img
                  src={settings.logoUrl}
                  alt={t('blog.logo_image')}
                  className="size-full rounded-[8px] object-cover"
                />
              ) : (
                <Logo size={20} />
              )}
            </span>
            <Input
              value={settings.logoUrl}
              onChange={(event) => setSettings((cur) => ({ ...cur, logoUrl: event.target.value }))}
              placeholder={t('blog.logo_placeholder')}
              aria-label={t('blog.logo_image')}
              className="min-w-0 flex-1"
            />
            <Button
              size="sm"
              variant="secondary"
              icon={<Upload size={12} />}
              loading={uploading === 'logo'}
              disabled={saving || uploading !== null}
              onClick={() => logoInputRef.current?.click()}
            >
              {t('blog.upload_image')}
            </Button>
            {settings.logoUrl && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Crop size={12} />}
                  disabled={saving || uploading !== null}
                  onClick={() => setCropSession({ kind: 'logo', source: settings.logoUrl })}
                >
                  {t('blog.crop_adjust')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RotateCcw size={12} />}
                  disabled={saving || uploading !== null}
                  onClick={() => void save({ ...settings, logoUrl: '' })}
                >
                  {t('blog.reset_default')}
                </Button>
              </>
            )}
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('blog.custom_title')}>
            <Input
              value={settings.title}
              maxLength={40}
              onChange={(event) => setSettings((cur) => ({ ...cur, title: event.target.value }))}
              placeholder={t('blog.custom_title_placeholder')}
              aria-label={t('blog.custom_title')}
            />
          </Field>
          <Field label={t('blog.bio')}>
            <Input
              value={settings.bio}
              maxLength={120}
              onChange={(event) => setSettings((cur) => ({ ...cur, bio: event.target.value }))}
              placeholder={t('blog.bio_placeholder')}
              aria-label={t('blog.bio')}
            />
          </Field>
        </div>

        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            variant="primary"
            icon={<Save size={12} />}
            loading={saving}
            disabled={uploading !== null}
            onClick={() => void save()}
          >
            {t('blog.save_appearance')}
          </Button>
        </div>
      </div>

      <input
        ref={coverInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) setCropSession({ kind: 'cover', source: file })
        }}
      />
      <input
        ref={logoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) setCropSession({ kind: 'logo', source: file })
        }}
      />

      {cropSession && (
        <BlogImageCropModal
          kind={cropSession.kind}
          source={cropSession.source}
          submitting={uploading === cropSession.kind}
          onConfirm={(file) => void uploadCroppedAsset(cropSession.kind, file)}
          onClose={() => setCropSession(null)}
        />
      )}
    </div>
  )
}
