# Ruang (submodule)

[`tools/ruang`](https://github.com/yugienugraha/ruang) is Ruang, a 3D virtual office and
read-only mission control for Hermes Agent and OpenCode crews (MIT licence). It is included
here as a git submodule so it stays identical to upstream.

Ruang reads everything through the `hermes` CLI, so it only shows data on a machine where
Hermes Agent is installed.

## Get the code

```bash
git submodule update --init tools/ruang
```

## Run it (Node.js 20+)

```bash
cd tools/ruang
npm install
npm run build
npm start          # open http://127.0.0.1:3001
```

Or install it as a command instead (macOS, Linux, Windows via WSL2):

```bash
curl -fsSL https://raw.githubusercontent.com/yugienugraha/ruang/main/install.sh | bash
ruang
```

## Update to the latest upstream

```bash
git submodule update --remote tools/ruang
```
