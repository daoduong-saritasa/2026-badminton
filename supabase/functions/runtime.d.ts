interface DenoEnvironment {
  get(key: string): string | undefined
}

interface DenoRuntime {
  env: DenoEnvironment
  serve(handler: (request: Request) => Response | Promise<Response>): void
}

declare const Deno: DenoRuntime
