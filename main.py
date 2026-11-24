"""Root entrypoint for MAHA FastAPI application.
Enables auto-discovery on cloud platforms (Vercel, Render, Railway, Docker) and local uvicorn.
"""
import os
from maha.api import app

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8765))
    uvicorn.run("maha.api:app", host="0.0.0.0", port=port, reload=True)
