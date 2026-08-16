FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*
RUN useradd -m automaton
WORKDIR /home/automaton/app
COPY --chown=automaton:automaton package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY --chown=automaton:automaton . .
RUN pnpm install --frozen-lockfile && pnpm build
USER automaton
ENV HOME=/home/automaton
CMD ["node", "dist/index.js", "--run"]
