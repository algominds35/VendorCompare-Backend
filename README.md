# VendorCompare Backend

Node.js + Express backend with OpenAI integration for vendor quote comparison.

## Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Set up environment variables:**
```bash
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:
```
OPENAI_API_KEY=sk-proj-...your-key-here
PORT=3001
```

3. **Run the server:**
```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

Server runs on: http://localhost:3001

## API Endpoints

### POST /upload
Upload vendor quote files for comparison.

**Request:**
- Method: POST
- Content-Type: multipart/form-data
- Body: files[] (2-10 files)

**Response:**
```json
{
  "success": true,
  "data": {
    "quotes": [
      {
        "vendor": "ABC Freight",
        "items": [...],
        "total": 250.00
      }
    ],
    "bestDeal": {
      "vendor": "ABC Freight",
      "total": 250.00,
      "savings": 50.00
    }
  }
}
```

### GET /health
Health check endpoint.

## Supported File Types

- PDF documents
- Excel files (.xlsx, .xls)
- CSV files
- Images (PNG, JPG)
- Text files

## How It Works

1. Files uploaded via multer
2. Sent to OpenAI GPT-4 Vision
3. AI extracts: vendor name, items, prices
4. Backend compares and finds best deal
5. Returns comparison data to frontend

## Get OpenAI API Key

1. Go to: https://platform.openai.com/api-keys
2. Create account / Sign in
3. Click "Create new secret key"
4. Copy and paste into `.env`

**Cost:** ~$0.01 per quote (very cheap!)
