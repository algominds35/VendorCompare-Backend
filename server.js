require('dotenv').config()
const express = require('express')
const multer = require('multer')
const OpenAI = require('openai')
const cors = require('cors')
const fs = require('fs-extra')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3001
const HOST = process.env.HOST || '0.0.0.0'

// Middleware
app.use(cors())
app.use(express.json())

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads')
fs.ensureDirSync(uploadsDir)

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
})

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
})

// Initialize OpenAI
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ ERROR: OPENAI_API_KEY environment variable is missing!')
  console.error('Please add your OpenAI API key to Railway environment variables')
  // Don't exit in production - let Railway show the error
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1)
  }
}

const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
}) : null

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'VendorCompare Backend API',
    endpoints: {
      health: '/health',
      testOpenAI: '/test-openai',
      upload: '/upload (POST)'
    }
  })
})

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'VendorCompare Backend is running' })
})

// Test OpenAI connection
app.get('/test-openai', async (req, res) => {
  if (!openai) {
    return res.status(500).json({ 
      success: false, 
      message: 'OpenAI API key not configured' 
    })
  }
  
  try {
    const response = await openai.models.list()
    res.json({ success: true, message: 'OpenAI API connected successfully' })
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'OpenAI API error: ' + error.message 
    })
  }
})

// Main upload and compare endpoint
app.post('/upload', upload.array('files', 10), async (req, res) => {
  if (!openai) {
    return res.status(500).json({
      success: false,
      message: 'OpenAI API key not configured. Please add OPENAI_API_KEY to Railway environment variables.'
    })
  }

  try {
    if (!req.files || req.files.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Please upload at least 2 files'
      })
    }

    console.log(`📁 Processing ${req.files.length} files...`)

    // Process each file with OpenAI
    const quotes = await Promise.all(
      req.files.map(async (file) => {
        try {
          console.log(`🔍 Analyzing: ${file.originalname}`)
          
          // Read file content
          let fileContent
          const filePath = file.path
          const ext = path.extname(file.originalname).toLowerCase()

          if (['.txt', '.csv'].includes(ext)) {
            // Text files - read directly
            fileContent = await fs.readFile(filePath, 'utf-8')
          } else if (['.png', '.jpg', '.jpeg', '.pdf'].includes(ext)) {
            // Images/PDFs - convert to base64 for OpenAI Vision
            fileContent = await fs.readFile(filePath)
            fileContent = fileContent.toString('base64')
          } else {
            // Try to read as text for other formats
            try {
              fileContent = await fs.readFile(filePath, 'utf-8')
            } catch {
              fileContent = await fs.readFile(filePath)
              fileContent = fileContent.toString('base64')
            }
          }

          // Call OpenAI to extract pricing information
          const isImage = ['.png', '.jpg', '.jpeg', '.pdf'].includes(ext)
          
          let prompt = `You are an expert at analyzing vendor quotes and extracting pricing information. 
Analyze this quote document and extract:
1. Vendor/company name
2. All line items with descriptions and prices
3. Subtotal, taxes, fees, and total price
4. Any special terms or conditions

Return the data in this JSON format:
{
  "vendor": "Company Name",
  "items": [
    {"description": "Item description", "quantity": 1, "unitPrice": 100.00, "total": 100.00}
  ],
  "subtotal": 1000.00,
  "tax": 0.00,
  "fees": 0.00,
  "total": 1000.00,
  "notes": "Any additional information"
}

Be precise with numbers. Only return valid JSON, no other text.`

          let response
          if (isImage) {
            // Use Vision API for images/PDFs
            response = await openai.chat.completions.create({
              model: 'gpt-4o',
              messages: [
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: prompt },
                    {
                      type: 'image_url',
                      image_url: {
                        url: `data:image/${ext === '.pdf' ? 'pdf' : 'jpeg'};base64,${fileContent}`
                      }
                    }
                  ]
                }
              ],
              max_tokens: 2000,
              temperature: 0.1
            })
          } else {
            // Use regular chat completion for text
            response = await openai.chat.completions.create({
              model: 'gpt-4o',
              messages: [
                {
                  role: 'system',
                  content: 'You are an expert at analyzing vendor quotes. Extract pricing information and return only valid JSON.'
                },
                {
                  role: 'user',
                  content: `Here is the quote document:\n\n${fileContent}\n\n${prompt}`
                }
              ],
              max_tokens: 2000,
              temperature: 0.1,
              response_format: { type: 'json_object' }
            })
          }

          const content = response.choices[0].message.content
          let quoteData
          
          // Try to parse JSON from response
          try {
            // Extract JSON if wrapped in markdown code blocks
            const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/)
            const jsonString = jsonMatch ? jsonMatch[1] : content
            quoteData = JSON.parse(jsonString.trim())
          } catch (parseError) {
            console.error('JSON parse error:', parseError)
            // Try to extract just the JSON part
            const jsonStart = content.indexOf('{')
            const jsonEnd = content.lastIndexOf('}') + 1
            if (jsonStart >= 0 && jsonEnd > jsonStart) {
              quoteData = JSON.parse(content.substring(jsonStart, jsonEnd))
            } else {
              throw new Error('Could not parse JSON from OpenAI response')
            }
          }

          // Clean up file
          await fs.remove(filePath)

          return {
            vendor: quoteData.vendor || file.originalname,
            items: quoteData.items || [],
            subtotal: quoteData.subtotal || 0,
            tax: quoteData.tax || 0,
            fees: quoteData.fees || 0,
            total: quoteData.total || quoteData.subtotal || 0,
            notes: quoteData.notes || '',
            filename: file.originalname
          }
        } catch (error) {
          console.error(`❌ Error processing ${file.originalname}:`, error.message)
          // Clean up file even on error
          try {
            await fs.remove(file.path)
          } catch {}
          
          return {
            vendor: file.originalname,
            error: error.message,
            filename: file.originalname
          }
        }
      })
    )

    // Calculate comparison statistics
    const validQuotes = quotes.filter(q => !q.error && q.total > 0)
    
    if (validQuotes.length === 0) {
      return res.json({
        success: false,
        message: 'Could not extract pricing from any quotes. Please check file formats.',
        quotes: quotes
      })
    }

    const prices = validQuotes.map(q => q.total)
    const lowestPrice = Math.min(...prices)
    const highestPrice = Math.max(...prices)
    const averagePrice = prices.reduce((a, b) => a + b, 0) / prices.length

    // Find best deal
    const bestDeal = validQuotes.find(q => q.total === lowestPrice)
    const savings = highestPrice - lowestPrice

    const comparison = {
      lowestPrice,
      highestPrice,
      averagePrice,
      priceRange: highestPrice - lowestPrice
    }

    // Add comparison data to each quote
    const quotesWithComparison = quotes.map(quote => ({
      ...quote,
      isBestDeal: !quote.error && quote.total === lowestPrice,
      savings: !quote.error ? highestPrice - quote.total : 0
    }))

    console.log('✅ Comparison complete!')
    console.log(`   Lowest: $${lowestPrice.toFixed(2)}`)
    console.log(`   Highest: $${highestPrice.toFixed(2)}`)
    console.log(`   Best Deal: ${bestDeal?.vendor}`)

    res.json({
      success: true,
      data: {
        quotes: quotesWithComparison,
        comparison: comparison,
        bestDeal: bestDeal ? {
          vendor: bestDeal.vendor,
          total: bestDeal.total,
          savings: savings
        } : null
      }
    })

  } catch (error) {
    console.error('❌ Server error:', error)
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message
    })
  }
})

// Catch-all for debugging
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`)
  next()
})

// 404 handler
app.use((req, res) => {
  console.log(`❌ 404: ${req.method} ${req.path}`)
  res.status(404).json({
    error: 'Not Found',
    method: req.method,
    path: req.path,
    availableEndpoints: {
      'GET /': 'Root endpoint',
      'GET /health': 'Health check',
      'GET /test-openai': 'Test OpenAI',
      'POST /upload': 'Upload quotes'
    }
  })
})

// Start server
app.listen(PORT, HOST, () => {
  console.log('🚀 VendorCompare Backend Server')
  console.log(`📍 Running on http://${HOST}:${PORT}`)
  console.log(`🔑 OpenAI API: ${process.env.OPENAI_API_KEY ? '✅ Configured' : '❌ Missing'}`)
  console.log('')
  console.log('Endpoints:')
  console.log(`  GET  /health - Health check`)
  console.log(`  GET  /test-openai - Test OpenAI connection`)
  console.log(`  POST /upload - Upload and compare quotes`)
})
