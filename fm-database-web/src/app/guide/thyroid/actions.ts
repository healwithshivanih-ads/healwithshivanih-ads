'use server'

import fs from 'fs'
import path from 'path'
import { redirect } from 'next/navigation'

const PDF_URL = 'https://healwithshivanih-public-media.s3.ap-south-1.amazonaws.com/covers/Thyroid-Root-Cause-Guide-ShivaniHari.pdf'

const LEADS_FILE = process.env.FMDB_PLANS_DIR
  ? path.join(process.env.FMDB_PLANS_DIR, '_guide_leads.yaml')
  : path.join(process.env.HOME || '/data', 'fm-plans', '_guide_leads.yaml')

function appendLead(email: string, source: string) {
  const now = new Date().toISOString()
  const line = `- email: "${email.replace(/"/g, '')}"\n  source: "${source}"\n  at: "${now}"\n`
  try {
    fs.mkdirSync(path.dirname(LEADS_FILE), { recursive: true })
    fs.appendFileSync(LEADS_FILE, line, 'utf8')
  } catch {
    // non-fatal — don't block delivery
  }
}

export async function submitGuideAccess(formData: FormData) {
  const email = (formData.get('email') as string || '').trim().toLowerCase()
  const source = (formData.get('source') as string || 'thyroid-guide')

  if (!email || !email.includes('@')) return

  appendLead(email, source)
  redirect(PDF_URL)
}
