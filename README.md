# The Lazy Friend 📍

Real-time group location tracker — see where your always-late friends are and how far they are from the destination.

## Tech Stack
- **Frontend:** Vue 3 + Vite + Leaflet.js + Native WebSocket API
- **Backend:** Python + FastAPI + Native WebSockets
- **Maps:** OpenStreetMap (no API key needed)

## Setup & Run

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## How it works
1. Create a room → search for a destination → share invite link
2. Friends join via the link
3. Everyone's live GPS location is shown on the map
4. See who's closest, furthest, and who's already arrived ✅
