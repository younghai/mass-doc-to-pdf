FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice libreoffice-h2orestart \
      fonts-nanum fonts-noto-cjk \
      python3 python3-flask \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY app.py /srv/app.py
ENV HOME=/tmp
EXPOSE 8080
CMD ["python3", "/srv/app.py"]
