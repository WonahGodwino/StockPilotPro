import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { initWebSocketServer } from './src/lib/websocket'

const dev = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true)
    handle(req, res, parsedUrl)
  })

  initWebSocketServer(server)

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`)
    console.log(`> WebSocket ready on ws://localhost:${port}/api/ws`)
  })
}).catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
