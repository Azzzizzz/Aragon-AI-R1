import { CheckCircle, XCircle, Loader2, FileImage } from 'lucide-react'
import type { Image } from '../types'

export type UploadStatus = 'requesting' | 'uploading' | 'validating' | 'success' | 'error'

export interface UploadItem {
  clientId: string
  file: File
  status: UploadStatus
  pendingId?: string   // DB id once upload-url is issued — used for cleanup on error
  result?: Image
  error?: string
}

const STATUS_LABEL: Record<UploadStatus, string> = {
  requesting: 'Preparing…',
  uploading:  'Uploading…',
  validating: 'Validating…',
  success:    '',
  error:      '',
}

export function FileListItem({ item }: { item: UploadItem }) {
  const isRejected = item.result?.status === 'REJECTED'
  const isLoading = item.status === 'requesting' || item.status === 'uploading' || item.status === 'validating'

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
      <div className="shrink-0 w-8 h-8 rounded-md bg-surface-muted flex items-center justify-center">
        <FileImage className="w-4 h-4 text-text-dim" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs text-text truncate">{item.file.name}</p>
        {isLoading && (
          <p className="text-[10px] text-text-dim mt-0.5">{STATUS_LABEL[item.status]}</p>
        )}
        {item.status === 'error' && item.error && (
          <p className="text-[10px] text-red-400 mt-0.5 truncate">{item.error}</p>
        )}
      </div>

      <div className="shrink-0">
        {isLoading && (
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
