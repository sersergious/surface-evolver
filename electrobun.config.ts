export default {
  app: {
    name: "Surface Evolver",
    identifier: "com.skuzmin.surfaceevolver"
  },
  build: {
    bun: {
      entrypoint: "src/main/src/index.ts"
    },
    views: {
      main: {
        entrypoint: "src/views/index.html"
      }
    },
    mac: {
      entitlements: "default"
    }
  }
};
