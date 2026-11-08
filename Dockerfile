# No dependencies, so no install step and no lockfile to drift.
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production
ENV PORT=8080
# mount a volume here in production or scores vanish with the container
ENV DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 8080
# the server answers /healthz with room and client counts
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
USER node
CMD ["node", "server/server.js"]
