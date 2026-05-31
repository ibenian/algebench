"""ASGI entrypoint for serving AlgeBench under an external ASGI server.

Run with:
    uvicorn backend.asgi:app --host 0.0.0.0 --port $PORT
"""

from backend.server import create_app

app = create_app()
