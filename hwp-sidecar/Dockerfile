FROM debian:bookworm-slim

# LibreOffice + Java (H2Orestart is a Java extension) + Korean fonts + Flask + gunicorn.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice libreoffice-java-common default-jre \
      fonts-nanum fonts-noto-cjk \
      python3 python3-flask gunicorn \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The H2Orestart HWP/HWPX import filter is NOT packaged in Debian bookworm,
# so install the .oxt extension directly from its GitHub release.
# Version is pinned so builds are reproducible; bump ARG to upgrade.
# The grep check ensures a failed install is caught at build time, not at runtime.
ARG H2ORESTART_VERSION=v0.7.12
RUN curl -fsSL -o /tmp/H2Orestart.oxt \
      https://github.com/ebandal/H2Orestart/releases/download/${H2ORESTART_VERSION}/H2Orestart.oxt \
 && HOME=/tmp unopkg add --shared /tmp/H2Orestart.oxt \
 && HOME=/tmp unopkg list --shared | grep -qi h2orestart \
 && rm -f /tmp/H2Orestart.oxt

COPY app.py safe_filename.py /srv/
ENV HOME=/tmp
# Run as nobody to limit blast radius of file-parsing vulnerabilities.
USER nobody
EXPOSE 8080
# Use gunicorn instead of the Flask dev server for production.
# SIDECAR_GUNICORN_TIMEOUT must exceed the internal soffice subprocess timeout (120s)
# so a slow conversion does not trigger a worker restart mid-flight.
CMD ["sh", "-c", "exec gunicorn --chdir /srv --workers ${SIDECAR_WORKERS:-2} --bind 0.0.0.0:${PORT:-8080} --timeout ${SIDECAR_GUNICORN_TIMEOUT:-180} app:app"]
