FROM python:3.12-slim-bookworm
LABEL org.opencontainers.image.description="DecolaInsta passive pilot authentication diagnostic"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /opt/private-instagram-worker

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY adapter.py cli.py health_service.py login_once.py ./

RUN groupadd --system worker && useradd --system --gid worker --home-dir /opt/private-instagram-worker worker
USER worker

EXPOSE 8080
CMD ["python", "health_service.py"]
