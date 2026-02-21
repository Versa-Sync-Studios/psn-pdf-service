import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {

  // ── 1. CORS Preflight ─────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-service-secret')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  // ── 2. Only Allow POST ────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── 3. Validate Secret ────────────────────────────────────────
  const secret = req.headers['x-service-secret']
  const expectedSecret = process.env.PDF_SERVICE_SECRET ?? ''

  if (!secret || secret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // ── 4. Validate Body ──────────────────────────────────────────
  const { html } = req.body

  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'html is required' })
  }

  let browser = null

  try {

    // ── 5. Launch Puppeteer ───────────────────────────────────
    // ✅ Fix: disable graphics mode + set LD_LIBRARY_PATH explicitly
    chromium.setGraphicsMode = false

    const executablePath = await chromium.executablePath()

    // ✅ Fix: set LD_LIBRARY_PATH to executable directory
    const execDir = executablePath.substring(0, executablePath.lastIndexOf('/'))
    process.env.LD_LIBRARY_PATH = `${execDir}:${process.env.LD_LIBRARY_PATH ?? ''}`

    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process',
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: true,
    })

    const page = await browser.newPage()

    // ── 6. Set Viewport to A4 Width ───────────────────────────
    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 1,
    })

    // ── 7. Load HTML String ───────────────────────────────────
    await page.setContent(html, {
      waitUntil: 'networkidle0',
    })

    // ── 8. Generate PDF ───────────────────────────────────────
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0',
        right: '0',
        bottom: '0',
        left: '0',
      },
    })

    // ── 9. Return PDF Bytes ───────────────────────────────────
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', pdfBuffer.length)
    return res.status(200).send(Buffer.from(pdfBuffer))

  } catch (error: any) {
    console.error('PDF generation error:', error.message)
    return res.status(500).json({
      error: 'PDF generation failed',
      debug: error.message,
    })

  } finally {
    // ── 10. Always Close Browser ──────────────────────────────
    if (browser) {
      await browser.close()
    }
  }
}
