import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment')
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey)
export const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'AG-v1'

export async function uploadToStorage(
  buffer: Buffer,
  storagePath: string,
  mimeType: string
): Promise<string> {
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, { contentType: mimeType, upsert: false })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath)
  return data.publicUrl
}

export async function deleteFromStorage(storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([storagePath])
  if (error) throw new Error(`Storage delete failed: ${error.message}`)
}
