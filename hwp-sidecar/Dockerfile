FROM debian:bookworm-slim

# LibreOffice + Java (H2Orestart is a Java extension) + Korean fonts + Flask.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice libreoffice-java-common default-jre \
      fonts-nanum fonts-noto-cjk \
      python3 python3-flask \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The H2Orestart HWP/HWPX import filter is NOT packaged in Debian bookworm,
# so install the .oxt extension directly from its GitHub release.
RUN curl -fsSL -o /tmp/H2Orestart.oxt \
      https://github.com/ebandal/H2Orestart/releases/latest/download/H2Orestart.oxt \
 && HOME=/tmp unopkg add --shared /tmp/H2Orestart.oxt \
 && rm -f /tmp/H2Orestart.oxt

COPY app.py safe_filename.py /srv/
ENV HOME=/tmp
# Run as nobody to limit blast radius of file-parsing vulnerabilities.
USER nobody
EXPOSE 8080
CMD ["python3", "/srv/app.py"]
