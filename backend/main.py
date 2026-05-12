"""
The Lazy Friend — Backend Entry Point
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from features.rooms.router import router as rooms_router
from features.tracking.websocket import router as tracking_router

app = FastAPI(title="The Lazy Friend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rooms_router)
app.include_router(tracking_router)


@app.get("/")
def health():
    return {"status": "ok", "app": "The Lazy Friend"}
