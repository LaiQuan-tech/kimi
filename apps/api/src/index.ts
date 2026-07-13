import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import dotenv from "dotenv"

// Load the repo-root .env (this file lives at apps/api/src/index.ts).
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, "../../../.env") })

const { app } = await import("./app.js")
const { logger } = await import("./lib/logger.js")

const port = Number(process.env.PORT ?? 4000)

app.listen(port, () => {
  logger.info({ port }, "@hr/api listening")
})
