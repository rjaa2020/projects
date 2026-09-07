FROM node:20-slim

# Python for the Woodshed engine/API
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app

# Install the Woodshed Python package + its web (FastAPI/uvicorn) extras
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -e ".[web]"
ENV PATH="/opt/venv/bin:${PATH}"

# Install Node deps for the web GUI
RUN npm --prefix web install --omit=dev

ENV WOODSHED_API_URL=http://127.0.0.1:8000
EXPOSE 3000

COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh
CMD ["/app/start.sh"]
