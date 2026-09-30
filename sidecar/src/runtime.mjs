import { Mastra } from "@mastra/core"

export const mastra = new Mastra({ logger: false })

export const runtimeMetadata = Object.freeze({
  name: "mastra",
  protocolVersion: 1,
})
