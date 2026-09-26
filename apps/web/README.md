# @loctt/web (internal workspace)

This workspace holds the LocTT web UI (server and client). It is not
published on its own: it ships inside the [`loctt`](../cli/README.md)
package, which starts it with `loctt ui`.

```bash
npm install -g loctt
loctt ui
```

For development, `npm run dev` from the repository root runs the API
server and the Vite client with hot reload. See
[CONTRIBUTING.md](../../CONTRIBUTING.md).
