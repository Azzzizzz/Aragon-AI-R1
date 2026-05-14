import { CheckCircle, XCircle, Loader2, FileImage } from 'lucide-react'
import type { Image } from '../types'

export type UploadStatus = 'uploading' | 'success' | 'error'

export interface UploadItem {
  clientId: string
  file: File
  status: UploadStatus
  result?: Image
  error?: string
}

export function FileListItem({ item }: { item: UploadItem }) {
  const isRejected = item.result?.status === 'REJECTED'

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
      <div className="shrink-0 w-8 h-8 rounded-md bg-surface-muted flex items-center justify-center">
        <FileImage className="w-4 h-4 text-text-dim" />
      </div>

      <p className="flex-1 text-xs text-text truncate min-w-0">{item.file.name}</p>

      <div className="shrink-0">
        {item.status === 'uploading' && (
          <Loader2 className="w-4 h-4 text-accent animate-spin" />
        )}
        {item.status === 'success' && !isRejected && (
          <CheckCircle className="w-4 h-4 text-green-500" />
        )}
        {(item.status === 'error' || isRejected) && (
          <XCircle className="w-4 h-4 text-red-400" />
        )}
      </div>
    </div>
  )
}
