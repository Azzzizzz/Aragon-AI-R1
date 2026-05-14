import { useCallback } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, CloudUpload } from 'lucide-react'
import { api } from '../lib/api'
import { FileListItem, type UploadItem } from './FileListItem'
import type { Image, ImagesResponse } from '../types'

const ACCEPTED_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/heic': ['.heic'],
  'image/heif': ['.heif'],
}

const MAX_SIZE = 15 * 1024 * 1024

function makeId() {
  return Math.random().toString(36).slice(2)
}

function setItemField(
  prev: UploadItem[],
  clientId: string,
  patch: Partial<UploadItem>
): UploadItem[] {
  return prev.map((it) => (it.clientId === clientId ? { ...it, ...patch } : it))
}

interface Props {
  items: UploadItem[]
  setItems: React.Dispatch<React.SetStateAction<UploadItem[]>>
}

export function UploadDropzone({ items, setItems }: Props) {
  const queryClient = useQueryClient()

  const isUploading = items.some(
    (i) => i.status === 'requesting' || i.status === 'uploading' || i.status === 'validating'
  )

  const processFile = useCallback(
    async (file: File, clientId: string) => {
      let pendingId: string | undefined

      try {
        // Step 1 — get pre-signed URL + create PENDING DB record
        setItems((prev) => setItemField(prev, clientId, { status: 'requesting' }))
        const { uploadUrl, id } = await api.requestUploadUrl(file.name, file.type)
        pendingId = id
        setItems((prev) => setItemField(prev, clientId, { status: 'uploading', pendingId: id }))

        // Step 2 — PUT bytes directly to Supabase
        await api.uploadDirect(uploadUrl, file)
        setItems((prev) => setItemField(prev, clientId, { status: 'validating' }))

        // Step 3 — kick off async validation (returns 202 immediately)
        await api.validateUpload(id)

        // Step 4 — poll GET /api/images/:id every 2s until status leaves PENDING_UPLOAD
        const POLL_INTERVAL = 2000
        const POLL_TIMEOUT = 120_000
        const deadline = Date.now() + POLL_TIMEOUT

        let result = null
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL))
          const image = await api.getImage(id)

          // null = 404 = duplicate was auto-deleted by the server
          if (image === null) {
            setItems((prev) => setItemField(prev, clientId, { status: 'success', result: null }))
            toast.info(`${file.name}: Already uploaded`)
            setTimeout(() => {
              setItems((prev) => prev.filter((it) => it.clientId !== clientId))
            }, 3000)
            return
          }

          if (image.status !== 'PENDING_UPLOAD') {
            result = image
            break
          }
        }

        if (!result) throw new Error('Validation timed out — please try again')

        // Inject into the correct query cache immediately — no refetch gap
        const cacheKey = ['images', result.status === 'ACCEPTED' ? 'ACCEPTED' : 'REJECTED']
        queryClient.setQueryData<ImagesResponse>(cacheKey, (old) => ({
          items: [result as Image, ...(old?.items ?? [])],
          nextCursor: old?.nextCursor ?? null,
        }))

        setItems((prev) => setItemField(prev, clientId, { status: 'success', result }))
        // Background sync to keep server truth in cache
        queryClient.invalidateQueries({ queryKey: ['images'] })
      } catch (err) {
        const message = (err as Error).message || 'Upload failed'
        setItems((prev) => setItemField(prev, clientId, { status: 'error', error: message }))
        toast.error(`${file.name}: ${message}`)

        // Clean up PENDING DB row if we got an id before the failure
        if (pendingId) {
          api.cancelUpload(pendingId).catch(() => undefined)
        }
      }
    },
    [queryClient]
  )

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      rejected.forEach((r) => {
        const code = r.errors[0]?.code
        if (code === 'file-too-large') toast.error(`${r.file.name}: exceeds 15 MB limit`)
        else if (code === 'file-invalid-type') toast.error(`${r.file.name}: unsupported format`)
        else toast.error(`${r.file.name}: rejected`)
      })

      const newItems: UploadItem[] = accepted.map((file) => ({
        clientId: makeId(),
        file,
        status: 'requesting' as const,
      }))

      setItems((prev) => [...newItems, ...prev])
      newItems.forEach(({ file, clientId }) => processFile(file, clientId))
    },
    [processFile]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxSize: MAX_SIZE,
    multiple: true,
  })

  return (
    <div className="flex flex-col h-full overflow-hidden p-6 gap-3">
      <div
        {...getRootProps()}
        className={[
          'flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 cursor-pointer transition-all duration-300 shadow-sm shrink-0',
          isDragActive
            ? 'border-accent bg-accent/10 scale-[1.02] shadow-accent/20 shadow-lg'
            : 'border-accent/30 hover:border-accent bg-surface hover:bg-accent/5 hover:shadow-md',
        ].join(' ')}
      >
        <input {...getInputProps()} />

        <button
          type="button"
          className="btn-atlas w-full justify-center pointer-events-none"
        >
          {isUploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <CloudUpload className="w-4 h-4" />
              Upload photos
            </>
          )}
        </button>

        <div className="text-center">
          <p className="text-xs text-text-dim">
            {isDragActive ? 'Drop images here' : 'Click to upload or drag and drop'}
          </p>
          <p className="text-[10px] text-text-mute mt-0.5">PNG, JPG, HEIC up to 15MB</p>
        </div>
      </div>

      {items.length > 0 && (
        <div className="flex flex-col flex-1 min-h-0">
          <p className="text-[10px] text-text-mute px-1 mb-2">
            It can take up to 1 minute to upload
          </p>
          <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1 pr-1 custom-scrollbar">
            {items.map((item) => (
              <FileListItem key={item.clientId} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
