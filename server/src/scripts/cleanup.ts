import '../config.js'
import { db } from '../db.js'
import { supabase, STORAGE_BUCKET } from '../lib/supabase.js'

async function cleanup() {
  console.log('🚀 Starting full cleanup...')

  try {
    // 1. Delete all database records
    console.log('📡 Clearing database...')
    const { count } = await db.image.deleteMany({})
    console.log(`✅ Deleted ${count} records from database.`)

    // 2. Clear storage bucket
    console.log(`📦 Clearing storage bucket: ${STORAGE_BUCKET}...`)
    const { data: files, error: listError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list()

    if (listError) throw listError

    if (files && files.length > 0) {
      const filePaths = files.map((f) => f.name)
      const { error: deleteError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove(filePaths)

      if (deleteError) throw deleteError
      console.log(`✅ Deleted ${filePaths.length} files from storage.`)
    } else {
      console.log('ℹ️ Storage bucket is already empty.')
    }

    console.log('✨ Cleanup complete! Your environment is fresh.')
  } catch (error) {
    console.error('❌ Cleanup failed:', error)
  } finally {
    await db.$disconnect()
  }
}

cleanup()
