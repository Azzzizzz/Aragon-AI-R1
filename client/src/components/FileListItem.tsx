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
    <div className="group flex items-center gap-3 p-3 rounded-xl border border-border bg-surface/40 hover:bg-surface/60 hover:border-accent/30 transition-all duration-200 shadow-sm mb-2 last:mb-0">
      <div className="shrink-0 w-9 h-9 rounded-lg bg-surface-muted flex items-center justify-center border border-border/50 group-hover:border-accent/20 transition-colors">
        <FileImage className="w-4.5 h-4.5 text-text-dim group-hover:text-accent transition-colors" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-text truncate tracking-tight">{item.file.name}</p>
        {isLoading && (
          <p className="text-[10px] text-accent font-medium mt-0.5 flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-accent animate-pulse" />
            {STATUS_LABEL[item.status]}
          </p>
        )}
        {item.status === 'error' && item.error && (
          <p className="text-[10px] text-red-400 mt-0.5 truncate">{item.error}</p>
        )}
        {item.status === 'success' && !isRejected && (
          <p className="text-[10px] text-green-500 font-medium mt-0.5">Ready to process</p>
        )}
        {isRejected && (
          <p className="text-[10px] text-red-400 font-medium mt-0.5">Rejected</p>
        )}
      </div>

      <div className="shrink-0">
        {isLoading && (
          <Loader2 className="w-4 h-4 text-accent animate-spin" />
        )}
        {item.status === 'success' && !isRejected && (
          <CheckCircle className="w-4 h-4 text-green-500 fill-green-500/10" />
        )}
        {(item.status === 'error' || isRejected) && (
          <XCircle className="w-4 h-4 text-red-400 fill-red-400/10" />
        )}
      </div>
    </div>
  )
}
