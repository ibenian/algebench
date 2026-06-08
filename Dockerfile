# Dockerfile for the AlgeBench Hugging Face Space (Docker SDK).
#
# Overlaid onto the deploy snapshot at repo root by scripts/deploy_hf.sh.
# HF runs the container as UID 1000 and routes external traffic to port 7860.
FROM python:3.12-slim

# git is required: requirements.txt pulls gemini-live-tools from GitHub.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# HF Spaces execute as a non-root user with UID 1000. Create a matching
# user so the app (and any cache dirs under $HOME) has a writable home.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1

WORKDIR /home/user/app

# Install deps first for layer caching.
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# App code (the deploy snapshot).
COPY --chown=user . .

EXPOSE 7860

CMD ["uvicorn", "backend.asgi:app", "--host", "0.0.0.0", "--port", "7860"]
