"""Root entrypoint for MAHA FastAPI application.
Enables auto-discovery on cloud platforms (Vercel, Render, Railway, Docker) and local uvicorn.
"""
from maha.api import app

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("maha.api:app", host="0.0.0.0", port=8000, reload=True)
