import type { Image } from '../types'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, options)
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(error.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export interface UploadUrlResponse {
  uploadUrl: string
  storagePath: string
  id: string
}

export const api = {
  get: <T>(path: string) =>
    request<T>(path, { headers: { 'Content-Type': 'application/json' } }),

  post: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  del: (path: string) =>
    fetch(`${BASE_URL}${path}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    }),

  // Step 1: ask server for a pre-signed upload URL + create PENDING record
  requestUploadUrl: (filename: string, mimeType: string) =>
    request<UploadUrlResponse>('/api/images/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, mimeType }),
    }),

  // Step 2: PUT file bytes directly to Supabase Storage using the signed URL
  uploadDirect: async (uploadUrl: string, file: File): Promise<void> => {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    })
    if (!res.ok) throw new Error(`Direct upload failed: HTTP ${res.status}`)
  },

  // Step 3: tell server to validate the uploaded file
  validateUpload: (id: string) =>
    request<Image>(`/api/images/${id}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }),

  // Cancel an in-flight upload — cleans up the PENDING DB row
  cancelUpload: (id: string) =>
    fetch(`${BASE_URL}/api/images/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    }),
}
