FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user before COPY to ensure correct file ownership
RUN groupadd -r app && useradd -r -g app app

# Prod image installs runtime deps only; test tooling (pytest, factory-boy) lives
# in requirements-dev.txt and is used from the local .venv, not the built image.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Enforce app user ownership of all application files
RUN chown -R app:app /app

USER app

EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000"]
