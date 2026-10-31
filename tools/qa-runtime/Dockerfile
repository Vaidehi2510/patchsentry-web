# Trusted dependency preparation only; no customer source or credentials.
FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
WORKDIR /opt/qa
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY run.cjs ./run.cjs
USER 1000:1000
ENTRYPOINT ["node","/opt/qa/run.cjs"]
