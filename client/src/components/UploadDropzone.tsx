import { useCallback, useState } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, CloudUpload } from 'lucide-react'
import { api } from '../lib/api'
import { FileListItem, type UploadItem } from './FileListItem'
import type { Image } from '../types'

const ACCEPTED_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/heic': ['.heic'],
  'image/heif': ['.heif'],
}

const MAX_SIZE = 120 * 1024 * 1024

function makeId() {
  return Math.random().toString(36).slice(2)
}

export function UploadDropzone() {
  const queryClient = useQueryClient()
  const [items, setItems] = useState<UploadItem[]>([])

  const isUploading = items.some((i) => i.status === 'uploading')

  const mutation = useMutation({
    mutationFn: (file: File) => api.postFile<Image>('/api/images', file),
    onSuccess: (result, file) => {
      setItems((prev) =>
        prev.map((it) =>
          it.file === file ? { ...it, status: 'success', result } : it,
        ),
      )
      queryClient.invalidateQueries({ queryKey: ['images'] })
    },
    onError: (err, file) => {
      setItems((prev) =>
        prev.map((it) =>
          it.file === file
            ? { ...it, status: 'error', error: (err as Error).message }
            : it,
        ),
      )
      toast.error((err as Error).message || 'Upload failed')
    },
  })

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      rejected.forEach((r) => {
        const code = r.errors[0]?.code
        if (code === 'file-too-large') toast.error(`${r.file.name}: exceeds 120 MB limit`)
        else if (code === 'file-invalid-type') toast.error(`${r.file.name}: unsupported format`)
        else toast.error(`${r.file.name}: rejected`)
      })

      const newItems: UploadItem[] = accepted.map((file) => ({
        clientId: makeId(),
        file,
        status: 'uploading',
      }))

      setItems((prev) => [...newItems, ...prev])
      accepted.forEach((file) => mutation.mutate(file))
    },
    [mutation],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxSize: MAX_SIZE,
    multiple: true,
  })

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={[
          'flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 cursor-pointer transition-all duration-200',
          isDragActive
            ? 'border-accent bg-accent/5 scale-[1.01]'
            : 'border-border hover:border-accent/40 hover:bg-accent/5',
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
          <p className="text-[10px] text-text-mute mt-0.5">PNG, JPG, HEIC up to 120MB</p>
        </div>
      </div>

      {items.length > 0 && (
        <>
          <p className="text-[10px] text-text-mute px-1">
            It can take up to 1 minute to upload
          </p>
          <div className="max-h-60 overflow-y-auto">
            {items.map((item) => (
              <FileListItem key={item.clientId} item={item} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
