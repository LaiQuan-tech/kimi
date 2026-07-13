// Vercel serverless entry for @hr/api.
// The Express app is defined in src/app.ts (compiled to dist/app.js by the
// build step) and exported without calling listen(), so it works as a plain
// (req, res) handler that Vercel invokes per request.
export { app as default } from "../dist/app.js"
