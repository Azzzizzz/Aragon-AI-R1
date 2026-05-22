import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment')
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey)
export const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'AG-v1'

export function getPublicUrl(storagePath: string): string {
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath)
  return data.publicUrl
}

export async function createSignedUploadUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: false })

  if (error) throw new Error(`Failed to create signed upload URL: ${error.message}`)
  return data.signedUrl
}

export async function uploadToStorage(
  buffer: Buffer,
  storagePath: string,
  mimeType: string,
  { upsert = false }: { upsert?: boolean } = {},
): Promise<string> {
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, { contentType: mimeType, upsert })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  return getPublicUrl(storagePath)
}

export async function downloadFromStorage(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(storagePath)
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? 'no data'}`)
  const arrayBuffer = await data.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export async function deleteFromStorage(storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([storagePath])
  if (error) throw new Error(`Storage delete failed: ${error.message}`)
}

export async function deleteManyFromStorage(storagePaths: string[]): Promise<void> {
  if (storagePaths.length === 0) return
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(storagePaths)
  if (error) throw new Error(`Bulk storage delete failed: ${error.message}`)
}
