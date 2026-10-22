# Vutto Attendance — Docker image for Hugging Face Spaces (or any container host)
FROM node:20

# Build tools are present in the full node image, so better-sqlite3 can compile
# if a prebuilt binary is not available for the platform.
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

# Spaces route traffic to the port declared in the README metadata.
ENV PORT=7860
ENV DB_FILE=/tmp/attendance.db
EXPOSE 7860

CMD ["node", "server.js"]
