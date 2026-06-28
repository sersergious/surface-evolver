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
    copy: {
      "src/views/docs": "views/main/docs"
    },
    mac: {
      entitlements: "default"
    }
  }
};
