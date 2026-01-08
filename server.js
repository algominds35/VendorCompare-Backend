import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Middleware
app.use(cors());
app.use(express.json());

// File upload setup
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Helper function to encode image to base64
function encodeImage(filePath) {
  const imageBuffer = fs.readFileSync(filePath);
  return imageBuffer.toString('base64');
}

// Helper function to get file extension
function getFileExtension(filename) {
  return path.extname(filename).toLowerCase();
}

// Parse quote using OpenAI
async function parseQuoteWithAI(filePath, filename) {
  try {
    const ext = getFileExtension(filename);
    
    // For images and PDFs, use vision API
    if (['.png', '.jpg', '.jpeg', '.pdf'].includes(ext)) {
      const base64Image = encodeImage(filePath);
      const mimeType = ext === '.pdf' ? 'application/pdf' : `image/${ext.slice(1)}`;
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Extract pricing information from this vendor quote. Return ONLY a JSON object with this exact structure:
{
  "vendor": "Vendor Name",
  "items": [
    {"description": "Item or service description", "price": 100.00, "unit": "each"}
  ],
  "total": 100.00,
  "currency": "USD"
}

Rules:
- Extract ALL line items with prices
- Convert all prices to numbers (no $ or commas)
- If total is missing, calculate it
- Be precise with item descriptions`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
      });

      const content = response.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not extract JSON from response');
      }
    } else {
      // For text files (CSV, TXT, etc.), read as text
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: `Extract pricing information from this vendor quote:

${fileContent}

Return ONLY a JSON object with this exact structure:
{
  "vendor": "Vendor Name",
  "items": [
    {"description": "Item or service description", "price": 100.00, "unit": "each"}
  ],
  "total": 100.00,
  "currency": "USD"
}`
          }
        ],
        max_tokens: 1000,
      });

      const content = response.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not extract JSON from response');
      }
    }
  } catch (error) {
    console.error('Error parsing quote:', error);
    throw error;
  }
}

// Upload and compare quotes
app.post('/upload', upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Please upload at least 2 quote files'
      });
    }

    console.log(`Processing ${req.files.length} files...`);

    // Parse all quotes
    const parsedQuotes = [];
    
    for (const file of req.files) {
      try {
        console.log(`Parsing: ${file.originalname}`);
        const quoteData = await parseQuoteWithAI(file.path, file.originalname);
        parsedQuotes.push({
          filename: file.originalname,
          ...quoteData
        });
      } catch (error) {
        console.error(`Error parsing ${file.originalname}:`, error);
        parsedQuotes.push({
          filename: file.originalname,
          vendor: 'Error',
          items: [],
          total: 0,
          error: error.message
        });
      }
    }

    // Clean up uploaded files
    req.files.forEach(file => {
      fs.unlinkSync(file.path);
    });

    // Find best deal
    const validQuotes = parsedQuotes.filter(q => !q.error && q.total > 0);
    let bestDeal = null;
    if (validQuotes.length > 0) {
      bestDeal = validQuotes.reduce((min, quote) => 
        quote.total < min.total ? quote : min
      );
    }

    res.json({
      success: true,
      data: {
        quotes: parsedQuotes,
        bestDeal: bestDeal ? {
          vendor: bestDeal.vendor,
          total: bestDeal.total,
          savings: validQuotes.length > 1 ? 
            Math.max(...validQuotes.map(q => q.total)) - bestDeal.total : 0
        } : null,
        comparison: {
          lowestPrice: bestDeal?.total || 0,
          highestPrice: validQuotes.length > 0 ? 
            Math.max(...validQuotes.map(q => q.total)) : 0,
          averagePrice: validQuotes.length > 0 ?
            validQuotes.reduce((sum, q) => sum + q.total, 0) / validQuotes.length : 0
        }
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing files: ' + error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'VendorCompare backend running' });
});

app.listen(PORT, () => {
  console.log(`🚀 VendorCompare backend running on port ${PORT}`);
  console.log(`📡 Ready to process quotes!`);
});
