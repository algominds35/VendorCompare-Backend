# Railway Deployment Guide

## Quick Steps

1. **Push to GitHub**
   ```bash
   cd C:\Users\mrjoj\VendorCompare-New\server
   git init
   git add .
   git commit -m "Initial backend commit"
   git remote add origin https://github.com/algominds35/VendorCompare-Backend.git
   git push -u origin main
   ```

2. **Deploy on Railway**
   - Go to [railway.app](https://railway.app)
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose `VendorCompare-Backend` repo
   - Railway will auto-detect and deploy

3. **Add Environment Variable**
   - In Railway dashboard, go to your project
   - Click "Variables" tab
   - Add new variable:
     - **Name:** `OPENAI_API_KEY`
     - **Value:** Your OpenAI API key (get from https://platform.openai.com/account/api-keys)
   - Railway will automatically redeploy

4. **Get Your Backend URL**
   - Railway will give you a URL like: `https://your-app.up.railway.app`
   - Copy this URL

5. **Update Frontend**
   - In your frontend code, update the API URL
   - Create `.env` file in frontend root:
     ```
     VITE_API_URL=https://your-app.up.railway.app
     ```
   - Or update `App.jsx` line 68 to use your Railway URL

## Testing

Once deployed, test these endpoints:
- `https://your-app.up.railway.app/health` - Should return `{"status":"ok",...}`
- `https://your-app.up.railway.app/test-openai` - Should return success if API key is correct

## Troubleshooting

- **"Cannot GET /health"** - Server not running, check Railway logs
- **"OpenAI API key not configured"** - Add `OPENAI_API_KEY` in Railway Variables
- **"401 Incorrect API key"** - Your API key is wrong, get a new one from OpenAI
